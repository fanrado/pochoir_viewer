"""Coverage for the end-to-end removal of the isosurface feature.

cdf96d2 dropped the marching-cubes computation from potential.py and 53c44dd
dropped the --levels flag and the scikit-image dependency. These checks pin the
removal at each seam it touched: the exported payload, the CLI surface, and the
requirements file. A half-revert that brings one back without the others is the
failure this catches -- the same shape of breakage the web-side removal hit.
"""

import json
from pathlib import Path

import numpy as np
import pytest

import pochoir_viewer.cli as cli
import pochoir_viewer.potential as potential
from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import write_potential

ROOT = Path(__file__).resolve().parent.parent


def ramp(shape=(6, 6, 21), vmin=-9000.0, vmax=0.0):
    z = np.linspace(vmin, vmax, shape[2])
    return np.broadcast_to(z, shape).copy()


@pytest.fixture
def root(tmp_path):
    """A dataset root holding only the potential array."""
    out = tmp_path / "OUTPUT"
    (out / "potential").mkdir(parents=True)
    np.savez(out / "potential" / "drift3d.npz", drift3d=ramp())
    return out


def unit_grid(shape=(6, 6, 21)):
    return Grid.from_shape(shape, spacing=(1.0, 1.0, 1.0))


# --- the module no longer exposes the feature --------------------------------


@pytest.mark.parametrize("name", ["isosurfaces", "default_levels", "DEFAULT_LEVELS", "WEIGHT_LEVELS"])
def test_potential_no_longer_exports_the_iso_names(name):
    assert not hasattr(potential, name), f"potential.{name} came back"


@pytest.mark.parametrize("name", ["_float_list", "_glue_negative_values"])
def test_cli_no_longer_exports_the_levels_helpers(name):
    assert not hasattr(cli, name), f"cli.{name} came back"


def test_write_potential_takes_no_levels_argument(root, tmp_path):
    with pytest.raises(TypeError):
        write_potential(root, tmp_path / "d", unit_grid(), levels=[-4000.0])


# --- the payload ---------------------------------------------------------------


def test_payload_carries_no_isosurface_keys(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert "isosurfaces" not in meta
    assert "skipped_levels" not in meta


def test_payload_still_carries_everything_the_viewer_reads(root, tmp_path):
    # The removal must not have taken a neighbouring key with it.
    meta = write_potential(root, tmp_path / "data", unit_grid())

    for key in ("shape", "spacing", "origin", "zstride", "units", "vmin", "vmax", "bin", "bytes"):
        assert key in meta, f"removal also dropped meta[{key!r}]"


def test_written_json_matches_the_returned_meta(root, tmp_path):
    dest = tmp_path / "data"

    meta = write_potential(root, dest, unit_grid())

    assert json.loads((dest / "potential.json").read_text()) == meta


# --- the CLI -------------------------------------------------------------------


def test_export_potential_rejects_the_levels_flag(root, tmp_path):
    with pytest.raises(SystemExit):
        cli.main([
            "export-potential", "--root", str(root),
            "--dest-dir", str(tmp_path / "d"), "--levels", "-500,-2000",
        ])


def test_export_potential_rejects_the_glued_levels_form(root, tmp_path):
    # --levels=-500 used to be the form _glue_negative_values rewrote to; with
    # the flag gone it must be an outright argparse error, not a silent no-op.
    with pytest.raises(SystemExit):
        cli.main([
            "export-potential", "--root", str(root),
            "--dest-dir", str(tmp_path / "d"), "--levels=-500",
        ])


def test_export_potential_still_runs_without_levels(root, tmp_path):
    dest = tmp_path / "data"

    assert cli.main(["export-potential", "--root", str(root), "--dest-dir", str(dest)]) == 0
    assert (dest / "potential.bin").is_file()
    assert (dest / "potential.json").is_file()


def test_the_summary_no_longer_mentions_surfaces(root, tmp_path, capsys):
    cli.main(["export-potential", "--root", str(root), "--dest-dir", str(tmp_path / "d")])

    out = capsys.readouterr().out
    for word in ("triangles", "skipped", "isosurface"):
        assert word not in out, f"summary still prints {word!r}"


# --- the dependency ------------------------------------------------------------


def test_requirements_no_longer_pin_scikit_image():
    text = (ROOT / "requirements.txt").read_text()

    assert "scikit-image" not in text


def test_no_module_imports_skimage():
    offenders = [
        p.name
        for p in (ROOT / "pochoir_viewer").glob("*.py")
        if "skimage" in p.read_text()
    ]

    assert offenders == [], f"still import skimage: {offenders}"
