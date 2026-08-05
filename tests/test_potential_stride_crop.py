"""Tests for volume_float32's three-axis stride, z crop, and meta."""

import numpy as np
import pytest

from pochoir_viewer.potential import volume_float32


def ramp(shape=(8, 9, 10)):
    """Distinct values everywhere, so any mis-slicing shows."""
    return np.arange(np.prod(shape), dtype=np.float64).reshape(shape)


# --- three-axis stride ------------------------------------------------------


def test_default_stride_keeps_everything():
    _, shape, _ = volume_float32(ramp())

    assert shape == (8, 9, 10)


def test_each_component_thins_its_own_axis():
    _, shape, _ = volume_float32(ramp(), stride=(2, 3, 5))

    assert shape == (4, 3, 2)


def test_a_transverse_stride_leaves_z_alone():
    """The weighting-field case: thin x and y, keep full z resolution."""
    _, shape, _ = volume_float32(ramp(), stride=(2, 2, 1))

    assert shape == (4, 5, 10)


def test_striding_selects_every_nth_sample_on_each_axis():
    arr = ramp()

    volume, _, _ = volume_float32(arr, stride=(2, 3, 5))

    np.testing.assert_array_equal(volume, arr[::2, ::3, ::5].astype(np.float32))


def test_the_first_sample_of_every_axis_is_kept():
    arr = ramp()

    volume, _, _ = volume_float32(arr, stride=(3, 3, 3))

    assert volume[0, 0, 0] == pytest.approx(arr[0, 0, 0])


def test_a_stride_larger_than_an_axis_keeps_one_sample():
    _, shape, _ = volume_float32(ramp(), stride=(99, 99, 99))

    assert shape == (1, 1, 1)


def test_a_list_stride_is_accepted():
    _, shape, _ = volume_float32(ramp(), stride=[2, 1, 1])

    assert shape == (4, 9, 10)


def test_float_stride_components_are_coerced_to_int():
    _, shape, _ = volume_float32(ramp(), stride=(2.0, 1.0, 1.0))

    assert shape == (4, 9, 10)


def test_the_result_stays_c_contiguous_under_striding():
    volume, _, _ = volume_float32(ramp(), stride=(2, 3, 5))

    assert volume.flags["C_CONTIGUOUS"]
    assert volume.dtype == np.float32


def test_a_wrong_length_stride_is_rejected():
    with pytest.raises(ValueError, match="three components"):
        volume_float32(ramp(), stride=(2, 2))


def test_a_zero_stride_component_is_rejected():
    with pytest.raises(ValueError, match="every stride component must be >= 1"):
        volume_float32(ramp(), stride=(1, 0, 1))


def test_a_negative_stride_component_is_rejected():
    # A negative stride would silently reverse that axis.
    with pytest.raises(ValueError, match="every stride component must be >= 1"):
        volume_float32(ramp(), stride=(1, 1, -2))


def test_each_axis_is_checked_for_a_bad_stride():
    for bad in [(0, 1, 1), (1, 0, 1), (1, 1, 0)]:
        with pytest.raises(ValueError, match="every stride component"):
            volume_float32(ramp(), stride=bad)


# --- zstride remains the Phase 8 spelling -----------------------------------


def test_zstride_maps_to_the_z_component():
    by_zstride, shape_a, _ = volume_float32(ramp(), zstride=5)
    by_stride, shape_b, _ = volume_float32(ramp(), stride=(1, 1, 5))

    assert shape_a == shape_b
    np.testing.assert_array_equal(by_zstride, by_stride)


def test_zstride_one_is_still_a_real_argument():
    """zstride=1 must not be mistaken for 'not supplied'."""
    _, shape, meta = volume_float32(ramp(), zstride=1)

    assert shape == (8, 9, 10)
    assert meta["stride"] == [1, 1, 1]


def test_combining_zstride_and_stride_raises():
    with pytest.raises(ValueError, match="not both"):
        volume_float32(ramp(), stride=(2, 1, 1), zstride=4)


def test_the_conflict_message_shows_both_values():
    with pytest.raises(ValueError) as excinfo:
        volume_float32(ramp(), stride=(2, 1, 1), zstride=4)

    message = str(excinfo.value)
    assert "zstride=4" in message
    assert "(2, 1, 1)" in message


def test_zstride_with_an_explicit_identity_stride_is_allowed():
    # stride=(1,1,1) is the default, so this is not a real conflict.
    _, shape, _ = volume_float32(ramp(), stride=(1, 1, 1), zstride=5)

    assert shape == (8, 9, 2)


def test_a_bad_zstride_is_reported_in_the_zstride_spelling():
    """Errors must name the argument the caller actually passed."""
    with pytest.raises(ValueError, match="zstride must be >= 1"):
        volume_float32(ramp(), zstride=0)


def test_a_bad_stride_is_not_reported_as_zstride():
    with pytest.raises(ValueError) as excinfo:
        volume_float32(ramp(), stride=(1, 1, 0))

    assert "zstride" not in str(excinfo.value)


# --- the z crop -------------------------------------------------------------


def test_zmax_crops_the_z_axis():
    _, shape, _ = volume_float32(ramp(), zmax=4)

    assert shape == (8, 9, 4)


def test_zmax_is_exclusive():
    arr = ramp()

    volume, _, _ = volume_float32(arr, zmax=4)

    np.testing.assert_array_equal(volume, arr[:, :, :4].astype(np.float32))


def test_zmax_beyond_the_array_clamps_rather_than_raising():
    """Documented behaviour: an over-long crop is not an error."""
    _, shape, _ = volume_float32(ramp(), zmax=9999)

    assert shape == (8, 9, 10)


def test_zmax_none_keeps_the_whole_axis():
    _, shape, _ = volume_float32(ramp(), zmax=None)

    assert shape == (8, 9, 10)


def test_zmax_zero_yields_an_empty_z_axis():
    _, shape, _ = volume_float32(ramp(), zmax=0)

    assert shape == (8, 9, 0)


def test_crop_and_stride_compose_in_the_documented_order():
    # Crop to [0, zmax) first, then take every stride[2]-th sample of that.
    arr = ramp()

    volume, shape, _ = volume_float32(arr, stride=(1, 1, 3), zmax=7)

    np.testing.assert_array_equal(volume, arr[:, :, :7:3].astype(np.float32))
    assert shape == (8, 9, 3)


def test_crop_does_not_touch_x_or_y():
    _, shape, _ = volume_float32(ramp(), zmax=2)

    assert shape[:2] == (8, 9)


def test_the_weighting_field_case():
    """310 MB at full resolution; crop past z 265 and thin transversely."""
    arr = np.zeros((44, 44, 1601), dtype=np.float64)

    _, shape, _ = volume_float32(arr, stride=(2, 2, 1), zmax=265)

    assert shape == (22, 22, 265)


# --- meta -------------------------------------------------------------------


def test_meta_keys():
    _, _, meta = volume_float32(ramp())

    assert set(meta) == {"stride", "zmax", "mm_factors"}


def test_meta_records_the_stride_as_a_list():
    _, _, meta = volume_float32(ramp(), stride=(2, 3, 5))

    assert meta["stride"] == [2, 3, 5]
    assert all(type(s) is int for s in meta["stride"])


def test_meta_records_the_stride_from_the_zstride_spelling():
    _, _, meta = volume_float32(ramp(), zstride=4)

    assert meta["stride"] == [1, 1, 4]


def test_meta_records_the_crop():
    _, _, meta = volume_float32(ramp(), zmax=265)

    assert meta["zmax"] == 265


def test_meta_zmax_is_none_when_uncropped():
    _, _, meta = volume_float32(ramp())

    assert meta["zmax"] is None


def test_mm_factors_are_none_without_spacing():
    # grid.py owns the 0.1 mm default; this function must not invent one.
    _, _, meta = volume_float32(ramp())

    assert meta["mm_factors"] is None


def test_mm_factors_multiply_stride_by_spacing():
    _, _, meta = volume_float32(ramp(), stride=(2, 3, 5), spacing=(0.1, 0.1, 0.1))

    assert meta["mm_factors"] == pytest.approx([0.2, 0.3, 0.5])


def test_mm_factors_follow_anisotropic_spacing():
    _, _, meta = volume_float32(ramp(), stride=(1, 1, 1), spacing=(0.1, 0.2, 0.4))

    assert meta["mm_factors"] == pytest.approx([0.1, 0.2, 0.4])


def test_mm_factors_are_the_step_between_kept_samples():
    """The invariant: sample n of the output sits at n * mm_factor in mm."""
    spacing = (0.1, 0.1, 0.1)
    stride = (2, 3, 5)

    _, _, meta = volume_float32(ramp(), stride=stride, spacing=spacing)

    for axis in range(3):
        assert meta["mm_factors"][axis] == pytest.approx(stride[axis] * spacing[axis])


def test_meta_is_json_serializable():
    import json

    _, _, meta = volume_float32(ramp(), stride=(2, 2, 1), zmax=5, spacing=(0.1, 0.1, 0.1))

    assert json.loads(json.dumps(meta)) == meta


def test_meta_survives_a_zstride_of_one_with_spacing():
    _, _, meta = volume_float32(ramp(), zstride=1, spacing=(0.1, 0.1, 0.1))

    assert meta["mm_factors"] == pytest.approx([0.1, 0.1, 0.1])


# --- unchanged guarantees ---------------------------------------------------


def test_the_source_array_is_never_modified():
    arr = ramp()
    original = arr.copy()

    volume_float32(arr, stride=(2, 2, 2), zmax=5, spacing=(0.1, 0.1, 0.1))

    np.testing.assert_array_equal(arr, original)


def test_byte_length_still_matches_the_shape():
    volume, shape, _ = volume_float32(ramp(), stride=(2, 3, 1), zmax=6)

    assert volume.nbytes == np.prod(shape) * 4


def test_bytes_are_still_in_c_order_after_striding_and_cropping():
    # The browser indexes (i, j, k) at i*ny*nz + j*nz + k regardless of stride.
    arr = ramp((6, 6, 6))

    volume, (nx, ny, nz), _ = volume_float32(arr, stride=(2, 3, 1), zmax=4)
    flat = np.frombuffer(volume.tobytes(), dtype="<f4")
    expected = arr[::2, ::3, :4]

    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                assert flat[i * ny * nz + j * nz + k] == pytest.approx(expected[i, j, k])
