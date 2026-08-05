"""Tests for the --field flag: exporting the weighting field end to end."""

import json

import numpy as np
import pytest

from pochoir_viewer.cli import _int_list, main
from pochoir_viewer.export import build_scene
from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import (
    DEFAULT_LEVELS,
    FIELD_UNITS,
    WEIGHT_LEVELS,
    default_levels,
    load_potential,
    potential_stats,
    write_potential,
)


def drift_mask(shape=(8, 8, 40)):
    mask = np.zeros(shape)
    mask[0:6, 0:5, 8:11] = 1.0
    mask[2:4, 2:4, 20] = 1.0
    mask[:, :, shape[2] - 1] = 1.0
    return mask


def weight_mask(shape=(8, 8, 40)):
    """The weighting boundary: a full plane at z = 0, then a pad region."""
    mask = np.zeros(shape)
    mask[:, :, 0] = 1.0
    mask[2:6, 2:6, 12] = 1.0
    return mask


def weight_potential(shape=(8, 8, 40)):
    """1.0 at the pad falling to ~0 — a ratio, not a voltage."""
    z = np.exp(-np.linspace(0, 6, shape[2]))
    return np.broadcast_to(z, shape).copy()


def drift_potential(shape=(8, 8, 40)):
    z = np.linspace(-9000.0, 0.0, shape[2])
    return np.broadcast_to(z, shape).copy()


def build_root(tmp_path, shape=(8, 8, 40)):
    """A dataset carrying both fields."""
    root = tmp_path / "OUTPUT"
    for sub in ("boundary", "potential", "paths"):
        (root / sub).mkdir(parents=True, exist_ok=True)

    np.savez(root / "boundary" / "drift.npz", drift=drift_mask(shape))
    np.savez(root / "boundary" / "weight.npz", weight=weight_mask(shape))
    np.savez(root / "potential" / "drift3d.npz", drift3d=drift_potential(shape))
    np.savez(root / "potential" / "weight3d.npz", weight3d=weight_potential(shape))

    moving = np.array([0.2, 0.2, 3.9]) + np.arange(20)[:, None] * [0, 0, -0.1]
    path = np.concatenate([moving, np.repeat(moving[-1:], 20, axis=0)])
    np.savez(root / "paths" / "drift3d.npz", drift3d=np.stack([path] * 3))
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(3))
    return root


@pytest.fixture
def root(tmp_path):
    return build_root(tmp_path)


def unit_grid(shape=(8, 8, 40)):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


# --- default_levels and units -----------------------------------------------


def test_default_levels_per_field():
    assert default_levels("drift") == DEFAULT_LEVELS
    assert default_levels("weight") == WEIGHT_LEVELS


def test_default_levels_defaults_to_drift():
    assert default_levels() == DEFAULT_LEVELS


def test_field_units():
    assert FIELD_UNITS["drift"] == "V"
    assert FIELD_UNITS["weight"] == "dimensionless"


def test_potential_stats_units_follow_the_field():
    arr = weight_potential()

    assert potential_stats(arr, "weight")["units"] == "dimensionless"
    assert potential_stats(arr, "drift")["units"] == "V"


def test_potential_stats_defaults_to_volts():
    assert potential_stats(np.zeros((2, 2, 2)))["units"] == "V"


def test_potential_stats_rejects_an_unknown_field():
    with pytest.raises(KeyError):
        potential_stats(np.zeros((2, 2, 2)), "velocity")


def test_load_potential_reads_the_requested_field(root):
    weight = load_potential(root, "weight")
    drift = load_potential(root, "drift")

    assert weight.max() == pytest.approx(1.0)
    assert drift.min() == pytest.approx(-9000.0)


def test_load_potential_defaults_to_drift(root):
    np.testing.assert_array_equal(load_potential(root), load_potential(root, "drift"))


# --- build_scene with the weighting field -----------------------------------


def test_the_weighting_scene_has_no_paths(root):
    """The weighting domain has no drift paths at all."""
    scene = build_scene(root, field="weight")

    assert scene["paths"] == []
    assert scene["summaries"] == []
    assert scene["meta"]["n_paths"] == 0


def test_the_weighting_scene_labels_slabs_by_position(root):
    scene = build_scene(root, field="weight")

    names = [g["name"] for g in scene["boundary"]]
    assert all(name.startswith("z ") for name in names), names
    assert "anode" not in names


def test_the_weighting_scene_reads_the_weight_boundary(root):
    """A full plane at z = 0 is the weighting boundary, not the drift one."""
    scene = build_scene(root, field="weight")

    first = scene["boundary"][0]
    assert first["z_min_mm"] == pytest.approx(0.0)
    assert first["quads"] == [[0.0, 0.0, 0.8, 0.8]]


def test_the_weighting_scene_records_its_field(root):
    assert build_scene(root, field="weight")["meta"]["field"] == "weight"


def test_the_drift_scene_adds_no_field_key(root):
    """A drift payload must stay byte-identical to the Phase 8 wire format."""
    scene = build_scene(root)

    assert "field" not in scene["meta"]
    assert set(scene["meta"]) == {"source", "grid", "extent_mm", "n_paths"}


def test_build_scene_defaults_to_drift(root):
    assert json.dumps(build_scene(root)) == json.dumps(build_scene(root, field="drift"))


def test_the_drift_scene_still_has_paths_and_roles(root):
    scene = build_scene(root)

    assert scene["meta"]["n_paths"] == 3
    assert [g["name"] for g in scene["boundary"]] == ["anode", "grid", "cathode"]


def test_a_weighting_scene_needs_no_paths_directory(tmp_path):
    """load_paths is never called, so a dataset without paths/ must work."""
    root = tmp_path / "OUTPUT"
    (root / "boundary").mkdir(parents=True)
    np.savez(root / "boundary" / "weight.npz", weight=weight_mask())

    scene = build_scene(root, field="weight")

    assert scene["paths"] == []
    assert len(scene["boundary"]) == 2


def test_the_weighting_scene_is_json_serializable(root):
    scene = build_scene(root, field="weight")

    assert json.loads(json.dumps(scene)) == scene


# --- write_potential with the weighting field -------------------------------


def test_weight_meta_carries_field_stride_and_zmax(root, tmp_path):
    meta = write_potential(
        root, tmp_path / "d", unit_grid(), stride=(2, 2, 1), zmax=30, field="weight"
    )

    assert meta["field"] == "weight"
    assert meta["stride"] == [2, 2, 1]
    assert meta["zmax"] == 30


def test_drift_meta_adds_no_new_keys(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid())

    for key in ("field", "stride", "zmax"):
        assert key not in meta


def test_weight_units_are_dimensionless(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid(), field="weight")

    assert meta["units"] == "dimensionless"


def test_weight_defaults_to_the_weight_levels(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid(), field="weight")

    drawn = [s["level"] for s in meta["isosurfaces"]] + meta["skipped_levels"]
    assert drawn == list(WEIGHT_LEVELS)


def test_drift_defaults_to_the_volt_levels(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid())

    drawn = [s["level"] for s in meta["isosurfaces"]] + meta["skipped_levels"]
    assert sorted(drawn) == sorted(DEFAULT_LEVELS)


def test_explicit_levels_override_the_field_default(root, tmp_path):
    meta = write_potential(
        root, tmp_path / "d", unit_grid(), levels=[0.5], field="weight"
    )

    assert [s["level"] for s in meta["isosurfaces"]] == [0.5]


def test_zstride_is_recorded_from_the_effective_stride(root, tmp_path):
    """The Phase 8 wire key must reflect stride[2], however it was supplied."""
    meta = write_potential(root, tmp_path / "d", unit_grid(), stride=(1, 1, 4))

    assert meta["zstride"] == 4


def test_stride_and_zmax_shrink_the_binary(root, tmp_path):
    full = write_potential(root, tmp_path / "a", unit_grid(), field="weight")
    thin = write_potential(
        root, tmp_path / "b", unit_grid(), stride=(2, 2, 1), zmax=20, field="weight"
    )

    assert thin["bytes"] < full["bytes"]
    assert thin["bytes"] == np.prod(thin["shape"]) * 4


def test_the_binary_still_matches_its_declared_size(root, tmp_path):
    meta = write_potential(
        root, tmp_path / "d", unit_grid(), stride=(2, 2, 1), zmax=20, field="weight"
    )

    assert meta["bytes"] == (tmp_path / "d" / meta["bin"]).stat().st_size


def test_weight_meta_is_json_serializable(root, tmp_path):
    meta = write_potential(
        root, tmp_path / "d", unit_grid(), stride=(2, 2, 1), zmax=20, field="weight"
    )

    assert json.loads(json.dumps(meta)) == meta


# --- _int_list --------------------------------------------------------------


def test_int_list_parses_three_components():
    assert _int_list("2,2,1") == [2, 2, 1]


def test_int_list_tolerates_whitespace():
    assert _int_list("2, 2, 1") == [2, 2, 1]


def test_int_list_rejects_a_wrong_length():
    import argparse

    with pytest.raises(argparse.ArgumentTypeError, match="three components"):
        _int_list("2,2")


def test_int_list_rejects_non_integers():
    import argparse

    with pytest.raises(argparse.ArgumentTypeError, match="comma-separated integers"):
        _int_list("2,2,x")


def test_int_list_rejects_floats():
    import argparse

    with pytest.raises(argparse.ArgumentTypeError):
        _int_list("2,2,1.5")


# --- the CLI ----------------------------------------------------------------


def test_export_accepts_the_field_flag(root, tmp_path):
    dest = tmp_path / "weight.json"

    assert main(["export", "--root", str(root), "--dest", str(dest), "--field", "weight"]) == 0

    scene = json.loads(dest.read_text())
    assert scene["meta"]["field"] == "weight"
    assert scene["paths"] == []


def test_export_defaults_to_drift(root, tmp_path):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest)])

    assert "field" not in json.loads(dest.read_text())["meta"]


def test_export_rejects_an_unknown_field(root, tmp_path):
    with pytest.raises(SystemExit):
        main([
            "export", "--root", str(root), "--dest", str(tmp_path / "s.json"),
            "--field", "velocity",
        ])


def test_export_potential_weight_uses_the_documented_defaults(root, tmp_path, capsys):
    """UPDATED for cc60c10: --field weight now strides (2, 2, 2) and does NOT
    crop. The field carries real structure to the far end of the domain, so the
    default trades z resolution for coverage rather than discarding the tail."""
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight"])

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["stride"] == [2, 2, 2]
    assert meta["zmax"] is None
    assert meta["units"] == "dimensionless"


def test_the_weight_default_keeps_the_whole_z_axis(root, tmp_path):
    """No crop means every z sample is represented, subject only to the stride."""
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight"])

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["shape"][2] == -(-40 // 2)  # ceil(40 / 2), the full axis strided


def test_export_potential_drift_keeps_the_identity_stride(root, tmp_path):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    meta = json.loads((dest / "potential.json").read_text())
    assert meta["zstride"] == 1
    assert "stride" not in meta


def test_an_explicit_stride_overrides_the_weight_default(root, tmp_path):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight", "--stride", "1,1,2"])

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["stride"] == [1, 1, 2]


def test_an_explicit_zmax_still_crops(root, tmp_path):
    # UPDATED for cc60c10: there is no zmax default to override any more, but
    # passing one must still crop. Shape is ceil(12 / stride_z).
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight", "--zmax", "12"])

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["zmax"] == 12
    assert meta["shape"][2] == 6


def test_zstride_suppresses_the_weight_stride_default(root, tmp_path):
    """Supplying zstride must not collide with the implied (2,2,1)."""
    dest = tmp_path / "d"

    assert main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
                 "--field", "weight", "--zstride", "2"]) == 0

    meta = json.loads((dest / "potential_weight.json").read_text())
    assert meta["stride"] == [1, 1, 2]


def test_the_crop_report_states_what_was_dropped(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight", "--zmax", "12"])

    out = capsys.readouterr().out
    assert "cropped at z=12" in out
    assert "DISCARDING" in out


def test_no_crop_report_when_nothing_is_dropped(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    assert "cropped at" not in capsys.readouterr().out


def test_weight_levels_print_without_a_volt_unit(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight"])

    out = capsys.readouterr().out
    for line in out.splitlines():
        if "triangles" in line:
            assert " V " not in line and not line.strip().startswith("V")


def test_drift_levels_still_print_volts(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    out = capsys.readouterr().out
    assert any("V ->" in line for line in out.splitlines())


def test_the_summary_states_the_field_and_stride(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest),
          "--field", "weight"])

    out = capsys.readouterr().out
    assert "field weight" in out
    assert "[2, 2, 2]" in out


def test_export_potential_rejects_an_unknown_field(root, tmp_path):
    with pytest.raises(SystemExit):
        main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d"),
              "--field", "velocity"])


def test_export_potential_rejects_a_bad_stride(root, tmp_path):
    with pytest.raises(SystemExit):
        main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d"),
              "--stride", "2,2"])


def test_a_missing_weight_array_reports_both_spellings(tmp_path):
    root = tmp_path / "OUTPUT"
    (root / "potential").mkdir(parents=True)
    np.savez(root / "potential" / "drift3d.npz", drift3d=drift_potential())

    with pytest.raises(FileNotFoundError) as excinfo:
        main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d"),
              "--field", "weight"])

    message = str(excinfo.value)
    assert "weight3d.npz" in message
    assert "weight.npz" in message
