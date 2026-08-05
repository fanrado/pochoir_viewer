"""Tests for the --basename override and the two-file 'wrote' report."""

import json

import numpy as np
import pytest

from pochoir_viewer.cli import main
from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import write_potential


def write_dataset(root, *, drift=True, weight=True):
    (root / "potential").mkdir(parents=True, exist_ok=True)
    arr = np.linspace(-9000.0, 0.0, 20)
    volume = np.broadcast_to(arr, (4, 4, 20)).copy()
    if drift:
        np.savez(root / "potential" / "drift3d.npz", drift3d=volume)
    if weight:
        ratio = np.exp(-np.linspace(0, 6, 20))
        np.savez(
            root / "potential" / "weight3d.npz",
            weight3d=np.broadcast_to(ratio, (4, 4, 20)).copy(),
        )
    return root


@pytest.fixture
def root(tmp_path):
    return write_dataset(tmp_path / "OUTPUT")


def unit_grid(shape=(4, 4, 20)):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


# --- write_potential: the basename override ---------------------------------


def test_basename_names_both_files(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid(), basename="custom")

    assert (tmp_path / "d" / "custom.bin").is_file()
    assert (tmp_path / "d" / "custom.json").is_file()
    assert meta["bin"] == "custom.bin"


def test_the_two_files_share_one_stem(root, tmp_path):
    """The viewer derives the json name from the bin name, so they must match."""
    meta = write_potential(root, tmp_path / "d", unit_grid(), basename="anything")

    stem = meta["bin"].removesuffix(".bin")
    assert (tmp_path / "d" / f"{stem}.json").is_file()


def test_basename_overrides_the_drift_default(root, tmp_path):
    write_potential(root, tmp_path / "d", unit_grid(), basename="custom")

    assert not (tmp_path / "d" / "potential.bin").exists()


def test_basename_overrides_the_weight_default(root, tmp_path):
    write_potential(root, tmp_path / "d", unit_grid(), basename="w", field="weight")

    assert (tmp_path / "d" / "w.bin").is_file()
    assert not (tmp_path / "d" / "potential_weight.bin").exists()


def test_no_basename_keeps_the_drift_default(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid())

    assert meta["bin"] == "potential.bin"
    assert (tmp_path / "d" / "potential.json").is_file()


def test_no_basename_keeps_the_weight_default(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid(), field="weight")

    assert meta["bin"] == "potential_weight.bin"
    assert (tmp_path / "d" / "potential_weight.json").is_file()


def test_an_empty_basename_falls_back_to_the_default(root, tmp_path):
    # The guard is `if basename:`, so "" must not produce ".bin".
    meta = write_potential(root, tmp_path / "d", unit_grid(), basename="")

    assert meta["bin"] == "potential.bin"
    assert not (tmp_path / "d" / ".bin").exists()


def test_none_basename_falls_back_to_the_default(root, tmp_path):
    meta = write_potential(root, tmp_path / "d", unit_grid(), basename=None)

    assert meta["bin"] == "potential.bin"


def test_the_payload_is_unaffected_by_the_name(root, tmp_path):
    """Renaming must change only the filenames, not the contents."""
    default = write_potential(root, tmp_path / "a", unit_grid())
    renamed = write_potential(root, tmp_path / "b", unit_grid(), basename="custom")

    for key in ("shape", "zstride", "spacing", "origin", "units", "vmin", "vmax", "bytes"):
        assert default[key] == renamed[key], key
    assert (tmp_path / "a" / "potential.bin").read_bytes() == (
        tmp_path / "b" / "custom.bin"
    ).read_bytes()


def test_two_basenames_coexist_in_one_directory(root, tmp_path):
    dest = tmp_path / "d"

    write_potential(root, dest, unit_grid(), basename="run_a")
    write_potential(root, dest, unit_grid(), basename="run_b")

    for stem in ("run_a", "run_b"):
        assert (dest / f"{stem}.bin").is_file()
        assert (dest / f"{stem}.json").is_file()


def test_a_basename_with_a_subdirectory_is_written_there(tmp_path):
    # Path joining means a stem containing a separator lands in a subdir; the
    # parent must already exist, so this documents the current behaviour.
    root = write_dataset(tmp_path / "OUTPUT")
    dest = tmp_path / "d"
    (dest / "sub").mkdir(parents=True)

    meta = write_potential(root, dest, unit_grid(), basename="sub/custom")

    assert (dest / "sub" / "custom.bin").is_file()
    assert meta["bin"] == "custom.bin"  # only the leaf name is recorded


# --- the CLI ----------------------------------------------------------------


def test_the_cli_basename_flag(root, tmp_path):
    dest = tmp_path / "d"

    assert main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--basename", "custom",
    ]) == 0

    assert (dest / "custom.bin").is_file()
    assert (dest / "custom.json").is_file()


def test_the_cli_basename_works_with_a_field(root, tmp_path):
    dest = tmp_path / "d"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--field", "weight", "--basename", "wpot",
    ])

    meta = json.loads((dest / "wpot.json").read_text())
    assert meta["field"] == "weight"
    assert meta["bin"] == "wpot.bin"


def test_the_cli_default_is_unchanged(root, tmp_path):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    assert (dest / "potential.bin").is_file()
    assert (dest / "potential.json").is_file()


# --- the 'wrote' line names both files --------------------------------------


def wrote_line(captured):
    for line in captured.out.splitlines():
        if line.startswith("wrote "):
            return line
    return None


def test_the_report_names_both_files(root, tmp_path, capsys):
    """Previously only the .bin was named, so the .json went unmentioned."""
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    line = wrote_line(capsys.readouterr())
    assert "potential.bin" in line
    assert "potential.json" in line


def test_the_report_follows_a_custom_basename(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--basename", "custom",
    ])

    line = wrote_line(capsys.readouterr())
    assert "custom.bin" in line
    assert "custom.json" in line
    assert "potential.bin" not in line


def test_the_report_follows_the_weight_default(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--field", "weight",
    ])

    line = wrote_line(capsys.readouterr())
    assert "potential_weight.bin" in line
    assert "potential_weight.json" in line


def test_the_reported_paths_exist(root, tmp_path, capsys):
    """The report must name files that were actually written."""
    dest = tmp_path / "d"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--basename", "custom",
    ])

    line = wrote_line(capsys.readouterr())
    from pathlib import Path

    for token in line.split():
        if token.endswith((".bin", ".json")):
            assert Path(token).is_file(), token


def test_the_report_keeps_size_shape_and_units(root, tmp_path, capsys):
    dest = tmp_path / "d"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    line = wrote_line(capsys.readouterr())
    assert "MB" in line
    assert "shape" in line
    assert "units V" in line
