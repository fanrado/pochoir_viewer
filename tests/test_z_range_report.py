"""Tests for the honest z-coverage report on export-potential."""

import re

import numpy as np
import pytest

from pochoir_viewer.cli import _WEIGHT_STRIDE, _WEIGHT_ZMAX, main


def write_dataset(root, potential, field="weight"):
    (root / "potential").mkdir(parents=True, exist_ok=True)
    np.savez(root / "potential" / f"{field}3d.npz", **{f"{field}3d": potential})
    return root


def decaying(shape=(4, 4, 40), decades=6):
    """A smooth decay that stays nonzero to the last layer, like the real field."""
    z = np.exp(-np.linspace(0, decades * np.log(10), shape[2]))
    return np.broadcast_to(z, shape).copy()


def run(root, dest, *extra, field="weight"):
    return main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--field", field, *extra,
    ])


def line_with(captured, needle):
    for line in captured.out.splitlines():
        if needle in line:
            return line
    return None


# --- the new defaults -------------------------------------------------------


def test_the_weight_default_strides_all_three_axes():
    # The reasoning in the comment: stride rather than crop, because the field
    # carries real structure to the far end of the domain.
    assert _WEIGHT_STRIDE == (2, 2, 2)


def test_there_is_no_default_crop():
    assert _WEIGHT_ZMAX is None


def test_the_default_export_keeps_the_full_z_axis(tmp_path):
    import json

    root = write_dataset(tmp_path / "OUTPUT", decaying())
    dest = tmp_path / "d"

    run(root, dest)

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["zmax"] is None
    assert meta["shape"][2] == 20  # ceil(40 / 2)


# --- the uncropped report ---------------------------------------------------


def test_an_uncropped_run_says_the_full_range_is_kept(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d")

    line = line_with(capsys.readouterr(), "full z range kept")
    assert line is not None


def test_the_uncropped_report_names_where_the_field_ends(tmp_path, capsys):
    """A field nonzero to the last layer must be reported as such, not implied
    to stop early."""
    root = write_dataset(tmp_path / "OUTPUT", decaying((4, 4, 40)))

    run(root, tmp_path / "d")

    line = line_with(capsys.readouterr(), "full z range kept")
    # Last nonzero index 39 at 0.1 mm spacing.
    assert "3.9 mm" in line


def test_the_uncropped_report_states_the_dynamic_range(tmp_path, capsys):
    """The decade count is the point: it explains why levels are log-spaced."""
    root = write_dataset(tmp_path / "OUTPUT", decaying(decades=6))

    run(root, tmp_path / "d")

    line = line_with(capsys.readouterr(), "full z range kept")
    match = re.search(r"\(([\d.]+) decades\)", line)
    assert match, line
    assert float(match.group(1)) == pytest.approx(6.0, abs=0.2)


def test_the_uncropped_report_names_the_smallest_positive_value(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying(decades=3))

    run(root, tmp_path / "d")

    assert "min positive" in line_with(capsys.readouterr(), "full z range kept")


def test_no_crop_line_when_nothing_is_cropped(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d")

    assert line_with(capsys.readouterr(), "cropped at") is None


def test_a_zmax_beyond_the_array_reports_as_uncropped(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d", "--zmax", "9999")

    out = capsys.readouterr()
    assert line_with(out, "full z range kept") is not None
    assert line_with(out, "cropped at") is None


def test_an_all_zero_field_does_not_crash_the_report(tmp_path, capsys):
    # No positive values at all: the decade calculation must be skipped.
    root = write_dataset(tmp_path / "OUTPUT", np.zeros((4, 4, 20)))

    assert run(root, tmp_path / "d") == 0

    line = line_with(capsys.readouterr(), "full z range kept")
    assert line is not None
    assert "decades" not in line


# --- the cropped report -----------------------------------------------------


def test_a_crop_says_it_is_discarding_real_field(tmp_path, capsys):
    """The wording is the point: never call a lossy crop lossless."""
    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d", "--zmax", "20")

    line = line_with(capsys.readouterr(), "cropped at")
    assert "DISCARDING" in line
    assert "still nonzero" in line


def test_the_crop_report_names_both_ends_of_what_is_lost(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying((4, 4, 40)))

    run(root, tmp_path / "d", "--zmax", "20")

    line = line_with(capsys.readouterr(), "cropped at")
    assert "z=20" in line
    assert "2.0 mm" in line  # where the crop falls
    assert "3.9 mm" in line  # where the field actually ends


def test_the_crop_report_keeps_both_metrics(tmp_path, capsys):
    # The max and the share can disagree by orders of magnitude, so both remain.
    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d", "--zmax", "20")

    line = line_with(capsys.readouterr(), "cropped at")
    assert "largest discarded value" in line
    assert "% of the total magnitude" in line


def test_the_discarded_share_is_still_correct(tmp_path, capsys):
    arr = np.ones((3, 3, 10))
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "8")

    line = line_with(capsys.readouterr(), "cropped at")
    share = float(re.search(r"discarded ([\d.e+-]+)% of the total", line).group(1))
    assert share == pytest.approx(20.0, rel=1e-3)


def test_a_tiny_share_still_does_not_print_as_zero(tmp_path, capsys):
    arr = np.ones((2, 2, 40))
    arr[:, :, 30:] = 1e-7
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "30")

    line = line_with(capsys.readouterr(), "cropped at")
    assert not re.search(r"discarded 0\.000%", line)


def test_the_report_uses_the_grid_spacing(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", decaying((4, 4, 40)))

    run(root, tmp_path / "d", "--zmax", "10")

    line = line_with(capsys.readouterr(), "cropped at")
    assert "1.0 mm" in line  # 10 * 0.1


# --- drift is unaffected ----------------------------------------------------


def test_a_drift_export_also_reports_its_z_range(tmp_path, capsys):
    root = tmp_path / "OUTPUT"
    (root / "potential").mkdir(parents=True)
    np.savez(root / "potential" / "drift3d.npz",
             drift3d=np.broadcast_to(np.linspace(-9000, 0, 20), (3, 3, 20)).copy())

    main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d")])

    assert line_with(capsys.readouterr(), "full z range kept") is not None


def test_drift_keeps_the_identity_stride(tmp_path):
    import json

    root = tmp_path / "OUTPUT"
    (root / "potential").mkdir(parents=True)
    np.savez(root / "potential" / "drift3d.npz",
             drift3d=np.broadcast_to(np.linspace(-9000, 0, 20), (3, 3, 20)).copy())

    main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d")])

    meta = json.loads((tmp_path / "d" / "potential.json").read_text())
    assert meta["zstride"] == 1
    assert "stride" not in meta


def test_an_explicit_stride_still_overrides_the_weight_default(tmp_path):
    import json

    root = write_dataset(tmp_path / "OUTPUT", decaying())

    run(root, tmp_path / "d", "--stride", "1,1,4")

    meta = json.loads((tmp_path / "d" / "potential_weight.json").read_text())
    assert meta["stride"] == [1, 1, 4]
