"""Tests for pochoir_viewer.grid — index/physical mapping and scene metadata."""

import dataclasses

import pytest

from pochoir_viewer.grid import Grid


def test_defaults_are_the_01mm_grid():
    grid = Grid(shape=(44, 44, 1601))

    assert grid.spacing == (0.1, 0.1, 0.1)
    assert grid.origin == (0.0, 0.0, 0.0)
    assert grid.units == "mm"


def test_is_frozen():
    grid = Grid(shape=(2, 2, 2))

    with pytest.raises(dataclasses.FrozenInstanceError):
        grid.spacing = (1.0, 1.0, 1.0)


def test_from_shape_defaults_match_constructor():
    assert Grid.from_shape((44, 44, 1601)) == Grid(shape=(44, 44, 1601))


def test_from_shape_accepts_lists_and_normalizes_to_tuples():
    grid = Grid.from_shape([4, 5, 6], spacing=[1.0, 2.0, 3.0], origin=[7.0, 8.0, 9.0])

    assert grid.shape == (4, 5, 6)
    assert grid.spacing == (1.0, 2.0, 3.0)
    assert grid.origin == (7.0, 8.0, 9.0)


def test_index_to_mm_origin_node():
    assert Grid.from_shape((44, 44, 1601)).index_to_mm((0, 0, 0)) == (0.0, 0.0, 0.0)


def test_index_to_mm_scales_by_spacing():
    grid = Grid.from_shape((44, 44, 1601))

    x, y, z = grid.index_to_mm((10, 20, 30))

    assert x == pytest.approx(1.0)
    assert y == pytest.approx(2.0)
    assert z == pytest.approx(3.0)


def test_index_to_mm_offsets_by_origin():
    grid = Grid.from_shape((4, 4, 4), spacing=(0.5, 0.5, 0.5), origin=(1.0, -2.0, 10.0))

    x, y, z = grid.index_to_mm((2, 2, 2))

    assert (x, y, z) == pytest.approx((2.0, -1.0, 11.0))


def test_index_to_mm_anisotropic_spacing():
    grid = Grid.from_shape((3, 3, 3), spacing=(0.1, 1.0, 10.0))

    assert grid.index_to_mm((1, 1, 1)) == pytest.approx((0.1, 1.0, 10.0))


def test_extent_mm_matches_dataset_volume():
    """The real dataset: (44, 44, 1601) nodes at 0.1 mm -> 4.4 x 4.4 x 160.1 mm."""
    extent = Grid.from_shape((44, 44, 1601)).extent_mm()

    assert extent == pytest.approx((4.4, 4.4, 160.1))


def test_extent_mm_is_independent_of_origin():
    shifted = Grid.from_shape((44, 44, 1601), origin=(5.0, 5.0, 5.0))

    assert shifted.extent_mm() == pytest.approx(Grid.from_shape((44, 44, 1601)).extent_mm())


def test_to_meta_is_json_serializable_with_lists():
    import json

    meta = Grid.from_shape((44, 44, 1601)).to_meta()

    assert meta["shape"] == [44, 44, 1601]
    assert meta["spacing"] == [0.1, 0.1, 0.1]
    assert meta["origin"] == [0.0, 0.0, 0.0]
    assert meta["units"] == "mm"
    assert meta["extent"] == pytest.approx([4.4, 4.4, 160.1])
    json.loads(json.dumps(meta))  # round-trips without a custom encoder


def test_to_meta_extent_agrees_with_extent_mm():
    grid = Grid.from_shape((7, 8, 9), spacing=(0.2, 0.3, 0.4), origin=(1.0, 1.0, 1.0))

    assert grid.to_meta()["extent"] == pytest.approx(list(grid.extent_mm()))
