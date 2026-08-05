"""End-to-end tolerance of both drift filename spellings.

find_drift is unit-tested in test_io_find_drift.py; this file checks that the
callers actually route through it, so a dataset using the other convention
exports without any flag.
"""

import json

import numpy as np
import pytest

from pochoir_viewer.cli import main
from pochoir_viewer.export import build_scene
from pochoir_viewer.paths import load_paths


def mask():
    m = np.zeros((44, 44, 1601))
    m[0:40, 0:36, 98:101] = 1.0
    m[4:8, 4:8, 131] = 1.0
    m[:, :, 1600] = 1.0
    return m


def drift_paths(n=3):
    moving = np.array([0.22, 0.22, 159.9]) + np.arange(40)[:, None] * [0, 0, -0.1]
    path = np.concatenate([moving, np.repeat(moving[-1:], 40, axis=0)])
    return np.stack([path] * n)


def build_dataset(root, *, boundary_name, field_name, endtag_name):
    """Lay out a pochoir tree using the given drift filename spellings."""
    (root / "boundary").mkdir(parents=True, exist_ok=True)
    (root / "paths").mkdir(parents=True, exist_ok=True)

    np.savez(root / "boundary" / boundary_name, drift=mask())
    np.savez(root / "paths" / field_name, drift3d=drift_paths())
    np.savez(root / "paths" / endtag_name, drift3d_endtag=np.zeros(3))
    return root


#: The two conventions pochoir writes, per the README.
SPELLINGS = {
    "drift3d": dict(
        boundary_name="drift3d.npz",
        field_name="drift3d.npz",
        endtag_name="drift3d_endtag.npz",
    ),
    "drift": dict(
        boundary_name="drift.npz",
        field_name="drift.npz",
        endtag_name="drift_endtag.npz",
    ),
}


@pytest.fixture(params=sorted(SPELLINGS))
def root(request, tmp_path):
    """A dataset in each spelling, so every test below runs against both."""
    return build_dataset(tmp_path / "OUTPUT", **SPELLINGS[request.param])


# --- load_paths -------------------------------------------------------------


def test_load_paths_accepts_either_spelling(root):
    paths, endtags = load_paths(root)

    assert paths.shape == (3, 80, 3)
    assert endtags.shape == (3,)


def test_load_paths_mixed_spellings_in_one_directory(tmp_path):
    """Nothing requires the field and endtag to use the same convention."""
    root = build_dataset(
        tmp_path / "OUTPUT",
        boundary_name="drift.npz",
        field_name="drift3d.npz",
        endtag_name="drift_endtag.npz",
    )

    paths, endtags = load_paths(root)

    assert paths.shape == (3, 80, 3)
    assert endtags.shape == (3,)


# --- build_scene ------------------------------------------------------------


def test_build_scene_accepts_either_spelling(root):
    scene = build_scene(root)

    assert set(scene) == {"meta", "boundary", "paths", "summaries"}
    assert scene["meta"]["n_paths"] == 3


def test_boundary_is_read_regardless_of_spelling(root):
    scene = build_scene(root)

    assert [g["name"] for g in scene["boundary"]] == ["anode", "grid", "cathode"]
    assert scene["meta"]["extent_mm"] == pytest.approx([4.4, 4.4, 160.1])


def test_both_spellings_produce_identical_scenes(tmp_path):
    """The contents are identical, so the export must be byte-identical too."""
    a = build_dataset(tmp_path / "a", **SPELLINGS["drift3d"])
    b = build_dataset(tmp_path / "b", **SPELLINGS["drift"])

    scene_a = build_scene(a)
    scene_b = build_scene(b)

    scene_a["meta"].pop("source")
    scene_b["meta"].pop("source")
    assert json.dumps(scene_a) == json.dumps(scene_b)


def test_boundary_spelling_is_independent_of_paths_spelling(tmp_path):
    root = build_dataset(
        tmp_path / "OUTPUT",
        boundary_name="drift3d.npz",
        field_name="drift.npz",
        endtag_name="drift3d_endtag.npz",
    )

    scene = build_scene(root)

    assert len(scene["boundary"]) == 3
    assert scene["meta"]["n_paths"] == 3


# --- CLI --------------------------------------------------------------------


def test_export_cli_accepts_either_spelling(root, tmp_path):
    dest = tmp_path / "scene.json"

    assert main(["export", "--root", str(root), "--dest", str(dest)]) == 0
    assert json.loads(dest.read_text())["meta"]["n_paths"] == 3


# --- failure still reports usefully -----------------------------------------


def test_missing_boundary_drift_names_both_candidates(tmp_path):
    root = tmp_path / "OUTPUT"
    (root / "boundary").mkdir(parents=True)
    (root / "paths").mkdir(parents=True)
    np.savez(root / "boundary" / "weight.npz", weight=np.zeros(1))

    with pytest.raises(FileNotFoundError) as excinfo:
        build_scene(root)

    message = str(excinfo.value)
    assert "drift3d.npz" in message
    assert "drift.npz" in message
    assert "weight.npz" in message  # what was actually there


def test_missing_endtag_is_reported_as_the_endtag(tmp_path):
    root = tmp_path / "OUTPUT"
    (root / "boundary").mkdir(parents=True)
    (root / "paths").mkdir(parents=True)
    np.savez(root / "boundary" / "drift.npz", drift=mask())
    np.savez(root / "paths" / "drift3d.npz", drift3d=drift_paths())

    with pytest.raises(FileNotFoundError, match="endtag"):
        build_scene(root)


def test_an_unrelated_drift_prefixed_neighbour_is_not_used(tmp_path):
    """drift_insulator.npz must not stand in for the real drift array."""
    root = tmp_path / "OUTPUT"
    (root / "boundary").mkdir(parents=True)
    (root / "paths").mkdir(parents=True)
    np.savez(root / "boundary" / "drift_insulator.npz", a=np.zeros(1))

    with pytest.raises(FileNotFoundError):
        build_scene(root)
