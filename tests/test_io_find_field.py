"""Tests for pochoir_viewer.io.find_field — the generalised npz resolver."""

import numpy as np
import pytest

from pochoir_viewer.io import (
    DRIFT_ENDTAG_NAMES,
    DRIFT_FIELD_NAMES,
    WEIGHT_FIELD_NAMES,
    find_drift,
    find_field,
    load_npz,
)


def write_npz(path, **arrays):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrays)
    return path


# --- the weighting field ----------------------------------------------------


def test_finds_weight3d(tmp_path):
    expected = write_npz(tmp_path / "weight" / "weight3d.npz", weight3d=np.zeros(3))

    assert find_field(tmp_path, "weight", field="weight") == expected


def test_finds_plain_weight(tmp_path):
    expected = write_npz(tmp_path / "weight" / "weight.npz", weight=np.zeros(3))

    assert find_field(tmp_path, "weight", field="weight") == expected


def test_weight3d_wins_when_both_spellings_are_present(tmp_path):
    write_npz(tmp_path / "weight" / "weight.npz", weight=np.zeros(3))
    expected = write_npz(tmp_path / "weight" / "weight3d.npz", weight3d=np.zeros(3))

    assert find_field(tmp_path, "weight", field="weight") == expected


def test_weight_precedence_follows_the_declared_order(tmp_path):
    # The constant is the contract; the first listed name must win.
    for name in WEIGHT_FIELD_NAMES:
        write_npz(tmp_path / "weight" / name, a=np.zeros(1))

    got = find_field(tmp_path, "weight", field="weight")

    assert got.name == WEIGHT_FIELD_NAMES[0]


def test_weight_result_is_loadable(tmp_path):
    write_npz(tmp_path / "weight" / "weight3d.npz", weight3d=np.ones((2, 3)))

    key, arr = load_npz(find_field(tmp_path, "weight", field="weight"))

    assert key == "weight3d"
    assert arr.shape == (2, 3)


def test_weight_accepts_str_root(tmp_path):
    expected = write_npz(tmp_path / "weight" / "weight.npz", weight=np.zeros(1))

    assert find_field(str(tmp_path), "weight", field="weight") == expected


def test_weight_can_live_in_any_subdir(tmp_path):
    expected = write_npz(tmp_path / "run1" / "w" / "weight3d.npz", weight3d=np.zeros(1))

    assert find_field(tmp_path, "run1/w", field="weight") == expected


# --- the two fields do not shadow each other --------------------------------


def test_a_drift_array_is_not_accepted_as_the_weight(tmp_path):
    write_npz(tmp_path / "d" / "drift3d.npz", drift3d=np.zeros(3))

    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "d", field="weight")


def test_a_weight_array_is_not_accepted_as_the_drift(tmp_path):
    write_npz(tmp_path / "w" / "weight3d.npz", weight3d=np.zeros(3))

    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "w", field="drift")


def test_both_fields_resolve_independently_in_one_directory(tmp_path):
    drift = write_npz(tmp_path / "d" / "drift3d.npz", drift3d=np.zeros(1))
    weight = write_npz(tmp_path / "d" / "weight.npz", weight=np.zeros(1))

    assert find_field(tmp_path, "d", field="drift") == drift
    assert find_field(tmp_path, "d", field="weight") == weight


# --- the exact-match guarantee, extended to weight --------------------------


def test_weight_insulator_is_not_matched(tmp_path):
    """The docstring names weight_insulator.npz as the glob hazard."""
    write_npz(tmp_path / "initial" / "weight_insulator.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "initial", field="weight")


def test_a_weight_endtag_lookalike_is_not_matched(tmp_path):
    write_npz(tmp_path / "w" / "weight3d_endtag.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "w", field="weight")


def test_a_directory_named_like_the_weight_file_is_rejected(tmp_path):
    (tmp_path / "w" / "weight3d.npz").mkdir(parents=True)

    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "w", field="weight")


# --- kinds ------------------------------------------------------------------


def test_the_weighting_field_has_no_endtag(tmp_path):
    """Only drift has an endtag; asking for one must be a programming error."""
    write_npz(tmp_path / "w" / "weight3d.npz", weight3d=np.zeros(1))

    with pytest.raises(ValueError, match="unknown weight kind"):
        find_field(tmp_path, "w", field="weight", kind="endtag")


def test_the_weight_kind_error_lists_only_field(tmp_path):
    with pytest.raises(ValueError) as excinfo:
        find_field(tmp_path, "w", field="weight", kind="endtag")

    message = str(excinfo.value)
    assert "'field'" in message
    assert "endtag" not in message.split("expected")[1]


def test_drift_still_has_both_kinds(tmp_path):
    field = write_npz(tmp_path / "p" / "drift3d.npz", drift3d=np.zeros(1))
    endtag = write_npz(tmp_path / "p" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(1))

    assert find_field(tmp_path, "p", field="drift", kind="field") == field
    assert find_field(tmp_path, "p", field="drift", kind="endtag") == endtag


def test_unknown_field_raises_valueerror(tmp_path):
    with pytest.raises(ValueError, match="unknown field"):
        find_field(tmp_path, "x", field="velocity")


def test_unknown_field_lists_the_valid_fields(tmp_path):
    with pytest.raises(ValueError) as excinfo:
        find_field(tmp_path, "x", field="velocity")

    message = str(excinfo.value)
    assert "drift" in message
    assert "weight" in message


def test_the_field_is_validated_before_the_kind(tmp_path):
    # Both are wrong; the message must name the field, the outer error.
    with pytest.raises(ValueError, match="unknown field"):
        find_field(tmp_path, "x", field="velocity", kind="nonsense")


def test_field_and_kind_are_checked_before_the_filesystem(tmp_path):
    write_npz(tmp_path / "d" / "drift3d.npz", drift3d=np.zeros(1))

    with pytest.raises(ValueError):
        find_field(tmp_path, "d", field="velocity")
    with pytest.raises(ValueError):
        find_field(tmp_path, "d", field="drift", kind="nope")


def test_neither_error_chains_a_keyerror(tmp_path):
    for kwargs in ({"field": "velocity"}, {"field": "drift", "kind": "nope"}):
        with pytest.raises(ValueError) as excinfo:
            find_field(tmp_path, "x", **kwargs)
        assert excinfo.value.__cause__ is None


# --- error reporting --------------------------------------------------------


def test_the_missing_message_names_the_field_and_kind(tmp_path):
    write_npz(tmp_path / "w" / "other.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError) as excinfo:
        find_field(tmp_path, "w", field="weight")

    message = str(excinfo.value)
    assert "weight" in message
    assert "field" in message


def test_the_missing_message_lists_tried_and_found(tmp_path):
    write_npz(tmp_path / "w" / "other.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError) as excinfo:
        find_field(tmp_path, "w", field="weight")

    message = str(excinfo.value)
    for name in WEIGHT_FIELD_NAMES:
        assert name in message
    assert "other.npz" in message


def test_a_missing_directory_raises_filenotfound(tmp_path):
    with pytest.raises(FileNotFoundError):
        find_field(tmp_path, "absent", field="weight")


# --- find_drift remains a working alias -------------------------------------


def test_find_drift_still_resolves_the_field(tmp_path):
    expected = write_npz(tmp_path / "p" / "drift3d.npz", drift3d=np.zeros(1))

    assert find_drift(tmp_path, "p") == expected


def test_find_drift_still_resolves_the_endtag(tmp_path):
    expected = write_npz(tmp_path / "p" / "drift_endtag.npz", drift_endtag=np.zeros(1))

    assert find_drift(tmp_path, "p", kind="endtag") == expected


def test_find_drift_matches_find_field_exactly(tmp_path):
    write_npz(tmp_path / "p" / "drift3d.npz", drift3d=np.zeros(1))

    assert find_drift(tmp_path, "p") == find_field(tmp_path, "p", field="drift")


def test_find_drift_still_rejects_an_unknown_kind(tmp_path):
    with pytest.raises(ValueError, match="unknown drift kind"):
        find_drift(tmp_path, "p", kind="velocity")


def test_find_drift_error_message_is_unchanged_in_shape(tmp_path):
    """Callers and earlier tests match on this wording."""
    (tmp_path / "p").mkdir()

    with pytest.raises(FileNotFoundError) as excinfo:
        find_drift(tmp_path, "p")

    message = str(excinfo.value)
    assert "drift" in message
    for name in DRIFT_FIELD_NAMES:
        assert name in message


def test_the_drift_constants_are_still_exported():
    assert DRIFT_FIELD_NAMES[0] == "drift3d.npz"
    assert DRIFT_ENDTAG_NAMES[0] == "drift3d_endtag.npz"
    assert WEIGHT_FIELD_NAMES[0] == "weight3d.npz"


def test_every_field_prefers_the_explicitly_3d_name():
    # The stated precedence rule, checked across all three name tuples.
    for names in (DRIFT_FIELD_NAMES, DRIFT_ENDTAG_NAMES, WEIGHT_FIELD_NAMES):
        assert "3d" in names[0]
        assert all("3d" not in name for name in names[1:])
