"""Tests for write_potential and the export-potential CLI subcommand."""

import json

import numpy as np
import pytest

from pochoir_viewer.cli import main
from pochoir_viewer.grid import Grid
from pochoir_viewer.potential import write_potential


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
        "bin", "bytes",
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


def test_missing_potential_raises(tmp_path):
    (tmp_path / "OUTPUT").mkdir()

    with pytest.raises(FileNotFoundError):
        write_potential(tmp_path / "OUTPUT", tmp_path / "data", unit_grid())


# --- the CLI subcommand -----------------------------------------------------


def test_export_potential_writes_both_files(root, tmp_path):
    dest = tmp_path / "web" / "data"

    code = main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    assert code == 0
    assert (dest / "potential.bin").is_file()
    assert (dest / "potential.json").is_file()


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


def test_export_potential_prints_a_summary(root, tmp_path, capsys):
    dest = tmp_path / "data"

    main(["export-potential", "--root", str(root), "--dest-dir", str(dest)])

    out = capsys.readouterr().out
    assert "source" in out
    assert "potential.bin" in out
    assert "MB" in out


def test_export_potential_requires_root_and_dest(tmp_path):
    with pytest.raises(SystemExit):
        main(["export-potential", "--root", str(tmp_path)])

    with pytest.raises(SystemExit):
        main(["export-potential", "--dest-dir", str(tmp_path)])


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
