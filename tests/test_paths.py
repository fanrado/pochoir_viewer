"""Tests for pochoir_viewer.paths — loading, trimming, decimation, summaries."""

import numpy as np
import pytest

from pochoir_viewer.paths import decimate, load_paths, path_summaries, trim_stagnant


def ramp(n, start=(0.0, 0.0, 100.0), step=(0.0, 0.0, -1.0)):
    """A straight moving path of `n` points."""
    return np.array(start) + np.arange(n)[:, None] * np.array(step)


def with_stagnant_tail(n_moving, n_repeat):
    """A moving path whose final point is then repeated `n_repeat` extra times."""
    moving = ramp(n_moving)
    return np.concatenate([moving, np.repeat(moving[-1:], n_repeat, axis=0)])


# --- load_paths -------------------------------------------------------------


@pytest.fixture
def dataset_root(tmp_path):
    paths_dir = tmp_path / "paths"
    paths_dir.mkdir()
    np.savez(paths_dir / "drift3d.npz", drift3d=np.ones((3, 7, 3)))
    np.savez(paths_dir / "drift3d_endtag.npz", drift3d_endtag=np.zeros(3))
    return tmp_path


def test_load_paths_returns_both_arrays(dataset_root):
    paths, endtags = load_paths(dataset_root)

    assert paths.shape == (3, 7, 3)
    assert endtags.shape == (3,)


def test_load_paths_accepts_str_root(dataset_root):
    paths, endtags = load_paths(str(dataset_root))

    assert paths.shape == (3, 7, 3)
    assert endtags.shape == (3,)


def test_load_paths_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_paths(tmp_path)


# --- trim_stagnant ----------------------------------------------------------


def test_trim_drops_repeated_tail_keeping_one_final_point():
    path = with_stagnant_tail(n_moving=10, n_repeat=90)

    trimmed = trim_stagnant(path)

    assert len(trimmed) == 10
    np.testing.assert_array_equal(trimmed, ramp(10))


def test_trim_preserves_a_path_that_never_stagnates():
    path = ramp(50)

    np.testing.assert_array_equal(trim_stagnant(path), path)


def test_trim_keeps_the_true_final_point():
    path = with_stagnant_tail(n_moving=6, n_repeat=20)

    np.testing.assert_array_equal(trim_stagnant(path)[-1], path[-1])


def test_trim_of_a_fully_stagnant_path_returns_two_points():
    """A drift that never moved still needs two points to draw a segment."""
    path = np.repeat(np.array([[1.0, 2.0, 3.0]]), 40, axis=0)

    trimmed = trim_stagnant(path)

    assert trimmed.shape == (2, 3)
    np.testing.assert_array_equal(trimmed[0], trimmed[1])


def test_trim_single_point_path_is_returned_unchanged():
    path = np.array([[1.0, 2.0, 3.0]])

    np.testing.assert_array_equal(trim_stagnant(path), path)


def test_trim_empty_path_is_returned_unchanged():
    path = np.zeros((0, 3))

    assert trim_stagnant(path).shape == (0, 3)


def test_trim_two_point_path_that_moves_is_unchanged():
    path = ramp(2)

    np.testing.assert_array_equal(trim_stagnant(path), path)


def test_trim_eps_treats_subthreshold_motion_as_stagnant():
    """Jitter below eps is tail, not motion."""
    path = np.concatenate([ramp(4), ramp(4)[-1:] + 1e-12])

    trimmed = trim_stagnant(path, eps=1e-9)

    assert len(trimmed) == 4


def test_trim_eps_is_configurable():
    path = np.concatenate([ramp(4), ramp(4)[-1:] + 1e-3])

    assert len(trim_stagnant(path, eps=1e-9)) == 5
    assert len(trim_stagnant(path, eps=1e-1)) == 4


def test_trim_matches_the_dataset_shape():
    """Real paths are (4000, 3) with a long stagnant tail."""
    path = with_stagnant_tail(n_moving=1500, n_repeat=2500)

    trimmed = trim_stagnant(path)

    assert trimmed.shape == (1500, 3)


# --- decimate ---------------------------------------------------------------


def test_decimate_leaves_short_paths_untouched():
    path = ramp(10)

    np.testing.assert_array_equal(decimate(path, max_points=400), path)


def test_decimate_at_exactly_max_points_is_untouched():
    path = ramp(400)

    np.testing.assert_array_equal(decimate(path, max_points=400), path)


def test_decimate_respects_the_cap():
    path = ramp(4000)

    assert len(decimate(path, max_points=400)) <= 400


def test_decimate_keeps_both_endpoints():
    path = ramp(4000)

    thinned = decimate(path, max_points=400)

    np.testing.assert_array_equal(thinned[0], path[0])
    np.testing.assert_array_equal(thinned[-1], path[-1])


def test_decimate_preserves_order_and_uniqueness():
    path = ramp(1000)

    z = decimate(path, max_points=50)[:, 2]

    assert np.all(np.diff(z) < 0)  # strictly monotonic: sorted and no duplicates


def test_decimate_result_is_a_subset_of_the_original():
    path = ramp(1000)

    thinned = decimate(path, max_points=37)

    for point in thinned:
        assert np.any(np.all(path == point, axis=1))


def test_decimate_max_points_two_gives_the_endpoints():
    path = ramp(100)

    thinned = decimate(path, max_points=2)

    np.testing.assert_array_equal(thinned, path[[0, -1]])


@pytest.mark.parametrize("max_points", [2, 3, 17, 100, 399])
def test_decimate_cap_holds_across_sizes(max_points):
    thinned = decimate(ramp(4000), max_points=max_points)

    assert 2 <= len(thinned) <= max_points


# --- path_summaries ---------------------------------------------------------


def test_summaries_one_record_per_path():
    paths = np.stack([with_stagnant_tail(5, 15) for _ in range(4)])

    summaries = path_summaries(paths, np.zeros(4))

    assert len(summaries) == 4
    assert [s["id"] for s in summaries] == [0, 1, 2, 3]


def test_summary_fields_reflect_the_trimmed_path():
    paths = np.stack([with_stagnant_tail(n_moving=7, n_repeat=93)])

    (summary,) = path_summaries(paths, np.zeros(1))

    assert summary["n_steps"] == 7  # trimmed, not the raw 100
    assert summary["start"] == [0.0, 0.0, 100.0]
    assert summary["end"] == [0.0, 0.0, 94.0]
    assert summary["z_travel"] == pytest.approx(6.0)


def test_z_travel_is_start_minus_end():
    path = ramp(11, start=(0.0, 0.0, 159.9), step=(0.0, 0.0, -1.0))

    (summary,) = path_summaries(np.stack([path]), np.zeros(1))

    assert summary["z_travel"] == pytest.approx(159.9 - 149.9)


def test_z_travel_is_negative_when_z_increases():
    path = ramp(5, start=(0.0, 0.0, 0.0), step=(0.0, 0.0, 1.0))

    (summary,) = path_summaries(np.stack([path]), np.zeros(1))

    assert summary["z_travel"] == pytest.approx(-4.0)


def test_endtag_is_carried_through():
    paths = np.stack([ramp(4), ramp(4)])

    summaries = path_summaries(paths, np.array([0.0, 2.0]))

    assert [s["endtag"] for s in summaries] == [0.0, 2.0]


def test_summary_values_are_plain_python_types():
    (summary,) = path_summaries(np.stack([ramp(4)]), np.zeros(1))

    assert type(summary["id"]) is int
    assert type(summary["n_steps"]) is int
    assert type(summary["z_travel"]) is float
    assert type(summary["endtag"]) is float
    assert all(type(v) is float for v in summary["start"] + summary["end"])


def test_summaries_are_json_serializable():
    import json

    summaries = path_summaries(np.stack([with_stagnant_tail(5, 5)] * 3), np.zeros(3))

    assert json.loads(json.dumps(summaries)) == summaries


def test_summary_keys_are_the_documented_six():
    (summary,) = path_summaries(np.stack([ramp(4)]), np.zeros(1))

    assert set(summary) == {"id", "start", "end", "n_steps", "z_travel", "endtag"}


def test_summaries_handle_a_fully_stagnant_path():
    stagnant = np.repeat(np.array([[1.0, 2.0, 3.0]]), 10, axis=0)

    (summary,) = path_summaries(np.stack([stagnant]), np.zeros(1))

    assert summary["n_steps"] == 2
    assert summary["z_travel"] == pytest.approx(0.0)
    assert summary["start"] == summary["end"]
