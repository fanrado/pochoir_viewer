"""Tests for pochoir_viewer.boundary.boundary_groups — mm-space named slabs."""

import numpy as np
import pytest

from pochoir_viewer.boundary import boundary_groups
from pochoir_viewer.grid import Grid


def dataset_like_mask():
    """A mask with the real dataset's z topology: 98-100, 131, and a full 1600."""
    mask = np.zeros((44, 44, 1601), dtype=np.float64)
    mask[0:40, 0:36, 98:101] = 1.0  # three identical consecutive layers
    mask[4:8, 4:8, 131] = 1.0
    mask[:, :, 1600] = 1.0  # full plane
    return mask


def unit_grid(shape):
    """A grid with 1 mm nodes, so mm values equal indices and stay readable."""
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


# --- grouping of z-layers ---------------------------------------------------


def test_identical_consecutive_layers_collapse_into_one_group():
    mask = np.zeros((3, 3, 5))
    mask[0:2, 0:2, 1:4] = 1.0

    groups = boundary_groups(mask, unit_grid((3, 3, 5)))

    assert len(groups) == 1
    assert (groups[0]["z_min_mm"], groups[0]["z_max_mm"]) == (1.0, 4.0)


def test_differing_layers_stay_separate():
    mask = np.zeros((3, 3, 2))
    mask[0, 0, 0] = 1.0
    mask[1, 1, 1] = 1.0

    groups = boundary_groups(mask, unit_grid((3, 3, 2)))

    assert len(groups) == 2


def test_equal_layers_split_by_a_gap_stay_separate():
    """Same 2D mask at z=0 and z=2 is two slabs, not one — z must be consecutive."""
    mask = np.zeros((3, 3, 3))
    mask[0, 0, 0] = 1.0
    mask[0, 0, 2] = 1.0

    groups = boundary_groups(mask, unit_grid((3, 3, 3)))

    assert [(g["z_min_mm"], g["z_max_mm"]) for g in groups] == [(0.0, 1.0), (2.0, 3.0)]


def test_empty_mask_yields_no_groups():
    assert boundary_groups(np.zeros((4, 4, 4)), unit_grid((4, 4, 4))) == []


def test_groups_are_ordered_by_ascending_z():
    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))

    z_mins = [g["z_min_mm"] for g in groups]
    assert z_mins == sorted(z_mins)


# --- slab thickness ---------------------------------------------------------


def test_single_layer_slab_is_one_node_thick():
    mask = np.zeros((2, 2, 3))
    mask[0, 0, 1] = 1.0

    (group,) = boundary_groups(mask, Grid.from_shape((2, 2, 3)))

    assert group["z_min_mm"] == pytest.approx(0.1)
    assert group["z_max_mm"] == pytest.approx(0.2)  # visible edge-on, never zero-thickness


def test_slab_thickness_never_zero():
    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))

    for group in groups:
        assert group["z_max_mm"] > group["z_min_mm"]


def test_slab_spans_the_full_run_of_layers():
    mask = np.zeros((2, 2, 6))
    mask[0, 0, 2:5] = 1.0

    (group,) = boundary_groups(mask, Grid.from_shape((2, 2, 6)))

    assert group["z_min_mm"] == pytest.approx(0.2)
    assert group["z_max_mm"] == pytest.approx(0.5)


def test_z_respects_grid_origin_and_spacing():
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 2] = 1.0
    grid = Grid.from_shape((2, 2, 4), spacing=(1.0, 1.0, 0.5), origin=(0.0, 0.0, 10.0))

    (group,) = boundary_groups(mask, grid)

    assert group["z_min_mm"] == pytest.approx(11.0)
    assert group["z_max_mm"] == pytest.approx(11.5)


# --- quads ------------------------------------------------------------------


def test_quads_are_mm_space_rects():
    mask = np.zeros((10, 10, 1))
    mask[2:5, 3:7, 0] = 1.0

    (group,) = boundary_groups(mask, Grid.from_shape((10, 10, 1)))

    assert len(group["quads"]) == 1
    assert group["quads"][0] == pytest.approx([0.2, 0.3, 0.5, 0.7])


def test_quads_respect_origin():
    mask = np.zeros((4, 4, 1))
    mask[1:3, 1:3, 0] = 1.0
    grid = Grid.from_shape((4, 4, 1), spacing=(1.0, 1.0, 1.0), origin=(100.0, 200.0, 0.0))

    (group,) = boundary_groups(mask, grid)

    assert len(group["quads"]) == 1
    assert group["quads"][0] == pytest.approx([101.0, 201.0, 103.0, 203.0])


def test_quads_use_x_for_axis0_and_y_for_axis1():
    """Anisotropic spacing catches an i/j swap that isotropic spacing would hide."""
    mask = np.zeros((4, 4, 1))
    mask[0:2, 0:3, 0] = 1.0
    grid = Grid.from_shape((4, 4, 1), spacing=(1.0, 10.0, 1.0))

    (group,) = boundary_groups(mask, grid)

    assert len(group["quads"]) == 1
    assert group["quads"][0] == pytest.approx([0.0, 0.0, 2.0, 30.0])


def test_full_plane_is_a_single_quad_covering_the_extent():
    mask = np.zeros((44, 44, 1))
    mask[:, :, 0] = 1.0

    (group,) = boundary_groups(mask, Grid.from_shape((44, 44, 1)))

    assert len(group["quads"]) == 1
    assert group["quads"][0] == pytest.approx([0.0, 0.0, 4.4, 4.4])


def test_disjoint_regions_become_multiple_quads():
    mask = np.zeros((6, 6, 1))
    mask[0:2, 0:2, 0] = 1.0
    mask[4:6, 4:6, 0] = 1.0

    (group,) = boundary_groups(mask, unit_grid((6, 6, 1)))

    assert len(group["quads"]) == 2


# --- names ------------------------------------------------------------------


def test_single_group_is_named_anode():
    mask = np.zeros((2, 2, 2))
    mask[0, 0, 0] = 1.0

    assert [g["name"] for g in boundary_groups(mask, unit_grid((2, 2, 2)))] == ["anode"]


def test_two_groups_are_anode_and_cathode():
    mask = np.zeros((2, 2, 3))
    mask[0, 0, 0] = 1.0
    mask[1, 1, 2] = 1.0

    names = [g["name"] for g in boundary_groups(mask, unit_grid((2, 2, 3)))]

    assert names == ["anode", "cathode"]


def test_three_groups_get_a_single_grid_in_the_middle():
    """The real dataset: layers 98-100, 131, and the full plane at 1600."""
    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))

    assert [g["name"] for g in groups] == ["anode", "grid", "cathode"]


def test_four_groups_number_the_middle_grids():
    mask = np.zeros((4, 4, 7))
    for n, z in enumerate((0, 2, 4, 6)):
        mask[n, n, z] = 1.0

    names = [g["name"] for g in boundary_groups(mask, unit_grid((4, 4, 7)))]

    assert names == ["anode", "grid", "grid-2", "cathode"]


def test_names_are_unique():
    mask = np.zeros((6, 6, 11))
    for n, z in enumerate(range(0, 11, 2)):
        mask[n, n, z] = 1.0

    names = [g["name"] for g in boundary_groups(mask, unit_grid((6, 6, 11)))]

    assert len(set(names)) == len(names) == 6


def test_anode_is_the_lowest_z_and_cathode_the_highest():
    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))
    by_name = {g["name"]: g for g in groups}

    assert by_name["anode"]["z_min_mm"] == min(g["z_min_mm"] for g in groups)
    assert by_name["cathode"]["z_min_mm"] == max(g["z_min_mm"] for g in groups)


# --- payload shape ----------------------------------------------------------


def test_group_keys_are_exactly_the_documented_four():
    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))

    for group in groups:
        assert list(group) == ["name", "z_min_mm", "z_max_mm", "quads"]


def test_groups_are_json_serializable():
    import json

    groups = boundary_groups(dataset_like_mask(), Grid.from_shape((44, 44, 1601)))

    assert json.loads(json.dumps(groups)) == groups


def test_quads_cover_every_true_node_of_the_dataset_like_mask():
    """No node is dropped: total quad area equals the True-node area per slab."""
    mask = dataset_like_mask()
    grid = Grid.from_shape((44, 44, 1601))
    sx, sy, _ = grid.spacing

    groups = boundary_groups(mask, grid)
    total_quad_area = sum(
        (x1 - x0) * (y1 - y0) for g in groups for x0, y0, x1, y1 in g["quads"]
    )
    # Each slab contributes its 2D layer once, regardless of how many z-layers it merged.
    expected_layers = [98, 131, 1600]
    expected_area = sum(mask[:, :, z].sum() * sx * sy for z in expected_layers)

    assert total_quad_area == pytest.approx(expected_area)
