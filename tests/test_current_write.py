"""Tests for pochoir_viewer.current.write_current — the current.bin payload.

c6ae7e7. Shaped after write_potential: bulk to a raw float32 .bin, metadata
only in the JSON, and ``bytes`` read back off the file on disk so the browser
can validate its fetch. The things that can silently go wrong here are the
ones a browser cannot detect for itself -- a byte count that disagrees with
the shape, a C-order claim that is really Fortran order, and a ``starts`` list
whose order does not match the block it labels. Those get the attention.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from pochoir_viewer.current import domain_block, write_current

N_GRID = 25  # the response is an N x N source grid
N_PATHS = 100  # ... of which the viewer draws the M x M corner, M = 10
M = 10
N_TICKS = 12
PITCH_MM = 0.44
ORIGIN_MM = 0.22


def labelled_response(n: int = N_GRID, t: int = N_TICKS) -> np.ndarray:
    """Row (a, b) of the source grid filled with a*100 + b, as in test_current."""
    grid = np.arange(n)[:, None] * 100 + np.arange(n)[None, :]
    return np.repeat(grid.reshape(n * n, 1), t, axis=1).astype(float)


def lattice_paths(m: int = M, n_steps: int = 5) -> np.ndarray:
    """(m*m, n_steps, 3) paths on the real dataset's lattice, p = i*m + j.

    Each path drifts in -z and then stagnates, so trim_stagnant has something
    to trim; only the start point is what write_current keeps.
    """
    out = np.zeros((m * m, n_steps, 3))
    for p in range(m * m):
        i, j = divmod(p, m)
        x = ORIGIN_MM + i * PITCH_MM
        y = ORIGIN_MM + j * PITCH_MM
        out[p, :, 0] = x
        out[p, :, 1] = y
        out[p, :, 2] = [10.0, 8.0, 6.0] + [6.0] * (n_steps - 3)
    return out


@pytest.fixture
def root(tmp_path):
    """A minimal dataset root: one fr_*.npy and the two paths npz files."""
    src = tmp_path / "run"
    (src / "paths").mkdir(parents=True)
    np.save(src / "fr_synthetic_10pathsperpixel.npy", labelled_response())
    paths = lattice_paths()
    np.savez(src / "paths" / "drift3d.npz", drift3d=paths)
    np.savez(src / "paths" / "drift3d_endtag.npz", drift3d=np.zeros(len(paths)))
    return src


def read_back(dest: Path, meta: dict) -> np.ndarray:
    """The block as the browser would reconstruct it from the payload."""
    raw = np.frombuffer((dest / meta["bin"]).read_bytes(), dtype=np.float32)
    return raw.reshape(meta["shape"])


# --- the files land ----------------------------------------------------------


def test_both_files_are_written(root, tmp_path):
    dest = tmp_path / "data"

    write_current(root, dest, time_step_us=0.1)

    assert (dest / "current.bin").is_file()
    assert (dest / "current.json").is_file()


def test_the_destination_is_created(root, tmp_path):
    dest = tmp_path / "deep" / "nested" / "data"

    write_current(root, dest, time_step_us=0.1)

    assert (dest / "current.bin").is_file()


def test_the_returned_meta_is_what_was_written(root, tmp_path):
    dest = tmp_path / "data"

    meta = write_current(root, dest, time_step_us=0.1)

    assert meta == json.loads((dest / "current.json").read_text())


def test_the_basename_renames_both_files(root, tmp_path):
    dest = tmp_path / "data"

    meta = write_current(root, dest, time_step_us=0.1, basename="current_alt")

    assert (dest / "current_alt.bin").is_file()
    assert (dest / "current_alt.json").is_file()
    assert meta["bin"] == "current_alt.bin"
    assert not (dest / "current.bin").exists()


def test_the_bin_field_is_a_name_not_a_path(root, tmp_path):
    # The browser joins it against its own data directory; an absolute path
    # here would resolve to nothing it can fetch.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert "/" not in meta["bin"]


def test_a_string_dest_dir_is_accepted(root, tmp_path):
    dest = tmp_path / "data"

    write_current(str(root), str(dest), time_step_us=0.1)

    assert (dest / "current.bin").is_file()


# --- the payload the browser has to trust ------------------------------------


def test_the_byte_count_matches_the_file_on_disk(root, tmp_path):
    dest = tmp_path / "data"

    meta = write_current(root, dest, time_step_us=0.1)

    assert meta["bytes"] == (dest / meta["bin"]).stat().st_size


def test_the_byte_count_matches_the_declared_shape_as_float32(root, tmp_path):
    # The fetch-length check is only worth anything if the two agree.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert meta["bytes"] == int(np.prod(meta["shape"])) * 4


def test_the_binary_is_float32_not_the_float64_it_was_loaded_as(root, tmp_path):
    # load_response returns float64; writing it unconverted would double the
    # payload and misalign every read.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert meta["bytes"] == M * M * N_TICKS * 4


def test_the_shape_is_m_by_m_by_ticks(root, tmp_path):
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert meta["shape"] == [M, M, N_TICKS]
    assert meta["n_ticks"] == N_TICKS


def test_n_ticks_agrees_with_the_last_axis_of_the_shape(root, tmp_path):
    # Two fields stating the same number; a reader may use either.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert meta["n_ticks"] == meta["shape"][-1]


def test_the_block_is_written_c_order_with_ticks_fastest(root, tmp_path):
    # The documented layout. Fortran order would have the same byte count and
    # the same shape, so nothing but the values can catch it.
    dest = tmp_path / "data"
    meta = write_current(root, dest, time_step_us=0.1)

    block = read_back(dest, meta)

    np.testing.assert_array_equal(
        block[:, :, 0], [[a * 100 + b for b in range(M)] for a in range(M)]
    )


def test_the_payload_is_the_strided_corner_not_the_first_rows(root, tmp_path):
    # The same regression domain_block guards, carried through the writer:
    # response[:100] would put 4xx values in row 1 rather than 100..109.
    dest = tmp_path / "data"
    meta = write_current(root, dest, time_step_us=0.1)

    block = read_back(dest, meta)

    assert block[1, 0, 0] == 100
    np.testing.assert_array_equal(
        block, domain_block(labelled_response(), N_PATHS).astype(np.float32)
    )


def test_every_sample_survives_the_round_trip(root, tmp_path):
    dest = tmp_path / "data"
    meta = write_current(root, dest, time_step_us=0.1)

    expected = domain_block(labelled_response(), N_PATHS).astype(np.float32)
    np.testing.assert_array_equal(read_back(dest, meta), expected)


# --- the time base -----------------------------------------------------------


def test_the_time_step_is_recorded_as_given(root, tmp_path):
    meta = write_current(root, tmp_path / "data", time_step_us=0.05)

    assert meta["time_step_us"] == 0.05
    assert meta["time_units"] == "us"


def test_the_time_step_is_a_float_in_the_json(root, tmp_path):
    # Passed as an int it must still serialise as a number the browser can
    # multiply by a tick index without integer surprises.
    dest = tmp_path / "data"
    write_current(root, dest, time_step_us=1)

    assert isinstance(json.loads((dest / "current.json").read_text())["time_step_us"], float)


# --- starts: the list whose order is load-bearing ----------------------------


def test_there_is_one_start_per_block_cell(root, tmp_path):
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert len(meta["starts"]) == M * M


def test_each_start_is_an_xyz_triple(root, tmp_path):
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert all(len(s) == 3 for s in meta["starts"])


def test_start_i_times_m_plus_j_labels_block_i_j(root, tmp_path):
    # The documented ordering claim, and the one that would mislabel every
    # point in the selector if it were transposed. On the lattice, block[i, j]
    # is the source at x = 0.22 + i*0.44, y = 0.22 + j*0.44.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    for i in range(M):
        for j in range(M):
            x, y, _ = meta["starts"][i * M + j]
            assert x == pytest.approx(ORIGIN_MM + i * PITCH_MM)
            assert y == pytest.approx(ORIGIN_MM + j * PITCH_MM)


def test_the_starts_order_is_not_the_transpose(root, tmp_path):
    # Stated separately: on a symmetric lattice a transposed list still has
    # the right set of coordinates, so set equality would not catch it.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    starts = np.array(meta["starts"]).reshape(M, M, 3)
    assert not np.allclose(starts, starts.transpose(1, 0, 2))


def test_a_start_is_the_first_point_of_its_path(root, tmp_path):
    # trim_stagnant only drops the repeated tail, so the start must come
    # through untouched.
    paths = lattice_paths()
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    np.testing.assert_allclose(np.array(meta["starts"]), paths[:, 0, :])


def test_the_starts_are_plain_floats_not_numpy_scalars(root, tmp_path):
    # json.dumps refuses np.float64; the writer must have converted already.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert all(type(v) is float for s in meta["starts"] for v in s)


def test_the_whole_meta_is_json_serialisable(root, tmp_path):
    # The write already proves it, but a returned meta carrying numpy types
    # would break any caller that re-serialises it.
    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert json.loads(json.dumps(meta)) == meta


# --- m comes from the paths, not from a parameter ----------------------------


def test_m_follows_the_path_count(root, tmp_path):
    # "M is not a parameter: the viewer draws exactly the paths in paths/".
    # A 5 x 5 path set must produce a 5 x 5 block from the same response.
    paths = lattice_paths(m=5)
    np.savez(root / "paths" / "drift3d.npz", drift3d=paths)
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d=np.zeros(len(paths)))

    meta = write_current(root, tmp_path / "data", time_step_us=0.1)

    assert meta["shape"] == [5, 5, N_TICKS]
    assert len(meta["starts"]) == 25


def test_a_non_square_path_count_is_refused(root, tmp_path):
    paths = lattice_paths()[:99]
    np.savez(root / "paths" / "drift3d.npz", drift3d=paths)
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d=np.zeros(len(paths)))

    with pytest.raises(ValueError, match="not a perfect square"):
        write_current(root, tmp_path / "data", time_step_us=0.1)


def test_more_paths_than_the_response_grid_is_refused(root, tmp_path):
    # 900 paths against a 25 x 25 grid needs a 30 x 30 block.
    paths = lattice_paths(m=30)
    np.savez(root / "paths" / "drift3d.npz", drift3d=paths)
    np.savez(root / "paths" / "drift3d_endtag.npz", drift3d=np.zeros(len(paths)))

    with pytest.raises(ValueError, match="only"):
        write_current(root, tmp_path / "data", time_step_us=0.1)


# --- the inputs it depends on ------------------------------------------------


def test_a_root_with_no_response_raises(root, tmp_path):
    (root / "fr_synthetic_10pathsperpixel.npy").unlink()

    with pytest.raises(FileNotFoundError, match="no field-response"):
        write_current(root, tmp_path / "data", time_step_us=0.1)


def test_an_ambiguous_response_raises_before_anything_is_written(root, tmp_path):
    # Half a payload on disk is worse than none: the browser would fetch a
    # .bin with no .json, or one from a previous run.
    dest = tmp_path / "data"
    np.save(root / "fr_second_run.npy", labelled_response())

    with pytest.raises(ValueError, match="ambiguous"):
        write_current(root, dest, time_step_us=0.1)

    assert not (dest / "current.bin").exists()
    assert not (dest / "current.json").exists()


def test_a_root_with_no_paths_raises(root, tmp_path):
    (root / "paths" / "drift3d.npz").unlink()

    with pytest.raises(FileNotFoundError):
        write_current(root, tmp_path / "data", time_step_us=0.1)


# --- rewriting ---------------------------------------------------------------


def test_a_second_write_replaces_rather_than_appends(root, tmp_path):
    # The .bin is written with write_bytes, but a stale longer file left in
    # place would fail the browser's own length check.
    dest = tmp_path / "data"
    first = write_current(root, dest, time_step_us=0.1)

    second = write_current(root, dest, time_step_us=0.1)

    assert second["bytes"] == first["bytes"]
    assert (dest / "current.bin").stat().st_size == first["bytes"]


# --- the export-current CLI --------------------------------------------------
#
# f665a52. The one thing here that is a design decision rather than plumbing is
# --time-step being required with no fallback: the response file records no
# sampling rate, so a default would bake a guess into every time axis the
# viewer draws. That gets pinned from both sides -- absent must fail, and no
# default may appear in the help.

import io
import subprocess
import sys
from contextlib import redirect_stdout

from pochoir_viewer.cli import main

REPO_ROOT = Path(__file__).resolve().parent.parent


def export_current_help() -> str:
    """The help text, whitespace-normalised: argparse hard-wraps it."""
    buffer = io.StringIO()
    with redirect_stdout(buffer), pytest.raises(SystemExit):
        main(["export-current", "--help"])
    return " ".join(buffer.getvalue().split())


def test_the_subcommand_writes_the_payload(root, tmp_path, capsys):
    dest = tmp_path / "data"

    code = main(
        ["export-current", "--root", str(root), "--dest-dir", str(dest),
         "--time-step", "0.1"]
    )

    assert code == 0
    assert (dest / "current.bin").is_file()
    assert (dest / "current.json").is_file()


def test_the_subcommand_agrees_with_the_writer(root, tmp_path):
    # The CLI must be a thin shell: same payload as calling write_current.
    direct = write_current(root, tmp_path / "a", time_step_us=0.1)
    main(["export-current", "--root", str(root), "--dest-dir", str(tmp_path / "b"),
          "--time-step", "0.1"])

    assert json.loads((tmp_path / "b" / "current.json").read_text()) == direct


def test_the_report_names_both_files_and_the_grid(root, tmp_path, capsys):
    dest = tmp_path / "data"

    main(["export-current", "--root", str(root), "--dest-dir", str(dest),
          "--time-step", "0.1"])

    out = capsys.readouterr().out
    assert str(dest / "current.bin") in out
    assert str(dest / "current.json") in out
    assert f"{M}x{M} paths x {N_TICKS} ticks" in out
    assert "0.1 us" in out


def test_the_report_follows_the_basename(root, tmp_path, capsys):
    # The stem is derived from meta["bin"], so a basename must carry into both
    # names in the report rather than only the .bin.
    dest = tmp_path / "data"

    main(["export-current", "--root", str(root), "--dest-dir", str(dest),
          "--time-step", "0.1", "--basename", "current_alt"])

    out = capsys.readouterr().out
    assert "current_alt.bin" in out
    assert "current_alt.json" in out
    assert "current.json" not in out.replace("current_alt.json", "")


def test_the_time_step_reaches_the_payload(root, tmp_path):
    dest = tmp_path / "data"

    main(["export-current", "--root", str(root), "--dest-dir", str(dest),
          "--time-step", "0.05"])

    assert json.loads((dest / "current.json").read_text())["time_step_us"] == 0.05


def test_a_missing_time_step_is_refused(root, tmp_path):
    # The stated design decision: loudly missing, never silently guessed.
    with pytest.raises(SystemExit) as excinfo:
        main(["export-current", "--root", str(root), "--dest-dir", str(tmp_path / "d")])

    assert excinfo.value.code != 0


def test_nothing_is_written_when_the_time_step_is_missing(root, tmp_path):
    dest = tmp_path / "data"
    with pytest.raises(SystemExit):
        main(["export-current", "--root", str(root), "--dest-dir", str(dest)])

    assert not dest.exists()


def test_the_help_declares_no_time_step_default(root):
    # A default appearing later would be invisible at the call site; the help
    # is where it would first show up.
    help_text = export_current_help()

    assert "no default" in help_text
    assert "default: 0" not in help_text


def test_the_help_states_the_time_step_unit(root):
    # us versus ns is a 1000x error in every drawn time axis, and the number
    # itself carries no clue which was meant.
    assert "MICROSECONDS" in export_current_help()


@pytest.mark.parametrize(
    "argv",
    [
        ["export-current", "--dest-dir", "d", "--time-step", "0.1"],  # no --root
        ["export-current", "--root", "r", "--time-step", "0.1"],  # no --dest-dir
    ],
    ids=["--root", "--dest-dir"],
)
def test_the_required_flags_are_required(argv):
    with pytest.raises(SystemExit):
        main(argv)


def test_the_subcommand_is_reachable_as_a_module(root, tmp_path):
    # The package is not installed; python -m is how it is actually run.
    dest = tmp_path / "data"
    result = subprocess.run(
        [sys.executable, "-m", "pochoir_viewer", "export-current",
         "--root", str(root), "--dest-dir", str(dest), "--time-step", "0.1"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )

    assert result.returncode == 0, result.stderr
    assert (dest / "current.bin").is_file()


def test_export_current_is_listed_in_the_top_level_help():
    buffer = io.StringIO()
    with redirect_stdout(buffer), pytest.raises(SystemExit):
        main(["--help"])

    assert "export-current" in buffer.getvalue()


def test_the_other_subcommands_still_dispatch():
    # A handler dict edit is easy to get wrong; make sure the new entry did
    # not displace either existing one.
    for command in ("export", "export-potential"):
        buffer = io.StringIO()
        with redirect_stdout(buffer), pytest.raises(SystemExit):
            main([command, "--help"])
        assert buffer.getvalue().strip(), f"{command} lost its parser"
