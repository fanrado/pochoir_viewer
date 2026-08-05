"""Tests for the discarded-integral-share line in the crop report."""

import re

import numpy as np
import pytest

from pochoir_viewer.cli import main


def write_dataset(root, potential):
    (root / "potential").mkdir(parents=True, exist_ok=True)
    np.savez(root / "potential" / "weight3d.npz", weight3d=potential)
    return root


def run(root, dest, *extra):
    return main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--field", "weight", *extra,
    ])


def crop_line(captured):
    for line in captured.out.splitlines():
        if line.startswith("cropped at"):
            return line
    return None


def parse_share(line):
    match = re.search(r"discarded ([\d.e+-]+)% of the total magnitude", line)
    assert match, f"no share in {line!r}"
    return float(match.group(1))


# --- the share is correct ---------------------------------------------------


def test_the_share_matches_a_hand_computable_case(tmp_path, capsys):
    # 10 z layers of 1.0 each; cropping at 8 discards exactly 2 of 10 = 20%.
    arr = np.ones((3, 3, 10))
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "8")

    assert parse_share(crop_line(capsys.readouterr())) == pytest.approx(20.0, rel=1e-3)


def test_the_share_weights_by_magnitude_not_by_layer_count(tmp_path, capsys):
    """Layers are not equal: a crop through small values discards little."""
    arr = np.ones((2, 2, 10))
    arr[:, :, 5:] = 0.01
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "5")

    share = parse_share(crop_line(capsys.readouterr()))
    # 5 layers of 0.01 out of (5 * 1 + 5 * 0.01) = 0.05 / 5.05 ~= 0.99%.
    assert share == pytest.approx(0.99, rel=0.05)


def test_the_share_uses_absolute_values(tmp_path, capsys):
    """Negative values must not cancel positive ones in the total."""
    arr = np.ones((2, 2, 10))
    arr[:, :, :5] = -1.0  # kept half is negative
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "5")

    # |total| is 10 layers' worth, |dropped| is 5: exactly 50%.
    assert parse_share(crop_line(capsys.readouterr())) == pytest.approx(50.0, rel=1e-3)


def test_the_share_matches_a_direct_numpy_computation(tmp_path, capsys):
    rng = np.random.default_rng(0)
    arr = rng.random((4, 5, 20))
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "13")

    expected = np.abs(arr[:, :, 13:]).sum() / np.abs(arr).sum() * 100
    assert parse_share(crop_line(capsys.readouterr())) == pytest.approx(expected, rel=1e-2)


def test_the_slabwise_sum_equals_the_whole_array_sum(tmp_path, capsys):
    """The slab-at-a-time accumulation exists to bound memory; it must not
    change the answer, including for values that stress float accumulation."""
    arr = np.full((4, 4, 30), 1e-8)
    arr[:, :, 0] = 1e3
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "15")

    expected = np.abs(arr[:, :, 15:]).sum() / np.abs(arr).sum() * 100
    assert parse_share(crop_line(capsys.readouterr())) == pytest.approx(expected, rel=1e-2)


def test_a_deeper_crop_discards_less(tmp_path, capsys):
    arr = np.exp(-np.linspace(0, 8, 40))
    arr = np.broadcast_to(arr, (3, 3, 40)).copy()
    root = write_dataset(tmp_path / "OUTPUT", arr)

    shares = []
    for zmax in (10, 20, 30):
        run(root, tmp_path / f"d{zmax}", "--zmax", str(zmax))
        shares.append(parse_share(crop_line(capsys.readouterr())))

    assert shares[0] > shares[1] > shares[2]


def test_an_all_zero_array_does_not_divide_by_zero(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", np.zeros((2, 2, 10)))

    assert run(root, tmp_path / "d", "--zmax", "5") == 0

    share = parse_share(crop_line(capsys.readouterr()))
    assert share == pytest.approx(0.0)


# --- both metrics are reported ----------------------------------------------


def test_both_the_max_and_the_share_appear(tmp_path, capsys):
    """They can disagree by orders of magnitude, so both must be present."""
    arr = np.ones((2, 2, 10))
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "8")

    line = crop_line(capsys.readouterr())
    # UPDATED for cc60c10: the max clause was reworded from "per-plane max
    # beyond z=N" to "largest discarded value", and the line now also names the
    # mm position out to which real field is being thrown away.
    assert "largest discarded value" in line
    assert "DISCARDING" in line
    assert "discarded" in line
    assert "% of the total magnitude" in line


def test_the_max_and_share_can_disagree_sharply(tmp_path, capsys):
    """A tall thin tail: a large max but a tiny share of the integral."""
    arr = np.ones((4, 4, 40))
    arr[:, :, 30:] = 0.0
    arr[0, 0, 39] = 0.9  # one big voxel in the discarded region
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "30")

    line = crop_line(capsys.readouterr())
    assert "0.9" in line  # the max is large
    assert parse_share(line) < 0.5  # the share is not


def test_the_crop_line_still_names_the_index_and_mm(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", np.ones((2, 2, 10)))

    run(root, tmp_path / "d", "--zmax", "6")

    line = crop_line(capsys.readouterr())
    assert "cropped at z=6" in line
    assert "mm" in line


def test_no_crop_line_when_nothing_is_dropped(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", np.ones((2, 2, 10)))

    run(root, tmp_path / "d", "--zmax", "10")

    assert crop_line(capsys.readouterr()) is None


def test_no_crop_line_for_a_zmax_beyond_the_array(tmp_path, capsys):
    root = write_dataset(tmp_path / "OUTPUT", np.ones((2, 2, 10)))

    run(root, tmp_path / "d", "--zmax", "999")

    assert crop_line(capsys.readouterr()) is None


# --- formatting -------------------------------------------------------------


def test_a_tiny_share_does_not_print_as_zero(tmp_path, capsys):
    """The stated reason for 3 significant figures: a fixed-decimal 0.0001%
    would print as "0.000%", which reads as exactly nothing discarded."""
    arr = np.ones((2, 2, 40))
    arr[:, :, 30:] = 1e-7
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "30")

    line = crop_line(capsys.readouterr())
    share = parse_share(line)
    assert share > 0, "a nonzero discard printed as zero"
    assert not re.search(r"discarded 0\.000%", line)


def test_the_share_uses_significant_figures(tmp_path, capsys):
    arr = np.ones((2, 2, 40))
    arr[:, :, 20:] = 1e-9
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "20")

    match = re.search(r"discarded (\S+)% ", crop_line(capsys.readouterr()))
    digits = re.sub(r"[^0-9]", "", match.group(1).split("e")[0]).lstrip("0")
    assert len(digits) <= 3, f"more than 3 significant figures: {match.group(1)}"


def test_a_large_share_prints_readably(tmp_path, capsys):
    arr = np.ones((2, 2, 10))
    root = write_dataset(tmp_path / "OUTPUT", arr)

    run(root, tmp_path / "d", "--zmax", "2")

    assert parse_share(crop_line(capsys.readouterr())) == pytest.approx(80.0, rel=1e-3)


# --- drift is unaffected ----------------------------------------------------


def test_a_drift_export_prints_no_crop_line_by_default(tmp_path, capsys):
    root = tmp_path / "OUTPUT"
    (root / "potential").mkdir(parents=True)
    np.savez(root / "potential" / "drift3d.npz", drift3d=np.ones((2, 2, 10)) * -1000)

    main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d")])

    assert crop_line(capsys.readouterr()) is None


def test_an_explicit_zmax_reports_for_drift_too(tmp_path, capsys):
    root = tmp_path / "OUTPUT"
    (root / "potential").mkdir(parents=True)
    np.savez(root / "potential" / "drift3d.npz", drift3d=np.ones((2, 2, 10)) * -1000)

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d"),
        "--zmax", "5",
    ])

    line = crop_line(capsys.readouterr())
    assert line is not None
    assert parse_share(line) == pytest.approx(50.0, rel=1e-3)
