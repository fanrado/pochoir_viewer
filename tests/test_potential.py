"""Tests for pochoir_viewer.potential — loading and packing the drift potential."""

import numpy as np
import pytest

from pochoir_viewer.potential import load_potential, potential_stats, volume_float32


def write_npz(path, **arrays):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrays)
    return path


def ramp(shape=(4, 5, 6)):
    """A volume whose values are distinct, so reordering is detectable."""
    return np.arange(np.prod(shape), dtype=np.float64).reshape(shape)


# --- load_potential ---------------------------------------------------------


def test_load_potential_reads_the_potential_subdir(tmp_path):
    write_npz(tmp_path / "potential" / "drift3d.npz", drift3d=ramp())

    arr = load_potential(tmp_path)

    np.testing.assert_array_equal(arr, ramp())


def test_load_potential_accepts_the_plain_drift_spelling(tmp_path):
    """potential/ is one of the drift3d.npz dirs per the README, but both work."""
    write_npz(tmp_path / "potential" / "drift.npz", drift=ramp())

    assert load_potential(tmp_path).shape == (4, 5, 6)


def test_load_potential_accepts_str_root(tmp_path):
    write_npz(tmp_path / "potential" / "drift3d.npz", drift3d=ramp())

    assert load_potential(str(tmp_path)).shape == (4, 5, 6)


def test_load_potential_does_not_read_the_boundary_dir(tmp_path):
    """A boundary mask must never be mistaken for the potential."""
    write_npz(tmp_path / "boundary" / "drift.npz", drift=np.zeros((2, 2, 2)))

    with pytest.raises(FileNotFoundError):
        load_potential(tmp_path)


def test_load_potential_missing_names_both_candidates(tmp_path):
    (tmp_path / "potential").mkdir()

    with pytest.raises(FileNotFoundError) as excinfo:
        load_potential(tmp_path)

    message = str(excinfo.value)
    assert "drift3d.npz" in message
    assert "drift.npz" in message


def test_load_potential_preserves_dtype(tmp_path):
    write_npz(tmp_path / "potential" / "drift3d.npz", drift3d=ramp())

    assert load_potential(tmp_path).dtype == np.float64


# --- potential_stats --------------------------------------------------------


def test_stats_reports_the_value_range():
    arr = np.array([[[-5.0, 0.0], [2.5, 100.0]]])

    stats = potential_stats(arr)

    assert stats["vmin"] == pytest.approx(-5.0)
    assert stats["vmax"] == pytest.approx(100.0)


def test_stats_units_are_volts():
    assert potential_stats(np.zeros((2, 2, 2)))["units"] == "V"


def test_stats_keys():
    assert set(potential_stats(np.zeros(4))) == {"vmin", "vmax", "units"}


def test_stats_values_are_plain_floats():
    # numpy scalars are not JSON-serializable without a custom encoder.
    stats = potential_stats(np.zeros((2, 2), dtype=np.float32))

    assert type(stats["vmin"]) is float
    assert type(stats["vmax"]) is float


def test_stats_are_json_serializable():
    import json

    stats = potential_stats(ramp())

    assert json.loads(json.dumps(stats)) == stats


def test_stats_of_a_constant_volume_collapse_to_one_value():
    stats = potential_stats(np.full((3, 3, 3), 7.5))

    assert stats["vmin"] == stats["vmax"] == pytest.approx(7.5)


def test_stats_handle_negative_potentials():
    stats = potential_stats(np.linspace(-500.0, -1.0, 20))

    assert stats["vmin"] == pytest.approx(-500.0)
    assert stats["vmax"] == pytest.approx(-1.0)


def test_stats_of_an_empty_array_raises():
    # min/max of an empty array is undefined; failing beats emitting NaN bounds.
    with pytest.raises(ValueError):
        potential_stats(np.zeros((0, 4, 4)))


# --- volume_float32 ---------------------------------------------------------


def test_volume_is_float32():
    volume, _, _ = volume_float32(ramp())

    assert volume.dtype == np.float32


def test_volume_is_c_contiguous():
    """The browser reads the raw bytes as a Float32Array with no reordering."""
    volume, _, _ = volume_float32(ramp())

    assert volume.flags["C_CONTIGUOUS"]


def test_volume_from_a_fortran_array_is_still_c_contiguous():
    arr = np.asfortranarray(ramp())

    volume, _, _ = volume_float32(arr)

    assert volume.flags["C_CONTIGUOUS"]
    np.testing.assert_array_equal(volume, ramp())


def test_volume_from_a_sliced_view_is_contiguous():
    arr = ramp((8, 8, 8))[::2, ::2, :]

    volume, _, _ = volume_float32(arr)

    assert volume.flags["C_CONTIGUOUS"]
    np.testing.assert_array_equal(volume, arr)


def test_shape_is_returned_and_matches_the_volume():
    volume, shape, _ = volume_float32(ramp((4, 5, 6)))

    assert shape == (4, 5, 6)
    assert shape == volume.shape


def test_default_stride_keeps_every_layer():
    volume, shape, _ = volume_float32(ramp((4, 5, 6)))

    assert shape == (4, 5, 6)
    np.testing.assert_array_equal(volume, ramp((4, 5, 6)).astype(np.float32))


def test_stride_thins_only_the_z_axis():
    volume, shape, _ = volume_float32(ramp((4, 5, 6)), zstride=2)

    assert shape == (4, 5, 3)


def test_stride_keeps_the_first_layer():
    arr = ramp((2, 2, 7))

    volume, _, _ = volume_float32(arr, zstride=3)

    np.testing.assert_array_equal(volume[:, :, 0], arr[:, :, 0].astype(np.float32))


def test_stride_selects_every_nth_layer():
    arr = ramp((2, 2, 7))

    volume, _, _ = volume_float32(arr, zstride=3)

    np.testing.assert_array_equal(volume, arr[:, :, ::3].astype(np.float32))


def test_stride_larger_than_the_axis_keeps_one_layer():
    volume, shape, _ = volume_float32(ramp((3, 3, 4)), zstride=99)

    assert shape == (3, 3, 1)


def test_stride_of_the_dataset_shape():
    """(44, 44, 1601) at stride 4 -> 401 layers, ~3.1 MB of float32."""
    volume, shape, _ = volume_float32(np.zeros((44, 44, 1601)), zstride=4)

    assert shape == (44, 44, 401)
    assert volume.nbytes == 44 * 44 * 401 * 4


def test_byte_length_matches_the_shape():
    volume, shape, _ = volume_float32(ramp((4, 5, 6)), zstride=2)

    assert volume.nbytes == np.prod(shape) * 4


def test_bytes_round_trip_as_a_float32_array():
    """What the browser does: read the raw bytes back into the same volume."""
    arr = ramp((3, 4, 5))

    volume, shape, _ = volume_float32(arr)
    restored = np.frombuffer(volume.tobytes(), dtype="<f4").reshape(shape)

    np.testing.assert_array_equal(restored, arr.astype(np.float32))


def test_bytes_are_in_c_order_x_major():
    # Index (i, j, k) must land at i*ny*nz + j*nz + k, which is what the
    # browser's indexing assumes.
    arr = ramp((2, 3, 4))
    volume, (nx, ny, nz), _ = volume_float32(arr)
    flat = np.frombuffer(volume.tobytes(), dtype="<f4")

    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                assert flat[i * ny * nz + j * nz + k] == pytest.approx(arr[i, j, k])


def test_zstride_zero_is_rejected():
    with pytest.raises(ValueError, match="zstride must be >= 1"):
        volume_float32(ramp(), zstride=0)


def test_negative_zstride_is_rejected():
    # A negative stride would silently reverse the z axis.
    with pytest.raises(ValueError, match="zstride must be >= 1"):
        volume_float32(ramp(), zstride=-2)


def test_source_array_is_not_modified():
    arr = ramp()
    original = arr.copy()

    volume_float32(arr, zstride=2)

    np.testing.assert_array_equal(arr, original)


def test_float32_conversion_does_not_change_representable_values():
    arr = np.array([[[0.0, 0.5, -0.25, 1024.0]]])

    volume, _, _ = volume_float32(arr)

    np.testing.assert_array_equal(volume, arr.astype(np.float32))
