"""Tests for pochoir_viewer.current — response loading, the drift-domain block
and the four per-pixel traces.

f26c95f and d27e430. Two of these functions encode a claim about layout that
nothing in the file itself records, and getting either wrong plots real
waveforms from the wrong source positions -- a plausible-looking wrong answer,
which is the worst kind. So the fixtures here are built so that every row is
identifiable: cell (a, b) of the N x N grid carries the constant value
``a*100 + b``. A mis-sliced block then shows up as a specific wrong number
rather than as a shape that happens to match.
"""

from math import isqrt
from pathlib import Path

import numpy as np
import pytest

from pochoir_viewer.io import find_response
from pochoir_viewer.current import (
    domain_block,
    load_response,
)

REFERENCE_SHAPE = (625, 3999)  # the shape the docstring cites


def labelled(n: int, t: int = 3) -> np.ndarray:
    """An (n*n, t) response whose row (a, b) is filled with a*100 + b."""
    grid = np.arange(n)[:, None] * 100 + np.arange(n)[None, :]
    return np.repeat(grid.reshape(n * n, 1), t, axis=1).astype(float)


# --- load_response -----------------------------------------------------------


def test_loads_a_bare_npy(tmp_path):
    path = tmp_path / "fr_test.npy"
    np.save(path, np.zeros((625, 8)))

    assert load_response(path).shape == (625, 8)


def test_accepts_a_string_path(tmp_path):
    path = tmp_path / "fr_test.npy"
    np.save(path, np.zeros((4, 4)))

    assert load_response(str(path)).shape == (4, 4)


def test_the_array_is_returned_unchanged(tmp_path):
    # No reshaping, transposing or scaling happens on load: domain_block is
    # the only thing that reinterprets the row axis.
    original = np.random.default_rng(0).normal(size=(9, 5))
    path = tmp_path / "fr_test.npy"
    np.save(path, original)

    np.testing.assert_array_equal(load_response(path), original)


def test_the_reference_shape_loads(tmp_path):
    path = tmp_path / "fr_reference.npy"
    np.save(path, np.zeros(REFERENCE_SHAPE, dtype=np.float32))

    assert load_response(path).shape == REFERENCE_SHAPE


@pytest.mark.parametrize("shape", [(625,), (5, 5, 5), (2, 2, 2, 2)])
def test_a_non_2d_response_is_refused(tmp_path, shape):
    # A 1-D or 3-D file is a different product; reshaping it silently would
    # invent a source grid that does not exist.
    path = tmp_path / "fr_wrong.npy"
    np.save(path, np.zeros(shape))

    with pytest.raises(ValueError, match="expected a 2-D"):
        load_response(path)


def test_the_refusal_names_the_shape_it_got(tmp_path):
    path = tmp_path / "fr_wrong.npy"
    np.save(path, np.zeros((5, 5, 5)))

    with pytest.raises(ValueError, match=r"\(5, 5, 5\)"):
        load_response(path)


def test_a_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_response(tmp_path / "absent.npy")


# --- domain_block: the shape ------------------------------------------------


def test_the_block_has_the_documented_shape():
    block = domain_block(labelled(25, t=7), 100)

    assert block.shape == (10, 10, 7)


def test_the_sample_axis_is_untouched():
    block = domain_block(np.zeros((625, 3999)), 100)

    assert block.shape[-1] == 3999


def test_the_full_grid_can_be_taken():
    block = domain_block(labelled(5), 25)

    assert block.shape[:2] == (5, 5)


def test_a_single_row_block():
    block = domain_block(labelled(5), 1)

    assert block.shape[:2] == (1, 1)


# --- domain_block: the corner, not the first rows ----------------------------


def test_the_block_is_the_corner_of_the_source_grid():
    # The heart of f26c95f. With the a*100 + b labelling, the 3 x 3 corner of a
    # 5 x 5 grid is exactly these nine values; response[:9] would instead give
    # rows 0..8, i.e. (0,0)..(1,3).
    block = domain_block(labelled(5), 9)

    np.testing.assert_array_equal(
        block[:, :, 0],
        [[0, 1, 2], [100, 101, 102], [200, 201, 202]],
    )


def test_the_block_is_not_the_first_n_paths_rows():
    # Stated as its own check because it is the specific mistake the docstring
    # warns against, and both forms have the right element count.
    response = labelled(5)
    block = domain_block(response, 9)

    naive = response[:9].reshape(3, 3, -1)
    assert not np.array_equal(block, naive)


def test_row_r_lands_at_a_b_with_r_equal_a_times_n_plus_b():
    # Pins the C-order claim directly rather than through its consequences.
    n, m = 25, 10
    response = labelled(n)
    block = domain_block(response, m * m)

    for a in range(m):
        for b in range(m):
            assert block[a, b, 0] == response[a * n + b, 0]


def test_the_block_reads_across_the_full_height_of_the_grid():
    # The 4 x 25 slab the naive slice produces spans only the first rows of
    # the grid; the real block must reach source row m-1.
    block = domain_block(labelled(25), 100)

    assert block[9, 0, 0] == 900


# --- domain_block: the refusals ---------------------------------------------


@pytest.mark.parametrize("rows", [2, 3, 24, 626])
def test_a_non_square_response_is_refused(rows):
    with pytest.raises(ValueError, match="not a perfect square"):
        domain_block(np.zeros((rows, 4)), 1)


def test_the_non_square_message_names_the_row_count():
    with pytest.raises(ValueError, match="626 rows"):
        domain_block(np.zeros((626, 4)), 1)


@pytest.mark.parametrize("n_paths", [2, 3, 99, 101])
def test_a_non_square_n_paths_is_refused(n_paths):
    with pytest.raises(ValueError, match="not a perfect square"):
        domain_block(labelled(25), n_paths)


def test_a_block_larger_than_the_grid_is_refused():
    # Silently clipping would hand back a smaller block than asked for and
    # the caller would index past its own expectations.
    with pytest.raises(ValueError, match="only"):
        domain_block(labelled(5), 100)


def test_the_oversized_message_names_both_grids():
    with pytest.raises(ValueError, match=r"10 x 10.*5 x 5"):
        domain_block(labelled(5), 100)


def test_n_and_m_are_derived_rather_than_assumed():
    # "other response files hold more than 625 rows": a 36 x 36 grid must work
    # with no 25 or 625 hardcoded anywhere.
    block = domain_block(labelled(36), 16)

    assert block.shape[:2] == (4, 4)
    assert block[3, 3, 0] == 303


# --- against the real dataset ------------------------------------------------
#
# The reference dataset lives outside the repo, so these skip when it is
# absent. They are worth the exception because the reciprocity behaviour is the
# one thing no synthetic fixture can settle: a labelled grid proves the
# indexing is self-consistent, not that it describes the physics.

REFERENCE_ROOT = Path(__file__).resolve().parent.parent.parent / "OUTPUT" / "store_largepix_wgrid"
have_reference = REFERENCE_ROOT.is_dir()
needs_reference = pytest.mark.skipif(
    not have_reference, reason=f"reference dataset not present at {REFERENCE_ROOT}"
)


def reference_block():
    return domain_block(load_response(find_response(REFERENCE_ROOT)), 100)


@needs_reference
def test_the_reference_response_matches_the_documented_shape():
    assert load_response(find_response(REFERENCE_ROOT)).shape == REFERENCE_SHAPE


@needs_reference
def test_the_reference_response_yields_the_ten_wide_domain():
    assert reference_block().shape == (10, 10, REFERENCE_SHAPE[1])


@needs_reference
def test_a_start_in_the_collecting_quarter_gives_a_unipolar_trace():
    # a580d01's measured claim, restated as a test: row (i, j) is the current
    # on ONE FIXED pad from an electron starting at (i, j). Inside that pad's
    # collecting quarter the charge arrives, so the trace never changes sign.
    block = reference_block()
    trace = block[2, 3]

    positive = trace[trace > 0].sum()
    negative = abs(trace[trace < 0].sum())
    assert positive > 1e-3, f"collected sum+ is only {positive}"
    assert negative < positive * 1e-9, f"collected trace swings negative: {negative}"


@needs_reference
def test_a_start_outside_it_gives_a_bipolar_trace_integrating_to_zero():
    # Pure induction as the electron passes: the two lobes must cancel.
    block = reference_block()
    trace = block[7, 3]

    positive = trace[trace > 0].sum()
    negative = abs(trace[trace < 0].sum())
    assert abs(positive - negative) < positive * 1e-6, (
        f"induced trace does not integrate to zero: +{positive} -{negative}"
    )


@needs_reference
def test_the_collected_trace_dominates_the_induced_one():
    block = reference_block()

    assert np.abs(block[2, 3]).max() > 5 * np.abs(block[7, 3]).max()


@needs_reference
def test_all_one_hundred_rows_are_distinct_responses():
    # a580d01 relies on this: the rows are not copies of one quarter.
    block = reference_block()
    seen = {block[i, j].tobytes() for i in range(10) for j in range(10)}

    assert len(seen) == 100


# --- the path index orientation ----------------------------------------------
#
# Nothing in this module converts a path index. But every caller does -- the
# viewer's selector maps a clicked cell to a block row -- and the convention is
# p = i*10 + j with i from x and j from y. THE fr FILE STATES NOTHING ABOUT ITS
# OWN ORIENTATION --
# this is inferred from the path start lattice, and a transposed response would
# otherwise pass silently, plotting a real waveform from the wrong pixel. So it
# is pinned here, against the lattice it was inferred from, before a caller
# bakes it in.

PATH_PITCH_MM = 0.44
PATHS_NPZ = REFERENCE_ROOT / "paths" / "drift3d.npz"
needs_paths = pytest.mark.skipif(
    not PATHS_NPZ.is_file(), reason=f"path lattice not present at {PATHS_NPZ}"
)


def path_starts() -> np.ndarray:
    """The (x, y) start of each drift path, in path-index order."""
    return np.load(PATHS_NPZ)["drift3d"][:, 0, :2]


@needs_paths
def test_the_path_lattice_is_ten_by_ten():
    assert path_starts().shape == (100, 2)


@needs_paths
def test_y_varies_fastest_along_the_path_index():
    # The orientation claim itself: consecutive path indices step in y, and it
    # is x that steps once every ten. Transposed, these two swap.
    starts = path_starts()

    np.testing.assert_allclose(starts[1] - starts[0], [0.0, PATH_PITCH_MM], atol=1e-9)
    np.testing.assert_allclose(starts[10] - starts[0], [PATH_PITCH_MM, 0.0], atol=1e-9)


@needs_paths
def test_the_first_three_starts_are_the_documented_ones():
    # Quoted in the step description; a changed dataset should say so loudly
    # rather than let the inference drift.
    np.testing.assert_allclose(
        path_starts()[:3], [[0.22, 0.22], [0.22, 0.66], [0.22, 1.10]], atol=1e-9
    )


@needs_paths
def test_path_index_p_is_i_times_ten_plus_j():
    # The mapping stated as arithmetic over the whole lattice, so it holds for
    # every path rather than the handful spot-checked above.
    starts = path_starts()
    origin = starts[0]

    for p, (x, y) in enumerate(starts):
        i, j = divmod(p, 10)
        assert round((x - origin[0]) / PATH_PITCH_MM) == i, f"path {p}: x is not i"
        assert round((y - origin[1]) / PATH_PITCH_MM) == j, f"path {p}: y is not j"


@needs_paths
def test_the_lattice_is_the_width_of_the_response_block():
    # p = i*10 + j is only meaningful if the block is 10 wide: the path count
    # and the domain block have to describe the same grid.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), len(path_starts()))

    assert block.shape[:2] == (10, 10)
