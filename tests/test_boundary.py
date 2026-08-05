"""Tests for pochoir_viewer.boundary — layer selection and rect decomposition."""

import numpy as np
import pytest

from pochoir_viewer.boundary import layer_rects, mask_layers


def paint(rects, shape):
    """Render half-open (i0, j0, i1, j1) rects into a bool array of `shape`."""
    out = np.zeros(shape, dtype=bool)
    for i0, j0, i1, j1 in rects:
        out[i0:i1, j0:j1] = True
    return out


def assert_exact_partition(layer):
    """rects must cover exactly the True nodes, and never overlap each other."""
    rects = layer_rects(layer)

    np.testing.assert_array_equal(paint(rects, layer.shape), layer)

    counts = np.zeros(layer.shape, dtype=int)
    for i0, j0, i1, j1 in rects:
        counts[i0:i1, j0:j1] += 1
    assert counts.max(initial=0) <= 1, "rects overlap"

    return rects


# --- mask_layers ------------------------------------------------------------


def test_mask_layers_returns_only_occupied_layers():
    mask = np.zeros((3, 3, 5))
    mask[0, 0, 1] = 1.0
    mask[2, 2, 4] = 1.0

    layers = mask_layers(mask)

    assert [z for z, _ in layers] == [1, 4]


def test_mask_layers_indices_are_python_ints():
    mask = np.zeros((2, 2, 3))
    mask[0, 0, 2] = 1.0

    (z, _), = mask_layers(mask)

    assert type(z) is int


def test_mask_layers_converts_float_mask_to_bool():
    """The dataset stores exactly {0.0, 1.0} as float64."""
    mask = np.zeros((2, 2, 1), dtype=np.float64)
    mask[1, 0, 0] = 1.0

    (_, layer), = mask_layers(mask)

    assert layer.dtype == bool
    np.testing.assert_array_equal(layer, [[False, False], [True, False]])


def test_mask_layers_layer_shape_is_the_ij_plane():
    (_, layer), = mask_layers(np.ones((4, 7, 1)))

    assert layer.shape == (4, 7)


def test_mask_layers_all_empty():
    assert mask_layers(np.zeros((3, 3, 3))) == []


def test_mask_layers_all_occupied():
    assert [z for z, _ in mask_layers(np.ones((2, 2, 3)))] == [0, 1, 2]


# --- layer_rects: shape of the decomposition --------------------------------

def test_layer_rects_empty_layer():
    assert layer_rects(np.zeros((4, 4), dtype=bool)) == []


def test_layer_rects_single_node():
    layer = np.zeros((4, 4), dtype=bool)
    layer[1, 2] = True

    assert layer_rects(layer) == [(1, 2, 2, 3)]


def test_layer_rects_full_plane_is_one_rect():
    """The z=1600 layer of the real dataset is a full 44x44 plane."""
    layer = np.ones((44, 44), dtype=bool)

    assert layer_rects(layer) == [(0, 0, 44, 44)]


def test_layer_rects_merges_identical_runs_across_rows():
    layer = np.zeros((5, 5), dtype=bool)
    layer[1:4, 2:4] = True

    assert layer_rects(layer) == [(1, 2, 4, 4)]


def test_layer_rects_splits_when_run_span_changes():
    """Rows 0-1 span columns 0:2, row 2 spans 0:3 — the open rect must close."""
    layer = np.zeros((3, 4), dtype=bool)
    layer[0:2, 0:2] = True
    layer[2, 0:3] = True

    rects = assert_exact_partition(layer)

    assert rects == [(0, 0, 2, 2), (2, 0, 3, 3)]


def test_layer_rects_two_runs_in_one_row():
    layer = np.zeros((2, 5), dtype=bool)
    layer[:, 0] = True
    layer[:, 3:5] = True

    assert assert_exact_partition(layer) == [(0, 0, 2, 1), (0, 3, 2, 5)]


def test_layer_rects_closes_rects_at_last_row():
    layer = np.zeros((3, 3), dtype=bool)
    layer[1:, :] = True

    assert layer_rects(layer) == [(1, 0, 3, 3)]


def test_layer_rects_gap_between_rows_splits_rect():
    layer = np.zeros((5, 3), dtype=bool)
    layer[0, :] = True
    layer[3, :] = True

    assert assert_exact_partition(layer) == [(0, 0, 1, 3), (3, 0, 4, 3)]


def test_layer_rects_is_sorted():
    layer = np.zeros((6, 6), dtype=bool)
    layer[4:6, 0:2] = True
    layer[0:2, 3:5] = True

    rects = layer_rects(layer)

    assert rects == sorted(rects)


def test_layer_rects_accepts_float_layer():
    layer = np.zeros((3, 3), dtype=np.float64)
    layer[0:2, 0:2] = 1.0

    assert layer_rects(layer) == [(0, 0, 2, 2)]


# --- layer_rects: the partition invariant on harder inputs ------------------


def test_layer_rects_partitions_checkerboard():
    layer = np.indices((7, 7)).sum(axis=0) % 2 == 0

    rects = assert_exact_partition(layer)

    assert len(rects) == int(layer.sum())  # no two neighbours share a run span


def test_layer_rects_partitions_staircase():
    layer = np.tril(np.ones((8, 8), dtype=bool))

    assert_exact_partition(layer)


def test_layer_rects_partitions_ring():
    layer = np.ones((6, 6), dtype=bool)
    layer[2:4, 2:4] = False

    assert_exact_partition(layer)


@pytest.mark.parametrize("seed", range(12))
def test_layer_rects_partitions_random_layers(seed):
    rng = np.random.default_rng(seed)
    layer = rng.random((44, 44)) < 0.3

    assert_exact_partition(layer)


def test_layer_rects_reduces_rect_count_versus_one_per_node():
    """The point of the decomposition: far fewer quads than True nodes."""
    layer = np.zeros((44, 44), dtype=bool)
    layer[4:40, 4:40] = True

    rects = assert_exact_partition(layer)

    assert len(rects) == 1
    assert layer.sum() == 36 * 36


def test_mask_layers_and_layer_rects_compose():
    mask = np.zeros((44, 44, 3))
    mask[:, :, 2] = 1.0

    layers = mask_layers(mask)
    rects = {z: layer_rects(layer) for z, layer in layers}

    assert rects == {2: [(0, 0, 44, 44)]}
