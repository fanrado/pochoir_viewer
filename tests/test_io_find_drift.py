"""Tests for pochoir_viewer.io.find_drift — accepting either drift spelling."""

import numpy as np
import pytest

from pochoir_viewer.io import (
    DRIFT_ENDTAG_NAMES,
    DRIFT_FIELD_NAMES,
    find_drift,
    load_npz,
)


def write_npz(path, **arrays):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrays)
    return path


# --- resolution -------------------------------------------------------------


def test_finds_drift3d(tmp_path):
    expected = write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(3))

    assert find_drift(tmp_path, "paths") == expected


def test_finds_plain_drift(tmp_path):
    expected = write_npz(tmp_path / "boundary" / "drift.npz", drift=np.zeros(3))

    assert find_drift(tmp_path, "boundary") == expected


def test_drift3d_wins_when_both_spellings_are_present(tmp_path):
    write_npz(tmp_path / "paths" / "drift.npz", drift=np.zeros(3))
    expected = write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(3))

    assert find_drift(tmp_path, "paths") == expected


def test_precedence_follows_the_declared_order(tmp_path):
    # The constant is the contract; the first listed name must win.
    for name in DRIFT_FIELD_NAMES:
        write_npz(tmp_path / "paths" / name, a=np.zeros(1))

    assert find_drift(tmp_path, "paths").name == DRIFT_FIELD_NAMES[0]


def test_accepts_str_root(tmp_path):
    expected = write_npz(tmp_path / "boundary" / "drift.npz", drift=np.zeros(3))

    assert find_drift(str(tmp_path), "boundary") == expected


def test_result_is_loadable(tmp_path):
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.ones((2, 3)))

    key, arr = load_npz(find_drift(tmp_path, "paths"))

    assert key == "drift3d"
    assert arr.shape == (2, 3)


def test_subdirectories_are_resolved_independently(tmp_path):
    write_npz(tmp_path / "boundary" / "drift.npz", drift=np.zeros(1))
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(1))

    assert find_drift(tmp_path, "boundary").name == "drift.npz"
    assert find_drift(tmp_path, "paths").name == "drift3d.npz"


def test_nested_subdir_path_is_accepted(tmp_path):
    expected = write_npz(tmp_path / "run1" / "paths" / "drift3d.npz", drift3d=np.zeros(1))

    assert find_drift(tmp_path, "run1/paths") == expected


# --- endtag kind ------------------------------------------------------------


def test_finds_drift3d_endtag(tmp_path):
    expected = write_npz(
        tmp_path / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(3)
    )

    assert find_drift(tmp_path, "paths", kind="endtag") == expected


def test_finds_plain_drift_endtag(tmp_path):
    expected = write_npz(
        tmp_path / "paths" / "drift_endtag.npz", drift_endtag=np.zeros(3)
    )

    assert find_drift(tmp_path, "paths", kind="endtag") == expected


def test_endtag_precedence(tmp_path):
    for name in DRIFT_ENDTAG_NAMES:
        write_npz(tmp_path / "paths" / name, a=np.zeros(1))

    assert find_drift(tmp_path, "paths", kind="endtag").name == DRIFT_ENDTAG_NAMES[0]


def test_field_default_is_the_field_kind(tmp_path):
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(1))
    write_npz(tmp_path / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(1))

    assert find_drift(tmp_path, "paths") == find_drift(tmp_path, "paths", kind="field")


# --- the exact-match guarantee ----------------------------------------------


def test_endtag_is_not_mistaken_for_the_field(tmp_path):
    """A drift*.npz glob would match drift3d_endtag.npz — it must not."""
    write_npz(
        tmp_path / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(3)
    )

    with pytest.raises(FileNotFoundError):
        find_drift(tmp_path, "paths")


def test_field_is_not_mistaken_for_the_endtag(tmp_path):
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(3))

    with pytest.raises(FileNotFoundError):
        find_drift(tmp_path, "paths", kind="endtag")


def test_unrelated_drift_prefixed_file_is_not_matched(tmp_path):
    """The docstring names drift_insulator.npz as the glob hazard."""
    write_npz(tmp_path / "initial" / "drift_insulator.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError):
        find_drift(tmp_path, "initial")


def test_a_directory_named_like_the_file_is_not_accepted(tmp_path):
    (tmp_path / "paths" / "drift3d.npz").mkdir(parents=True)

    with pytest.raises(FileNotFoundError):
        find_drift(tmp_path, "paths")


# --- errors -----------------------------------------------------------------


def test_missing_file_lists_what_was_tried_and_what_is_there(tmp_path):
    write_npz(tmp_path / "paths" / "other.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError) as excinfo:
        find_drift(tmp_path, "paths")

    message = str(excinfo.value)
    assert "drift3d.npz" in message  # tried
    assert "drift.npz" in message  # tried
    assert "other.npz" in message  # found
    assert "paths" in message


def test_missing_directory_raises_filenotfound(tmp_path):
    with pytest.raises(FileNotFoundError):
        find_drift(tmp_path, "absent")


def test_empty_directory_reports_an_empty_listing(tmp_path):
    (tmp_path / "paths").mkdir()

    with pytest.raises(FileNotFoundError) as excinfo:
        find_drift(tmp_path, "paths")

    assert "[]" in str(excinfo.value)


def test_unknown_kind_raises_valueerror(tmp_path):
    with pytest.raises(ValueError, match="unknown drift kind"):
        find_drift(tmp_path, "paths", kind="velocity")


def test_unknown_kind_lists_the_valid_kinds(tmp_path):
    with pytest.raises(ValueError) as excinfo:
        find_drift(tmp_path, "paths", kind="velocity")

    message = str(excinfo.value)
    assert "field" in message
    assert "endtag" in message


def test_unknown_kind_is_checked_before_the_filesystem(tmp_path):
    """A bad kind is a programming error and must not surface as FileNotFound."""
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.zeros(1))

    with pytest.raises(ValueError):
        find_drift(tmp_path, "paths", kind="nope")


def test_unknown_kind_does_not_chain_a_keyerror(tmp_path):
    with pytest.raises(ValueError) as excinfo:
        find_drift(tmp_path, "paths", kind="velocity")

    assert excinfo.value.__cause__ is None
