"""Tests for isosurfaces' three-axis stride, z crop, and the weight levels."""

import numpy as np
import pytest

from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import DEFAULT_LEVELS, WEIGHT_LEVELS, isosurfaces


def z_ramp(shape=(9, 9, 41), vmin=-9000.0, vmax=0.0):
    """A monotonic z ramp: surfaces are planes normal to z."""
    z = np.linspace(vmin, vmax, shape[2])
    return np.broadcast_to(z, shape).copy()


def x_ramp(shape=(41, 9, 9), vmin=-9000.0, vmax=0.0):
    """A monotonic x ramp: surfaces are planes normal to x."""
    x = np.linspace(vmin, vmax, shape[0])
    return np.broadcast_to(x[:, None, None], shape).copy()


def y_ramp(shape=(9, 41, 9), vmin=-9000.0, vmax=0.0):
    y = np.linspace(vmin, vmax, shape[1])
    return np.broadcast_to(y[None, :, None], shape).copy()


def unit_grid(shape):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


def verts_of(surface):
    return np.asarray(surface["positions"], dtype=float).reshape(-1, 3)


# --- per-axis stride in the mm conversion -----------------------------------


def test_an_x_stride_does_not_move_an_x_normal_surface():
    """The generalised bug: each index must be scaled by ITS OWN stride.
    Scaling only z would collapse an x surface toward the origin."""
    shape = (41, 9, 9)
    arr = x_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    strided, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(4, 1, 1))

    assert verts_of(strided[0])[:, 0].mean() == pytest.approx(
        verts_of(full[0])[:, 0].mean(), abs=0.5
    )


def test_a_y_stride_does_not_move_a_y_normal_surface():
    shape = (9, 41, 9)
    arr = y_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    strided, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(1, 4, 1))

    assert verts_of(strided[0])[:, 1].mean() == pytest.approx(
        verts_of(full[0])[:, 1].mean(), abs=0.5
    )


def test_a_z_stride_does_not_move_a_z_normal_surface():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    strided, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(1, 1, 4))

    assert verts_of(strided[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=0.5
    )


def test_a_transverse_stride_still_spans_the_full_extent():
    """Thinning x must not shrink the surface's x footprint in mm."""
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    strided, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(2, 2, 1))

    assert verts_of(strided[0])[:, 0].max() == pytest.approx(
        verts_of(full[0])[:, 0].max(), abs=1.0
    )


def test_an_unrelated_axis_stride_leaves_the_surface_position_alone():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    strided, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(2, 2, 1))

    assert verts_of(strided[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=0.2
    )


def test_stride_composes_with_anisotropic_spacing():
    shape = (9, 9, 41)
    grid = Grid.from_shape(shape, spacing=(0.5, 0.5, 0.1))

    surfaces, _ = isosurfaces(z_ramp(shape), grid, levels=[-4500.0], stride=(2, 2, 2))

    verts = verts_of(surfaces[0])
    # x index i of the strided volume sits at i * 2 * 0.5 mm; 4 kept samples.
    assert verts[:, 0].max() == pytest.approx(4.0, abs=0.6)
    assert verts[:, 2].mean() == pytest.approx(2.0, abs=0.2)


def test_stride_composes_with_the_origin():
    shape = (9, 9, 41)
    grid = Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0), origin=(10.0, 20.0, 30.0))

    surfaces, _ = isosurfaces(z_ramp(shape), grid, levels=[-4500.0], stride=(2, 2, 2))

    verts = verts_of(surfaces[0])
    assert verts[:, 0].min() == pytest.approx(10.0)
    assert verts[:, 1].min() == pytest.approx(20.0)
    assert verts[:, 2].mean() == pytest.approx(30.0 + 20.0, abs=0.5)


# --- the z crop adds no offset ----------------------------------------------


def test_a_crop_that_keeps_the_surface_does_not_move_it():
    """zmax is a PREFIX slice, so it shifts nothing — the comment says so and
    an off-by-one offset here would displace every surface."""
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    cropped, _ = isosurfaces(arr, grid, levels=[-4500.0], zmax=30)

    assert verts_of(cropped[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=1e-6
    )


def test_a_crop_can_remove_a_level_from_range():
    # Cropping to the first 10 layers keeps only the deepest values.
    shape = (9, 9, 41)
    arr = z_ramp(shape)

    _, skipped = isosurfaces(arr, unit_grid(shape), levels=[-500.0], zmax=10)

    assert skipped == [-500.0]


def test_crop_and_stride_together_keep_the_surface_in_place():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-6000.0])
    both, _ = isosurfaces(arr, grid, levels=[-6000.0], stride=(2, 2, 2), zmax=30)

    assert verts_of(both[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=0.6
    )


def test_zmax_beyond_the_array_is_harmless():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    full, _ = isosurfaces(arr, grid, levels=[-4500.0])
    over, _ = isosurfaces(arr, grid, levels=[-4500.0], zmax=99999)

    assert verts_of(over[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=1e-6
    )


# --- argument handling propagates from volume_float32 -----------------------


def test_zstride_still_works_as_before():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    by_zstride, _ = isosurfaces(arr, grid, levels=[-4500.0], zstride=4)
    by_stride, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(1, 1, 4))

    assert by_zstride[0]["positions"] == by_stride[0]["positions"]


def test_combining_stride_and_zstride_raises():
    shape = (9, 9, 41)

    with pytest.raises(ValueError, match="not both"):
        isosurfaces(z_ramp(shape), unit_grid(shape), levels=[-4500.0],
                    stride=(2, 1, 1), zstride=4)


def test_a_bad_stride_component_is_rejected():
    shape = (9, 9, 41)

    with pytest.raises(ValueError, match="every stride component must be >= 1"):
        isosurfaces(z_ramp(shape), unit_grid(shape), levels=[-4500.0], stride=(1, 0, 1))


def test_a_bad_zstride_is_still_reported_as_zstride():
    shape = (9, 9, 41)

    with pytest.raises(ValueError, match="zstride must be >= 1"):
        isosurfaces(z_ramp(shape), unit_grid(shape), levels=[-4500.0], zstride=0)


def test_the_default_stride_is_the_identity():
    shape = (9, 9, 41)
    arr = z_ramp(shape)
    grid = unit_grid(shape)

    default, _ = isosurfaces(arr, grid, levels=[-4500.0])
    explicit, _ = isosurfaces(arr, grid, levels=[-4500.0], stride=(1, 1, 1))

    assert default[0]["positions"] == explicit[0]["positions"]


# --- WEIGHT_LEVELS ----------------------------------------------------------


def test_weight_levels_are_dimensionless_fractions():
    assert all(0.0 < level < 1.0 for level in WEIGHT_LEVELS)


def test_weight_levels_descend():
    assert list(WEIGHT_LEVELS) == sorted(WEIGHT_LEVELS, reverse=True)


def test_weight_levels_are_distinct():
    assert len(set(WEIGHT_LEVELS)) == len(WEIGHT_LEVELS)


def test_weight_levels_span_more_than_a_decade():
    """The stated rationale: the weighting potential falls off fast, so evenly
    spaced levels would bunch every surface into the first millimetre."""
    assert WEIGHT_LEVELS[0] / WEIGHT_LEVELS[-1] >= 10


def test_weight_levels_are_not_evenly_spaced():
    gaps = [WEIGHT_LEVELS[n] - WEIGHT_LEVELS[n + 1] for n in range(len(WEIGHT_LEVELS) - 1)]

    assert max(gaps) > 2 * min(gaps), "levels look linear, not log-ish"


def test_weight_levels_bracket_the_documented_grid_value():
    # The docstring cites 0.115 at the grid; levels must straddle it.
    assert min(WEIGHT_LEVELS) < 0.115 < max(WEIGHT_LEVELS)


def test_weight_levels_are_distinct_from_the_drift_defaults():
    assert set(WEIGHT_LEVELS).isdisjoint(DEFAULT_LEVELS)


def test_drift_defaults_remain_negative_volts():
    # Guards against the two level sets being swapped somewhere.
    assert all(level < 0 for level in DEFAULT_LEVELS)


def test_weight_levels_triangulate_a_normalised_field():
    """A 1.0-at-the-pad to 0-at-the-cathode ramp: every level is in range."""
    shape = (9, 9, 41)
    arr = z_ramp(shape, vmin=0.0, vmax=1.0)

    surfaces, skipped = isosurfaces(arr, unit_grid(shape), levels=WEIGHT_LEVELS)

    assert [s["level"] for s in surfaces] == list(WEIGHT_LEVELS)
    assert skipped == []


def test_weight_level_surfaces_are_ordered_by_depth():
    shape = (9, 9, 41)
    arr = z_ramp(shape, vmin=0.0, vmax=1.0)

    surfaces, _ = isosurfaces(arr, unit_grid(shape), levels=WEIGHT_LEVELS)

    z_means = [verts_of(s)[:, 2].mean() for s in surfaces]
    assert z_means == sorted(z_means, reverse=True), "higher weight is not nearer the pad"


def test_weight_levels_against_a_fast_falloff_field():
    """An exponential falloff, closer to the real weighting potential."""
    shape = (9, 9, 61)
    z = np.exp(-np.linspace(0, 6, shape[2]))
    arr = np.broadcast_to(z, shape).copy()

    surfaces, skipped = isosurfaces(arr, unit_grid(shape), levels=WEIGHT_LEVELS)

    assert skipped == []
    z_means = [verts_of(s)[:, 2].mean() for s in surfaces]
    assert z_means == sorted(z_means), "levels are not spread along the falloff"
    # The point of log-ish spacing: they must not all pile into the first tenth.
    assert max(z_means) - min(z_means) > 0.5 * (shape[2] - 1) * 0.5
