"""Tests for pochoir_viewer.cli — the export entry point."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from pochoir_viewer.cli import main


#: The package is not installed; ``python -m`` needs the repo root on sys.path.
REPO_ROOT = Path(__file__).resolve().parent.parent


def write_dataset(root):
    """A miniature pochoir output tree."""
    (root / "boundary").mkdir(parents=True, exist_ok=True)
    (root / "paths").mkdir(parents=True, exist_ok=True)

    mask = np.zeros((44, 44, 1601))
    mask[0:40, 0:36, 98:101] = 1.0
    mask[4:8, 4:8, 131] = 1.0
    mask[:, :, 1600] = 1.0
    np.savez(root / "boundary" / "drift.npz", drift=mask)

    moving = np.array([0.22, 0.22, 159.9]) + np.arange(50)[:, None] * [0, 0, -0.1]
    path = np.concatenate([moving, np.repeat(moving[-1:], 50, axis=0)])
    np.savez(root / "paths" / "drift3d.npz", drift3d=np.stack([path] * 3))
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(3))
    return root


@pytest.fixture
def root(tmp_path):
    return write_dataset(tmp_path / "OUTPUT")


# --- happy path -------------------------------------------------------------


def test_export_writes_the_scene_and_returns_zero(root, tmp_path):
    dest = tmp_path / "web" / "data" / "scene.json"

    code = main(["export", "--root", str(root), "--dest", str(dest)])

    assert code == 0
    scene = json.loads(dest.read_text())
    assert set(scene) == {"meta", "boundary", "paths", "summaries"}
    assert scene["meta"]["n_paths"] == 3


def test_export_creates_missing_parent_directories(root, tmp_path):
    dest = tmp_path / "deep" / "nested" / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest)])

    assert dest.is_file()


def test_export_overwrites_an_existing_file(root, tmp_path):
    dest = tmp_path / "scene.json"
    dest.write_text("stale contents that must not survive")

    main(["export", "--root", str(root), "--dest", str(dest)])

    assert json.loads(dest.read_text())["meta"]["n_paths"] == 3


def test_export_prints_a_summary_line(root, tmp_path, capsys):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest)])

    out = capsys.readouterr().out
    assert str(dest) in out
    assert "MB" in out
    assert "3 boundary groups" in out
    assert "3 paths" in out


# --- options ----------------------------------------------------------------


def test_default_spacing_is_the_01mm_grid(root, tmp_path):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest)])

    scene = json.loads(dest.read_text())
    assert scene["meta"]["grid"]["spacing"] == [0.1, 0.1, 0.1]
    assert scene["meta"]["extent_mm"] == pytest.approx([4.4, 4.4, 160.1])


def test_spacing_option_applies_to_all_three_axes(root, tmp_path):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest), "--spacing", "0.5"])

    assert json.loads(dest.read_text())["meta"]["grid"]["spacing"] == [0.5, 0.5, 0.5]


def test_default_max_points_is_400(root, tmp_path):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest)])

    for path in json.loads(dest.read_text())["paths"]:
        assert len(path["points"]) <= 400 * 3


def test_max_points_option_caps_path_length(root, tmp_path):
    dest = tmp_path / "scene.json"

    main(["export", "--root", str(root), "--dest", str(dest), "--max-points", "5"])

    for path in json.loads(dest.read_text())["paths"]:
        assert len(path["points"]) <= 5 * 3


# --- argument errors --------------------------------------------------------


def test_no_subcommand_is_an_error():
    with pytest.raises(SystemExit) as excinfo:
        main([])

    assert excinfo.value.code != 0


def test_unknown_subcommand_is_an_error():
    with pytest.raises(SystemExit) as excinfo:
        main(["visualize"])

    assert excinfo.value.code != 0


def test_root_is_required(tmp_path):
    with pytest.raises(SystemExit) as excinfo:
        main(["export", "--dest", str(tmp_path / "scene.json")])

    assert excinfo.value.code != 0


def test_dest_is_required(root):
    with pytest.raises(SystemExit) as excinfo:
        main(["export", "--root", str(root)])

    assert excinfo.value.code != 0


def test_non_numeric_spacing_is_an_error(root, tmp_path):
    with pytest.raises(SystemExit):
        main(
            [
                "export",
                "--root",
                str(root),
                "--dest",
                str(tmp_path / "scene.json"),
                "--spacing",
                "coarse",
            ]
        )


def test_missing_dataset_propagates_filenotfound(tmp_path):
    with pytest.raises(FileNotFoundError):
        main(["export", "--root", str(tmp_path), "--dest", str(tmp_path / "s.json")])


def test_failed_export_writes_nothing(tmp_path):
    dest = tmp_path / "scene.json"

    with pytest.raises(FileNotFoundError):
        main(["export", "--root", str(tmp_path), "--dest", str(dest)])

    assert not dest.exists()


# --- python -m pochoir_viewer ----------------------------------------------


def test_module_entry_point_runs(root, tmp_path):
    """__main__.py must wire main() to the process exit code."""
    dest = tmp_path / "scene.json"

    result = subprocess.run(
        [sys.executable, "-m", "pochoir_viewer", "export",
         "--root", str(root), "--dest", str(dest)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0, result.stderr
    assert dest.is_file()


def test_module_entry_point_reports_failure(tmp_path):
    result = subprocess.run(
        [sys.executable, "-m", "pochoir_viewer", "export",
         "--root", str(tmp_path / "absent"), "--dest", str(tmp_path / "s.json")],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert "No module named" not in result.stderr  # failed for the right reason

    assert result.returncode != 0
