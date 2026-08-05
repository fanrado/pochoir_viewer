"""Tests for boundary_groups' index-based naming mode."""

import numpy as np
import pytest

from pochoir_viewer.boundary import boundary_groups
from pochoir_viewer.grid import Grid


def unit_grid(shape):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


def names(mask, grid, **kw):
    return [g["name"] for g in boundary_groups(mask, grid, **kw)]


# --- mode selection ---------------------------------------------------------


def test_role_is_the_default():
    mask = np.zeros((2, 2, 3))
    mask[0, 0, 0] = 1.0
    mask[1, 1, 2] = 1.0

    assert names(mask, unit_grid((2, 2, 3))) == names(
        mask, unit_grid((2, 2, 3)), naming="role"
    )


def test_role_naming_is_unchanged():
    mask = np.zeros((2, 2, 5))
    for n, z in enumerate((0, 2, 4)):
        mask[n % 2, n % 2, z] = 1.0

    assert names(mask, unit_grid((2, 2, 5)), naming="role") == [
        "anode", "grid", "cathode",
    ]


def test_an_unknown_naming_mode_raises():
    mask = np.zeros((2, 2, 2))
    mask[0, 0, 0] = 1.0

    with pytest.raises(ValueError, match="unknown naming"):
        boundary_groups(mask, unit_grid((2, 2, 2)), naming="positional")


def test_the_error_lists_the_valid_modes():
    with pytest.raises(ValueError) as excinfo:
        boundary_groups(np.zeros((2, 2, 2)), unit_grid((2, 2, 2)), naming="nope")

    message = str(excinfo.value)
    assert "role" in message
    assert "index" in message


def test_the_mode_is_validated_before_any_work():
    """A typo must fail immediately, not after triangulating a large mask."""
    with pytest.raises(ValueError, match="unknown naming"):
        boundary_groups(np.zeros((44, 44, 1601)), unit_grid((44, 44, 1601)), naming="x")


# --- index naming: what it says ---------------------------------------------


def test_a_single_layer_slab_names_one_position():
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 2] = 1.0

    assert names(mask, unit_grid((2, 2, 4)), naming="index") == ["z 2.0 mm"]


def test_a_collapsed_slab_names_a_range():
    mask = np.zeros((2, 2, 6))
    mask[0:2, 0:2, 1:4] = 1.0

    assert names(mask, unit_grid((2, 2, 6)), naming="index") == ["z 1.0-4.0 mm"]


def test_positions_use_one_decimal():
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 1] = 1.0
    grid = Grid.from_shape((2, 2, 4), spacing=(0.1, 0.1, 0.1))

    assert names(mask, grid, naming="index") == ["z 0.1 mm"]


def test_names_reflect_the_grid_spacing():
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 2] = 1.0
    grid = Grid.from_shape((2, 2, 4), spacing=(1.0, 1.0, 0.5))

    assert names(mask, grid, naming="index") == ["z 1.0 mm"]


def test_names_reflect_the_grid_origin():
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 0] = 1.0
    grid = Grid.from_shape((2, 2, 4), spacing=(1.0, 1.0, 1.0), origin=(0.0, 0.0, 10.0))

    assert names(mask, grid, naming="index") == ["z 10.0 mm"]


def test_the_single_layer_test_uses_the_z_spacing_not_a_constant():
    """A coarse z grid must still be recognised as a single layer."""
    mask = np.zeros((2, 2, 4))
    mask[0, 0, 1] = 1.0
    grid = Grid.from_shape((2, 2, 4), spacing=(1.0, 1.0, 25.0))

    assert names(mask, grid, naming="index") == ["z 25.0 mm"]


def test_a_two_layer_slab_reads_as_a_range_not_a_position():
    mask = np.zeros((2, 2, 5))
    mask[0:2, 0:2, 1:3] = 1.0

    assert names(mask, unit_grid((2, 2, 5)), naming="index") == ["z 1.0-3.0 mm"]


# --- index naming: the case it exists for -----------------------------------


def test_the_weighting_boundary_is_not_called_an_anode():
    """The stated reason for this mode: the weighting boundary's lowest layer
    is a full plane at z = 0, and role naming would print 'anode' on it."""
    mask = np.zeros((4, 4, 6))
    mask[:, :, 0] = 1.0  # full plane at z = 0
    mask[1:3, 1:3, 3] = 1.0

    labels = names(mask, unit_grid((4, 4, 6)), naming="index")

    assert "anode" not in labels
    assert "cathode" not in labels
    assert labels == ["z 0.0 mm", "z 3.0 mm"]


def test_index_names_assert_nothing_about_role():
    mask = np.zeros((4, 4, 8))
    for z in (0, 3, 7):
        mask[z % 4, z % 4, z] = 1.0

    labels = names(mask, unit_grid((4, 4, 8)), naming="index")

    for word in ("anode", "cathode", "grid"):
        assert not any(word in label for label in labels)


def test_index_names_are_ordered_by_ascending_z():
    mask = np.zeros((4, 4, 9))
    for z in (1, 4, 8):
        mask[z % 4, z % 4, z] = 1.0

    labels = names(mask, unit_grid((4, 4, 9)), naming="index")

    assert labels == ["z 1.0 mm", "z 4.0 mm", "z 8.0 mm"]


def test_index_names_are_unique_for_distinct_slabs():
    mask = np.zeros((6, 6, 12))
    for n, z in enumerate(range(0, 12, 2)):
        mask[n, n, z] = 1.0

    labels = names(mask, unit_grid((6, 6, 12)), naming="index")

    assert len(set(labels)) == len(labels) == 6


def test_index_naming_scales_past_the_role_heuristic_limit():
    """Role naming invents grid-2, grid-3...; index naming just states z."""
    mask = np.zeros((10, 10, 20))
    for n, z in enumerate(range(0, 20, 2)):
        mask[n, n, z] = 1.0

    labels = names(mask, unit_grid((10, 10, 20)), naming="index")

    assert len(labels) == 10
    assert all(label.startswith("z ") for label in labels)


# --- everything else is unaffected ------------------------------------------


def test_naming_does_not_change_the_geometry():
    mask = np.zeros((4, 4, 6))
    mask[:, :, 0] = 1.0
    mask[1:3, 1:3, 3] = 1.0
    grid = unit_grid((4, 4, 6))

    by_role = boundary_groups(mask, grid, naming="role")
    by_index = boundary_groups(mask, grid, naming="index")

    for a, b in zip(by_role, by_index):
        assert a["z_min_mm"] == b["z_min_mm"]
        assert a["z_max_mm"] == b["z_max_mm"]
        assert a["quads"] == b["quads"]


def test_the_key_set_is_the_same_in_both_modes():
    mask = np.zeros((2, 2, 3))
    mask[0, 0, 1] = 1.0
    grid = unit_grid((2, 2, 3))

    (role,) = boundary_groups(mask, grid, naming="role")
    (index,) = boundary_groups(mask, grid, naming="index")

    assert list(role) == list(index) == ["name", "z_min_mm", "z_max_mm", "quads"]


def test_an_empty_mask_yields_no_groups_in_either_mode():
    grid = unit_grid((4, 4, 4))

    assert boundary_groups(np.zeros((4, 4, 4)), grid, naming="index") == []
    assert boundary_groups(np.zeros((4, 4, 4)), grid, naming="role") == []


def test_index_groups_are_json_serializable():
    import json

    mask = np.zeros((4, 4, 6))
    mask[:, :, 0] = 1.0

    groups = boundary_groups(mask, unit_grid((4, 4, 6)), naming="index")

    assert json.loads(json.dumps(groups)) == groups
