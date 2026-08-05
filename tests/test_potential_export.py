"""Tests for write_potential and the export-potential CLI subcommand."""

import json

import numpy as np
import pytest

from pochoir_viewer.cli import _float_list, _glue_negative_values, main
from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import DEFAULT_LEVELS, write_potential


# vmin is below the deepest DEFAULT_LEVEL (-8000): the interval is OPEN, so a
# level sitting exactly at the minimum is skipped rather than triangulated.
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


# --- write_potential: files on disk -----------------------------------------


def test_writes_both_files(root, tmp_path):
    write_potential(root, tmp_path / "data", unit_grid())

    assert (tmp_path / "data" / "potential.bin").is_file()
    assert (tmp_path / "data" / "potential.json").is_file()


def test_creates_missing_destination_directories(root, tmp_path):
    write_potential(root, tmp_path / "deep" / "nested", unit_grid())

    assert (tmp_path / "deep" / "nested" / "potential.bin").is_file()


def test_returned_meta_matches_the_written_json(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    on_disk = json.loads((tmp_path / "data" / "potential.json").read_text())
    assert on_disk == meta


def test_bytes_field_matches_the_actual_file_size(root, tmp_path):
    """The browser validates its fetch length against this, so it must be real."""
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert meta["bytes"] == (tmp_path / "data" / "potential.bin").stat().st_size


def test_bytes_field_matches_the_declared_shape(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert meta["bytes"] == np.prod(meta["shape"]) * 4


def test_bin_field_names_the_written_file(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert meta["bin"] == "potential.bin"
    assert (tmp_path / "data" / meta["bin"]).is_file()


def test_binary_round_trips_to_the_source_volume(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    raw = (tmp_path / "data" / "potential.bin").read_bytes()
    restored = np.frombuffer(raw, dtype="<f4").reshape(meta["shape"])

    np.testing.assert_allclose(restored, ramp().astype(np.float32))


def test_overwrites_a_previous_export(root, tmp_path):
    dest = tmp_path / "data"
    write_potential(root, dest, unit_grid(), zstride=1)
    first = (dest / "potential.bin").stat().st_size

    write_potential(root, dest, unit_grid(), zstride=4)

    assert (dest / "potential.bin").stat().st_size < first


# --- write_potential: metadata ----------------------------------------------


def test_meta_keys(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert set(meta) == {
        "shape", "zstride", "spacing", "origin", "units", "vmin", "vmax",
        "bin", "bytes", "isosurfaces", "skipped_levels",
    }


def test_meta_is_json_serializable_without_numpy_scalars(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert json.loads(json.dumps(meta)) == meta
    assert all(type(n) is int for n in meta["shape"])
    assert all(type(s) is float for s in meta["spacing"])
    assert type(meta["vmin"]) is float


def test_meta_records_the_grid(root, tmp_path):
    grid = Grid.from_shape((6, 6, 21), spacing=(0.1, 0.2, 0.3), origin=(1.0, 2.0, 3.0))

    meta = write_potential(root, tmp_path / "data", grid)

    assert meta["spacing"] == [0.1, 0.2, 0.3]
    assert meta["origin"] == [1.0, 2.0, 3.0]


def test_meta_value_range_matches_the_data(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert meta["vmin"] == pytest.approx(-9000.0)
    assert meta["vmax"] == pytest.approx(0.0)
    assert meta["units"] == "V"


def test_zstride_is_recorded_and_applied(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid(), zstride=4)

    assert meta["zstride"] == 4
    assert meta["shape"] == [6, 6, 6]  # ceil(21 / 4)


def test_shape_reflects_the_strided_volume_not_the_source(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid(), zstride=2)

    assert meta["shape"][2] == 11
    assert meta["bytes"] == 6 * 6 * 11 * 4


def test_isosurfaces_are_included(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid(), levels=[-4000.0])

    assert [s["level"] for s in meta["isosurfaces"]] == [-4000.0]
    assert meta["isosurfaces"][0]["n_tris"] > 0


def test_a_level_at_exactly_vmin_is_skipped(tmp_path):
    """If the cathode potential equals the deepest default level, that surface
    is silently absent — the interval is open at both ends."""
    out = tmp_path / "OUTPUT"
    (out / "potential").mkdir(parents=True)
    np.savez(out / "potential" / "drift3d.npz", drift3d=ramp(vmin=-8000.0))

    meta = write_potential(out, tmp_path / "data", unit_grid())

    assert meta["skipped_levels"] == [-8000.0]
    assert -8000.0 not in [s["level"] for s in meta["isosurfaces"]]


def test_out_of_range_levels_are_reported_not_fatal(root, tmp_path):
    meta = write_potential(
        root, tmp_path / "data", unit_grid(), levels=[-4000.0, 99999.0]
    )

    assert [s["level"] for s in meta["isosurfaces"]] == [-4000.0]
    assert meta["skipped_levels"] == [99999.0]


def test_default_levels_are_used(root, tmp_path):
    meta = write_potential(root, tmp_path / "data", unit_grid())

    assert [s["level"] for s in meta["isosurfaces"]] == list(DEFAULT_LEVELS)


def test_isosurfaces_use_the_same_zstride_as_the_volume(root, tmp_path):
    """Both must agree, or the surfaces float away from the slice they describe."""
    full = write_potential(root, tmp_path / "a", unit_grid(), levels=[-4000.0])
    strided = write_potential(
        root, tmp_path / "b", unit_grid(), levels=[-4000.0], zstride=4
    )

    def mean_z(meta):
        verts = np.asarray(meta["isosurfaces"][0]["positions"]).reshape(-1, 3)
        return verts[:, 2].mean()

    assert mean_z(strided) == pytest.approx(mean_z(full), abs=0.5)


def test_missing_potential_raises(tmp_path):
    (tmp_path / "OUTPUT").mkdir()

    with pytest.raises(FileNotFoundError):
        write_potential(tmp_path / "OUTPUT", tmp_path / "data", unit_grid())


# --- _float_list ------------------------------------------------------------


def test_float_list_parses_negatives():
    assert _float_list("-500,-2000,-4000") == [-500.0, -2000.0, -4000.0]


def test_float_list_single_value():
    assert _float_list("-500") == [-500.0]


def test_float_list_tolerates_whitespace_and_trailing_commas():
    assert _float_list("-500, -2000,") == [-500.0, -2000.0]


def test_float_list_accepts_decimals_and_exponents():
    assert _float_list("-1.5,2e3") == [-1.5, 2000.0]


def test_float_list_rejects_non_numeric():
    import argparse

    with pytest.raises(argparse.ArgumentTypeError, match="comma-separated numbers"):
        _float_list("-500,high")


def test_float_list_of_empty_string_is_empty():
    assert _float_list("") == []


# --- _glue_negative_values --------------------------------------------------


def test_glue_rewrites_a_negative_levels_value():
    assert _glue_negative_values(["--levels", "-500,-2000"]) == ["--levels=-500,-2000"]


def test_glue_leaves_a_positive_levels_value_alone():
    assert _glue_negative_values(["--levels", "500"]) == ["--levels", "500"]


def test_glue_leaves_the_already_glued_form_alone():
    assert _glue_negative_values(["--levels=-500"]) == ["--levels=-500"]


def test_glue_preserves_surrounding_arguments():
    argv = ["export-potential", "--root", "r", "--levels", "-500", "--zstride", "4"]

    assert _glue_negative_values(argv) == [
        "export-potential", "--root", "r", "--levels=-500", "--zstride", "4",
    ]


def test_glue_does_not_consume_a_following_option():
    """`--levels --zstride 4` is a user error; gluing it would hide that."""
    glued = _glue_negative_values(["--levels", "--zstride", "4"])

    assert glued == ["--levels=--zstride", "4"]


def test_glue_at_the_end_of_argv_is_safe():
    assert _glue_negative_values(["--levels"]) == ["--levels"]


def test_glue_does_not_touch_other_options():
    assert _glue_negative_values(["--spacing", "-0.1"]) == ["--spacing", "-0.1"]


def test_glue_does_not_mutate_its_input():
    argv = ["--levels", "-500"]
    original = list(argv)

    _glue_negative_values(argv)

    assert argv == original


# --- the CLI subcommand -----------------------------------------------------


def test_export_potential_writes_both_files(root, tmp_path):
    dest = tmp_path / "web" / "data"

    code = main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    assert code == 0
    assert (dest / "potential.bin").is_file()
    assert (dest / "potential.json").is_file()


def test_export_potential_accepts_negative_levels(root, tmp_path):
    """The documented form: --levels -500,-2000 with a leading minus."""
    dest = tmp_path / "data"

    code = main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--levels", "-500,-2000",
    ])

    assert code == 0
    meta = json.loads((dest / "potential.json").read_text())
    assert [s["level"] for s in meta["isosurfaces"]] == [-500.0, -2000.0]


def test_export_potential_accepts_the_equals_form(root, tmp_path):
    dest = tmp_path / "data"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--levels=-500,-2000",
    ])

    meta = json.loads((dest / "potential.json").read_text())
    assert [s["level"] for s in meta["isosurfaces"]] == [-500.0, -2000.0]


def test_export_potential_zstride_option(root, tmp_path):
    dest = tmp_path / "data"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--zstride", "4",
    ])

    meta = json.loads((dest / "potential.json").read_text())
    assert meta["zstride"] == 4


def test_export_potential_defaults(root, tmp_path):
    dest = tmp_path / "data"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    meta = json.loads((dest / "potential.json").read_text())
    assert meta["zstride"] == 1
    assert [s["level"] for s in meta["isosurfaces"]] == list(DEFAULT_LEVELS)


def test_export_potential_prints_a_summary(root, tmp_path, capsys):
    dest = tmp_path / "data"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--levels", "-4000",
    ])

    out = capsys.readouterr().out
    assert "source" in out
    assert "potential.bin" in out
    assert "MB" in out
    assert "-4000.0 V" in out
    assert "triangles" in out


def test_export_potential_reports_skipped_levels(root, tmp_path, capsys):
    dest = tmp_path / "data"

    main([
        "export-potential", "--root", str(root), "--dest-dir", str(dest),
        "--levels", "-4000,99999",
    ])

    assert "skipped" in capsys.readouterr().out


def test_export_potential_requires_root_and_dest(tmp_path):
    with pytest.raises(SystemExit):
        main(["export-potential", "--root", str(tmp_path)])

    with pytest.raises(SystemExit):
        main(["export-potential", "--dest-dir", str(tmp_path)])


def test_export_potential_rejects_a_bad_level_list(root, tmp_path):
    with pytest.raises(SystemExit):
        main([
            "export-potential", "--root", str(root),
            "--dest-dir", str(tmp_path / "d"), "--levels", "-500,high",
        ])


def test_export_subcommand_still_works(tmp_path):
    """The new dispatch table must not have broken the original subcommand."""
    out = tmp_path / "OUTPUT"
    (out / "boundary").mkdir(parents=True)
    (out / "paths").mkdir(parents=True)
    np.savez(out / "boundary" / "drift.npz", drift=np.ones((4, 4, 4)))
    moving = np.zeros((5, 3))
    moving[:, 2] = np.arange(5)
    np.savez(out / "paths" / "drift3d.npz", drift3d=np.stack([moving]))
    np.savez(out / "paths" / "drift3d_endtag.npz", drift3d_endtag=np.zeros(1))

    dest = tmp_path / "scene.json"
    assert main(["export", "--root", str(out), "--dest", str(dest)]) == 0
    assert dest.is_file()


def test_unknown_subcommand_still_errors():
    with pytest.raises(SystemExit):
        main(["export-everything"])
