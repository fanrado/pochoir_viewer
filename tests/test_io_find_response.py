"""Tests for pochoir_viewer.io.find_response — the one globbing resolver.

7e4b5cb states the exception plainly: every other pochoir array has a name
fixed by the tool and is matched exactly, but the response stem encodes the run
configuration and cannot be known in advance. So the glob has to be paid for by
being tight -- top level only, and loud rather than arbitrary when the answer
is not unique. That is what these pin.
"""

import numpy as np
import pytest

from pochoir_viewer.io import find_response

REFERENCE_STEM = "fr_4p4pitch_3.8pix_nogrid_10pathsperpixel.npy"


def touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, np.zeros((4, 4)))
    # np.save appends .npy if absent; write through the exact name we asked for.
    return path


# --- the happy path ----------------------------------------------------------


def test_finds_the_reference_stem(tmp_path):
    expected = touch(tmp_path / REFERENCE_STEM)

    assert find_response(tmp_path) == expected


def test_finds_an_arbitrary_stem(tmp_path):
    # The whole reason for the glob: the configuration in the stem is unknown.
    expected = touch(tmp_path / "fr_someothergeometry_2pathsperpixel.npy")

    assert find_response(tmp_path) == expected


def test_accepts_a_string_root(tmp_path):
    expected = touch(tmp_path / REFERENCE_STEM)

    assert find_response(str(tmp_path)) == expected


def test_the_bare_prefix_is_enough(tmp_path):
    expected = touch(tmp_path / "fr_.npy")

    assert find_response(tmp_path) == expected


# --- nothing to find ---------------------------------------------------------


def test_missing_response_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError, match="no field-response"):
        find_response(tmp_path)


def test_the_missing_message_names_the_directory_searched(tmp_path):
    # Without the path the error cannot be acted on: the usual cause is being
    # pointed at the wrong run directory.
    with pytest.raises(FileNotFoundError, match=str(tmp_path)):
        find_response(tmp_path)


def test_a_missing_root_raises_rather_than_reporting_no_matches(tmp_path):
    # Path.glob on a nonexistent directory yields nothing, so this would
    # otherwise be indistinguishable from an empty run directory.
    with pytest.raises((FileNotFoundError, NotADirectoryError)):
        find_response(tmp_path / "no-such-run")


# --- the near misses that must not match -------------------------------------


def test_a_response_in_a_subdirectory_is_not_found(tmp_path):
    # glob, never rglob: the stated tightening. A response buried under
    # current/ or domain/ is not the top-level one the viewer wants.
    touch(tmp_path / "current" / REFERENCE_STEM)

    with pytest.raises(FileNotFoundError):
        find_response(tmp_path)


def test_the_prefix_must_be_fr_underscore(tmp_path):
    for name in ("frame_response.npy", "response.npy", "f_r.npy", "FR_upper.npy"):
        touch(tmp_path / name)

    with pytest.raises(FileNotFoundError):
        find_response(tmp_path)


def test_an_npz_is_not_a_response(tmp_path):
    # The response is a bare array; an fr_*.npz would be a different file.
    (tmp_path / "fr_something.npz").write_bytes(b"")

    with pytest.raises(FileNotFoundError):
        find_response(tmp_path)


def test_a_matching_directory_is_not_mistaken_for_the_file(tmp_path):
    (tmp_path / "fr_olddir.npy").mkdir()

    with pytest.raises(FileNotFoundError):
        find_response(tmp_path)


# --- ambiguity is refused, not resolved --------------------------------------


def test_two_candidates_raise_value_error(tmp_path):
    touch(tmp_path / "fr_a.npy")
    touch(tmp_path / "fr_b.npy")

    with pytest.raises(ValueError, match="ambiguous field response"):
        find_response(tmp_path)


def test_the_ambiguous_message_lists_every_candidate(tmp_path):
    # Listing them is the difference between an error and an actionable one:
    # the user has to know which files to move.
    for name in ("fr_a.npy", "fr_b.npy", "fr_c.npy"):
        touch(tmp_path / name)

    with pytest.raises(ValueError) as excinfo:
        find_response(tmp_path)

    message = str(excinfo.value)
    assert "3 candidates" in message
    for name in ("fr_a.npy", "fr_b.npy", "fr_c.npy"):
        assert name in message


def test_ambiguity_is_not_silently_resolved_to_the_first(tmp_path):
    # The failure mode the ValueError exists to prevent: picking one and
    # plotting waveforms from a run the user did not mean.
    touch(tmp_path / "fr_a.npy")
    touch(tmp_path / "fr_b.npy")

    with pytest.raises(ValueError):
        find_response(tmp_path)


def test_a_subdirectory_copy_does_not_create_ambiguity(tmp_path):
    # Only the top level counts, so a stashed copy underneath is harmless
    # rather than a hard error.
    expected = touch(tmp_path / REFERENCE_STEM)
    touch(tmp_path / "old" / "fr_previous_run.npy")

    assert find_response(tmp_path) == expected
