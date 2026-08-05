"""Tests for pochoir_viewer.io — npz loading and dataset discovery."""

import numpy as np
import pytest

from pochoir_viewer.io import SKIP_DIRS, find_dataset, list_datasets, load_npz


def write_npz(path, **arrays):
    """Write an .npz at `path`, creating parent directories."""
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrays)
    return path


@pytest.fixture
def root(tmp_path):
    """A dataset tree mirroring pochoir output: real results plus skipped dirs."""
    write_npz(tmp_path / "boundary" / "drift.npz", drift=np.zeros((4, 4, 3)))
    write_npz(tmp_path / "paths" / "drift3d.npz", drift3d=np.ones((2, 5, 3)))
    write_npz(tmp_path / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(2))
    for skipped in SKIP_DIRS:
        write_npz(tmp_path / skipped / "drift.npz", drift=np.zeros(1))
    return tmp_path


# --- load_npz ---------------------------------------------------------------


def test_load_npz_returns_key_and_array(tmp_path):
    data = np.arange(12, dtype=np.float64).reshape(3, 4)
    path = write_npz(tmp_path / "boundary" / "drift.npz", drift=data)

    key, arr = load_npz(path)

    assert key == "drift"
    np.testing.assert_array_equal(arr, data)


def test_load_npz_accepts_str_path(tmp_path):
    path = write_npz(tmp_path / "drift.npz", drift=np.zeros((2, 2)))

    key, arr = load_npz(str(path))

    assert key == "drift"
    assert arr.shape == (2, 2)


def test_load_npz_array_survives_file_close(tmp_path):
    """np.load is used as a context manager; the returned array must stay valid."""
    path = write_npz(tmp_path / "drift.npz", drift=np.arange(5.0))

    _, arr = load_npz(path)

    np.testing.assert_array_equal(arr, np.arange(5.0))  # no ValueError on read


def test_load_npz_rejects_multiple_arrays(tmp_path):
    path = write_npz(tmp_path / "two.npz", a=np.zeros(1), b=np.ones(1))

    with pytest.raises(ValueError, match="expected 1 array"):
        load_npz(path)


def test_load_npz_rejects_empty_archive(tmp_path):
    path = write_npz(tmp_path / "none.npz")

    with pytest.raises(ValueError, match=r"found \[\]"):
        load_npz(path)


def test_load_npz_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_npz(tmp_path / "absent.npz")


# --- list_datasets ----------------------------------------------------------


def test_list_datasets_excludes_skip_dirs(root):
    found = list_datasets(root)

    assert [p.relative_to(root).as_posix() for p in found] == [
        "boundary/drift.npz",
        "paths/drift3d.npz",
        "paths/drift3d_endtag.npz",
    ]


def test_list_datasets_is_sorted(root):
    found = list_datasets(root)

    assert found == sorted(found)


def test_list_datasets_accepts_str_root(root):
    assert list_datasets(str(root)) == list_datasets(root)


def test_list_datasets_skips_nested_skip_dirs(tmp_path):
    """A skip dir anywhere in the relative path excludes the file, not just at top level."""
    write_npz(tmp_path / "run1" / "domain" / "drift.npz", drift=np.zeros(1))
    keep = write_npz(tmp_path / "run1" / "boundary" / "drift.npz", drift=np.zeros(1))

    assert list_datasets(tmp_path) == [keep]


def test_list_datasets_ignores_non_npz(tmp_path):
    write_npz(tmp_path / "a.npz", a=np.zeros(1))
    (tmp_path / "notes.txt").write_text("hello")

    assert [p.name for p in list_datasets(tmp_path)] == ["a.npz"]


def test_list_datasets_empty_root(tmp_path):
    assert list_datasets(tmp_path) == []


# --- find_dataset -----------------------------------------------------------


def test_find_dataset_resolves_relative_path(root):
    assert find_dataset(root, "boundary/drift.npz") == root / "boundary" / "drift.npz"


def test_find_dataset_accepts_str_root(root):
    assert find_dataset(str(root), "paths/drift3d.npz") == root / "paths" / "drift3d.npz"


def test_find_dataset_missing_lists_available(root):
    with pytest.raises(FileNotFoundError) as excinfo:
        find_dataset(root, "boundary/typo.npz")

    message = str(excinfo.value)
    assert "boundary/typo.npz" in message
    assert "boundary/drift.npz" in message.replace("\\", "/")
    assert "paths/drift3d.npz" in message.replace("\\", "/")


def test_find_dataset_missing_omits_skipped_dirs(root):
    with pytest.raises(FileNotFoundError) as excinfo:
        find_dataset(root, "nope.npz")

    message = str(excinfo.value).replace("\\", "/")
    for skipped in SKIP_DIRS:
        assert f"/{skipped}/" not in message


def test_find_dataset_rejects_directory(root):
    """A directory is not a dataset even though it exists."""
    with pytest.raises(FileNotFoundError):
        find_dataset(root, "boundary")


def test_find_dataset_result_is_loadable(root):
    key, arr = load_npz(find_dataset(root, "paths/drift3d.npz"))

    assert key == "drift3d"
    assert arr.shape == (2, 5, 3)
