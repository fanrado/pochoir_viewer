"""Tests for pochoir_viewer.export.build_scene — the single JSON payload."""

import json

import numpy as np
import pytest

from pochoir_viewer.export import build_scene


def write_dataset(root, mask, paths, endtags):
    """Lay out a pochoir output tree under `root`."""
    (root / "boundary").mkdir(parents=True, exist_ok=True)
    (root / "paths").mkdir(parents=True, exist_ok=True)
    np.savez(root / "boundary" / "drift.npz", drift=mask)
    np.savez(root / "paths" / "drift3d.npz", drift3d=paths)
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d_endtag=endtags)
    return root


def ramp(n, start=(0.22, 0.22, 159.9), step=(0.0, 0.0, -0.1)):
    return np.array(start) + np.arange(n)[:, None] * np.array(step)


def stagnant_tail(n_moving, n_repeat, **kw):
    moving = ramp(n_moving, **kw)
    return np.concatenate([moving, np.repeat(moving[-1:], n_repeat, axis=0)])


@pytest.fixture
def root(tmp_path):
    """A miniature dataset with the real tree's topology."""
    mask = np.zeros((44, 44, 1601))
    mask[0:40, 0:36, 98:101] = 1.0
    mask[4:8, 4:8, 131] = 1.0
    mask[:, :, 1600] = 1.0
    paths = np.stack([stagnant_tail(1200, 2800) for _ in range(5)])
    return write_dataset(tmp_path, mask, paths, np.zeros(5))


@pytest.fixture
def scene(root):
    return build_scene(root)


# --- top-level shape --------------------------------------------------------


def test_scene_top_level_keys(scene):
    assert set(scene) == {"meta", "boundary", "paths", "summaries"}


def test_scene_is_json_serializable(scene):
    assert json.loads(json.dumps(scene)) == scene


def test_build_scene_accepts_str_root(root):
    assert build_scene(str(root))["meta"]["n_paths"] == 5


def test_build_scene_missing_boundary_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_scene(tmp_path)


# --- meta -------------------------------------------------------------------


def test_meta_records_the_source_root(root, scene):
    assert scene["meta"]["source"] == str(root)


def test_meta_grid_comes_from_the_mask_shape(scene):
    assert scene["meta"]["grid"]["shape"] == [44, 44, 1601]


def test_meta_grid_shape_entries_stay_ints(scene):
    """Rounding must not turn the shape into floats."""
    assert all(type(v) is int for v in scene["meta"]["grid"]["shape"])


def test_meta_grid_units_survive_rounding(scene):
    assert scene["meta"]["grid"]["units"] == "mm"


def test_meta_extent_matches_the_dataset_volume(scene):
    assert scene["meta"]["extent_mm"] == pytest.approx([4.4, 4.4, 160.1])


def test_meta_extent_agrees_with_grid_meta(scene):
    assert scene["meta"]["extent_mm"] == pytest.approx(scene["meta"]["grid"]["extent"])


def test_meta_n_paths_matches_the_paths_list(scene):
    assert scene["meta"]["n_paths"] == len(scene["paths"]) == 5


def test_spacing_override_propagates_to_grid_and_extent(root):
    scene = build_scene(root, spacing=(1.0, 1.0, 1.0))

    assert scene["meta"]["grid"]["spacing"] == [1.0, 1.0, 1.0]
    assert scene["meta"]["extent_mm"] == pytest.approx([44.0, 44.0, 1601.0])


# --- boundary ---------------------------------------------------------------


def test_boundary_groups_are_named_by_depth(scene):
    assert [g["name"] for g in scene["boundary"]] == ["anode", "grid", "cathode"]


def test_boundary_group_keys(scene):
    for group in scene["boundary"]:
        assert set(group) == {"name", "z_min_mm", "z_max_mm", "quads"}


def test_boundary_quads_are_four_numbers_each(scene):
    for group in scene["boundary"]:
        for quad in group["quads"]:
            assert len(quad) == 4
            assert all(isinstance(v, float) for v in quad)


def test_boundary_cathode_is_the_full_plane(scene):
    cathode = next(g for g in scene["boundary"] if g["name"] == "cathode")

    assert cathode["quads"] == [[0.0, 0.0, 4.4, 4.4]]


def test_boundary_slabs_have_nonzero_thickness(scene):
    for group in scene["boundary"]:
        assert group["z_max_mm"] > group["z_min_mm"]


def test_boundary_values_are_rounded_to_four_digits(scene):
    for group in scene["boundary"]:
        assert group["z_min_mm"] == round(group["z_min_mm"], 4)
        for quad in group["quads"]:
            assert all(v == round(v, 4) for v in quad)


def test_empty_mask_yields_no_boundary(tmp_path):
    root = write_dataset(
        tmp_path, np.zeros((4, 4, 4)), np.stack([ramp(3)]), np.zeros(1)
    )

    assert build_scene(root)["boundary"] == []


# --- paths ------------------------------------------------------------------


def test_path_points_are_a_flat_xyz_list(scene):
    for path in scene["paths"]:
        assert len(path["points"]) % 3 == 0
        assert all(isinstance(v, float) for v in path["points"])


def test_path_ids_are_sequential(scene):
    assert [p["id"] for p in scene["paths"]] == [0, 1, 2, 3, 4]


def test_paths_are_trimmed_and_decimated(scene):
    """Raw 4000 steps -> trimmed to 1200 -> capped at 400 points (1200 floats)."""
    for path in scene["paths"]:
        assert len(path["points"]) <= 400 * 3


def test_max_points_override_is_honoured(root):
    scene = build_scene(root, max_points=10)

    for path in scene["paths"]:
        assert len(path["points"]) <= 10 * 3


def test_path_endpoints_survive_decimation(root):
    scene = build_scene(root, max_points=10)
    points = scene["paths"][0]["points"]

    assert points[:3] == pytest.approx([0.22, 0.22, 159.9])
    assert points[-3:] == pytest.approx([0.22, 0.22, 159.9 - 1199 * 0.1])


def test_short_path_is_not_padded(tmp_path):
    root = write_dataset(tmp_path, np.ones((2, 2, 2)), np.stack([ramp(3)]), np.zeros(1))

    (path,) = build_scene(root)["paths"]

    assert len(path["points"]) == 3 * 3


def test_path_values_are_rounded_to_four_digits(scene):
    for path in scene["paths"]:
        assert all(v == round(v, 4) for v in path["points"])


# --- summaries --------------------------------------------------------------


def test_summary_keys(scene):
    for summary in scene["summaries"]:
        assert set(summary) == {"id", "start", "end", "n_steps", "z_travel", "endtag"}


def test_summaries_align_one_to_one_with_paths(scene):
    assert [s["id"] for s in scene["summaries"]] == [p["id"] for p in scene["paths"]]


def test_summary_n_steps_is_the_trimmed_length_not_the_decimated_one(scene):
    """The readout reports real steps; decimation is a display concern."""
    for summary in scene["summaries"]:
        assert summary["n_steps"] == 1200


def test_summary_endpoints_match_the_path_endpoints(scene):
    summary = scene["summaries"][0]
    points = scene["paths"][0]["points"]

    assert summary["start"] == pytest.approx(points[:3])
    assert summary["end"] == pytest.approx(points[-3:])


def test_summary_z_travel(scene):
    assert scene["summaries"][0]["z_travel"] == pytest.approx(1199 * 0.1, abs=1e-4)


def test_summary_endtag_carried_through(tmp_path):
    root = write_dataset(
        tmp_path, np.ones((2, 2, 2)), np.stack([ramp(4), ramp(4)]), np.array([0.0, 3.0])
    )

    assert [s["endtag"] for s in build_scene(root)["summaries"]] == [0.0, 3.0]


def test_summary_values_are_rounded_to_four_digits(scene):
    for summary in scene["summaries"]:
        assert summary["z_travel"] == round(summary["z_travel"], 4)
        assert all(v == round(v, 4) for v in summary["start"] + summary["end"])
