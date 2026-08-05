"""Tests for pochoir_viewer.potential.isosurfaces — marching-cubes equipotentials."""

import json

import numpy as np
import pytest

from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import DEFAULT_LEVELS, isosurfaces


def ramp_volume(shape=(6, 6, 21), vmin=-8000.0, vmax=0.0):
    """A monotonic z ramp, like the real drift potential."""
    z = np.linspace(vmin, vmax, shape[2])
    return np.broadcast_to(z, shape).copy()


def unit_grid(shape=(6, 6, 21)):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


def verts_of(surface):
    return np.asarray(surface["positions"], dtype=float).reshape(-1, 3)


# --- level selection --------------------------------------------------------


def test_levels_inside_the_range_produce_surfaces():
    surfaces, skipped = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    assert len(surfaces) == 1
    assert skipped == []
    assert surfaces[0]["level"] == pytest.approx(-4000.0)


def test_levels_outside_the_range_are_skipped_not_raised():
    surfaces, skipped = isosurfaces(
        ramp_volume(vmin=-8000.0, vmax=0.0), unit_grid(), levels=[-99999.0, 500.0]
    )

    assert surfaces == []
    assert skipped == [-99999.0, 500.0]


def test_the_interval_is_open_at_both_ends():
    """A level exactly at vmin or vmax cannot be triangulated."""
    _, skipped = isosurfaces(
        ramp_volume(vmin=-8000.0, vmax=0.0), unit_grid(), levels=[-8000.0, 0.0]
    )

    assert skipped == [-8000.0, 0.0]


def test_mixed_levels_are_partitioned():
    surfaces, skipped = isosurfaces(
        ramp_volume(), unit_grid(), levels=[-4000.0, 12345.0, -2000.0]
    )

    assert [s["level"] for s in surfaces] == [-4000.0, -2000.0]
    assert skipped == [12345.0]


def test_surfaces_preserve_the_requested_level_order():
    levels = [-500.0, -6000.0, -2000.0]

    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=levels)

    assert [s["level"] for s in surfaces] == levels


def test_default_levels_are_used_when_none_are_given():
    surfaces, skipped = isosurfaces(ramp_volume(vmin=-9000.0, vmax=0.0), unit_grid())

    assert [s["level"] for s in surfaces] == list(DEFAULT_LEVELS)
    assert skipped == []


def test_default_levels_are_all_negative_volts():
    # The drift runs from 0 V at the anode down to a large negative cathode.
    assert all(level < 0 for level in DEFAULT_LEVELS)


def test_a_constant_volume_yields_no_surfaces():
    surfaces, skipped = isosurfaces(np.full((4, 4, 4), -3000.0), unit_grid((4, 4, 4)))

    assert surfaces == []
    assert skipped == list(DEFAULT_LEVELS)


def test_integer_levels_are_accepted():
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000])

    assert type(surfaces[0]["level"]) is float


# --- geometry ---------------------------------------------------------------


def test_a_monotonic_ramp_gives_a_planar_surface_at_the_expected_z():
    # -4000 V is halfway down a 0..-8000 ramp over 21 layers -> z index 10.
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    z = verts_of(surfaces[0])[:, 2]
    assert z.min() == pytest.approx(10.0, abs=1e-3)
    assert z.max() == pytest.approx(10.0, abs=1e-3)


def test_deeper_levels_sit_nearer_the_anode():
    surfaces, _ = isosurfaces(
        ramp_volume(), unit_grid(), levels=[-6000.0, -4000.0, -2000.0]
    )

    z_means = [verts_of(s)[:, 2].mean() for s in surfaces]
    assert z_means[0] < z_means[1] < z_means[2]


def test_positions_are_scaled_by_grid_spacing():
    grid = Grid.from_shape((6, 6, 21), spacing=(0.1, 0.1, 0.1))

    surfaces, _ = isosurfaces(ramp_volume(), grid, levels=[-4000.0])

    assert verts_of(surfaces[0])[:, 2].mean() == pytest.approx(1.0, abs=1e-3)


def test_x_and_y_are_scaled_independently():
    """Anisotropic spacing catches an axis mix-up that isotropic would hide."""
    grid = Grid.from_shape((6, 6, 21), spacing=(1.0, 10.0, 1.0))

    surfaces, _ = isosurfaces(ramp_volume(), grid, levels=[-4000.0])

    verts = verts_of(surfaces[0])
    assert verts[:, 0].max() == pytest.approx(5.0, abs=1e-3)
    assert verts[:, 1].max() == pytest.approx(50.0, abs=1e-3)


# --- the zstride correction -------------------------------------------------


def test_zstride_does_not_move_the_surface_in_mm():
    """The headline correctness property: marching cubes returns indices in the
    STRIDED volume, so z must be multiplied by zstride before scaling. Without
    that, every surface collapses toward the anode as the stride grows."""
    grid = Grid.from_shape((6, 6, 41), spacing=(1.0, 1.0, 1.0))
    volume = ramp_volume((6, 6, 41))

    full, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=1)
    strided, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=4)

    assert verts_of(strided[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=0.5
    )


def test_zstride_two_matches_the_unstrided_position():
    grid = Grid.from_shape((6, 6, 21), spacing=(0.1, 0.1, 0.1))
    volume = ramp_volume()

    full, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=1)
    strided, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=2)

    assert verts_of(strided[0])[:, 2].mean() == pytest.approx(
        verts_of(full[0])[:, 2].mean(), abs=0.05
    )


def test_zstride_leaves_x_and_y_untouched():
    grid = unit_grid((6, 6, 41))
    volume = ramp_volume((6, 6, 41))

    full, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=1)
    strided, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=4)

    assert verts_of(strided[0])[:, 0].max() == pytest.approx(
        verts_of(full[0])[:, 0].max()
    )


def test_zstride_reduces_the_triangle_count():
    volume = ramp_volume((10, 10, 41))
    grid = unit_grid((10, 10, 41))

    full, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=1)
    strided, _ = isosurfaces(volume, grid, levels=[-4000.0], zstride=4)

    assert strided[0]["n_tris"] <= full[0]["n_tris"]


def test_invalid_zstride_is_rejected():
    for bad in (0, -1):
        with pytest.raises(ValueError, match="zstride must be >= 1"):
            isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0], zstride=bad)


# --- payload shape ----------------------------------------------------------


def test_surface_keys():
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    assert set(surfaces[0]) == {"level", "positions", "indices", "n_tris"}


def test_positions_are_a_flat_xyz_list():
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    positions = surfaces[0]["positions"]
    assert len(positions) % 3 == 0
    assert all(type(v) is float for v in positions)


def test_indices_are_triangles_of_plain_ints():
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    indices = surfaces[0]["indices"]
    assert len(indices) % 3 == 0
    assert all(type(i) is int for i in indices)


def test_n_tris_matches_the_index_count():
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    assert surfaces[0]["n_tris"] * 3 == len(surfaces[0]["indices"])


def test_every_index_is_in_range():
    """An out-of-range index would crash or render garbage in the browser."""
    surfaces, _ = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    n_verts = len(surfaces[0]["positions"]) // 3
    assert max(surfaces[0]["indices"]) < n_verts
    assert min(surfaces[0]["indices"]) >= 0


def test_positions_are_rounded_to_four_digits():
    grid = Grid.from_shape((6, 6, 21), spacing=(0.1, 0.1, 0.1))

    surfaces, _ = isosurfaces(ramp_volume(), grid, levels=[-4000.0])

    assert all(v == round(v, 4) for v in surfaces[0]["positions"])


def test_surfaces_are_json_serializable():
    surfaces, skipped = isosurfaces(ramp_volume(), unit_grid(), levels=[-4000.0])

    assert json.loads(json.dumps({"surfaces": surfaces, "skipped": skipped}))


def test_skipped_entries_are_plain_floats():
    _, skipped = isosurfaces(ramp_volume(), unit_grid(), levels=[99999.0])

    assert all(type(level) is float for level in skipped)


def test_source_array_is_not_modified():
    volume = ramp_volume()
    original = volume.copy()

    isosurfaces(volume, unit_grid(), levels=[-4000.0])

    np.testing.assert_array_equal(volume, original)


# --- grid origin ------------------------------------------------------------


def test_positions_apply_the_grid_origin():
    """Updated per this test's original instruction: isosurfaces used to scale
    by spacing without adding grid.origin, while boundary_groups did
    (ox + i0 * sx) and so does Grid.index_to_mm. Two index-to-mm conversions
    that disagree would put the equipotential sheets off the boundary planes in
    the same scene, so the origin is now applied here too."""
    origin = (100.0, 200.0, 300.0)
    shifted = Grid.from_shape((6, 6, 21), spacing=(1.0, 1.0, 1.0), origin=origin)

    surfaces, _ = isosurfaces(ramp_volume(), shifted, levels=[-4000.0])

    verts = verts_of(surfaces[0])
    assert verts[:, 0].min() == pytest.approx(origin[0])
    assert verts[:, 1].min() == pytest.approx(origin[1])
    assert verts[:, 2].mean() == pytest.approx(origin[2] + 10.0, abs=1e-3)


def test_the_default_origin_is_unchanged_by_the_origin_fix():
    """The reference dataset and the CLI only ever use origin (0, 0, 0), so the
    fix above must leave real output byte-identical."""
    plain = Grid.from_shape((6, 6, 21), spacing=(1.0, 1.0, 1.0))

    surfaces, _ = isosurfaces(ramp_volume(), plain, levels=[-4000.0])

    verts = verts_of(surfaces[0])
    assert verts[:, 0].min() == pytest.approx(0.0)
    assert verts[:, 2].mean() == pytest.approx(10.0, abs=1e-3)


def test_the_origin_agrees_with_boundary_groups():
    """The point of the fix: both converters must place index 0 at the origin."""
    origin = (100.0, 200.0, 300.0)
    shifted = Grid.from_shape((6, 6, 21), spacing=(1.0, 1.0, 1.0), origin=origin)

    assert shifted.index_to_mm((0, 0, 0)) == pytest.approx(origin)

    surfaces, _ = isosurfaces(ramp_volume(), shifted, levels=[-4000.0])
    verts = verts_of(surfaces[0])
    assert verts[:, 0].min() == pytest.approx(shifted.index_to_mm((0, 0, 0))[0])
    assert verts[:, 1].min() == pytest.approx(shifted.index_to_mm((0, 0, 0))[1])
