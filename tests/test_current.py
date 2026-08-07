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
    PIXEL_OFFSET,
    partner_index,
    domain_block,
    load_response,
    pixel_traces,
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


# --- pixel_traces ------------------------------------------------------------
#
# a580d01 changed the return to an ordered list of {"index": [a, b], "trace"}
# and deliberately dropped the central/neighbor_x/neighbor_y/diagonal names.
# That was the right call and it is worth recording why, because the names are
# the obvious thing to reintroduce: they assert which pad collects the charge,
# and that assertion rotates with the quarter. It held for the 25 starts in the
# first quarter and was wrong for the other 75, which filed their collection
# trace under an induction heading -- and a mislabelled plot looks plausible.
# The tests below therefore check INDICES and measured physics, never a role.


def block10(t: int = 3) -> np.ndarray:
    return domain_block(labelled(10, t), 100)


def indices(traces) -> list[tuple[int, int]]:
    return [tuple(entry["index"]) for entry in traces]


def test_four_partner_traces_are_returned():
    traces = pixel_traces(block10(), 0, 0)

    assert len(traces) == 4
    assert all(set(entry) == {"index", "trace"} for entry in traces)


def test_the_partners_are_the_cells_the_docstring_names():
    # "a start at (7, 2) reads (7, 2), (2, 2), (7, 7) and (2, 7)".
    assert indices(pixel_traces(block10(), 7, 2)) == [(7, 2), (2, 2), (7, 7), (2, 7)]


def test_the_order_is_start_then_x_then_y_then_both():
    # The order is the contract now that there are no keys: a caller labels
    # panels from position, so a reordering would silently swap two plots.
    assert indices(pixel_traces(block10(), 1, 2)) == [(1, 2), (6, 2), (1, 7), (6, 7)]


def test_the_first_entry_is_always_the_start_itself():
    block = block10()

    for i in (0, 4, 5, 9):
        for j in (0, 4, 5, 9):
            assert indices(pixel_traces(block, i, j))[0] == (i, j)


def test_each_trace_is_the_cell_its_index_names():
    # The pairing is the whole payload; a trace under the wrong index is the
    # mislabelling this shape exists to prevent.
    block = block10()

    for entry in pixel_traces(block, 3, 4):
        a, b = entry["index"]
        np.testing.assert_array_equal(entry["trace"], block[a, b])


def test_no_role_names_are_reintroduced():
    # A regression guard with a reason: see the module note above and
    # pochoir_viewer-154c.
    traces = pixel_traces(block10(), 7, 3)

    for entry in traces:
        assert "central" not in entry
        assert "neighbor_x" not in entry


def test_the_traces_are_views_not_copies():
    block = block10()

    entry = pixel_traces(block, 0, 0)[0]

    assert entry["trace"].base is not None


def test_a_trace_keeps_the_full_sample_axis():
    for entry in pixel_traces(block10(t=3999), 0, 0):
        assert entry["trace"].shape == (3999,)


def test_the_four_cells_are_distinct_in_every_quarter():
    block = block10()

    for i in range(10):
        for j in range(10):
            assert len(set(indices(pixel_traces(block, i, j)))) == 4, f"({i}, {j})"


def test_every_start_in_the_block_is_accepted():
    # The point of 94799a9: three quarters of the domain used to raise.
    block = block10()

    for i in range(10):
        for j in range(10):
            assert len(pixel_traces(block, i, j)) == 4


@pytest.mark.parametrize("i, j", [(-1, 0), (0, -1), (10, 0), (0, 10), (99, 99)])
def test_a_start_outside_the_block_is_refused(i, j):
    with pytest.raises(ValueError, match="outside the"):
        pixel_traces(block10(), i, j)


def test_the_refusal_names_the_position_and_the_block():
    with pytest.raises(ValueError, match=r"\(12, 2\).*10x10"):
        pixel_traces(block10(), 12, 2)


def test_the_partner_relation_is_its_own_inverse():
    # partner(partner(k)) == k, or the four cells would not close into two
    # pairs.
    for half in (2, 5, 8):
        for k in range(2 * half):
            assert partner_index(partner_index(k, half), half) == k


def test_the_partner_mirrors_rather_than_always_adding():
    # Always adding is what ran off the end of the block for k >= half.
    assert partner_index(2, 5) == 7
    assert partner_index(7, 5) == 2


def test_the_half_width_is_derived_from_the_block():
    # "half is derived from the block shape": a 6x6 block must use 3.
    block = domain_block(labelled(6), 36)

    assert indices(pixel_traces(block, 1, 1)) == [(1, 1), (4, 1), (1, 4), (4, 4)]


def test_a_narrow_block_no_longer_indexes_out_of_range():
    # This used to die on a bare numpy IndexError: the old guard checked i and
    # j against PIXEL_OFFSET but never the block width.
    small = domain_block(labelled(10), 16)

    assert indices(pixel_traces(small, 0, 0)) == [(0, 0), (2, 0), (0, 2), (2, 2)]


def test_pixel_offset_is_half_the_reference_domain_width():
    # Kept as the documented value for the 10-wide domain even though
    # pixel_traces no longer reads it.
    assert PIXEL_OFFSET == 5


def test_the_four_cells_are_the_same_set_across_a_quarter_group():
    # Not a defect -- a property worth stating, because it is what makes the
    # selector's extra 75 cells redundant rather than informative. Every start
    # in a quarter group reads the same four cells; only the order differs.
    block = block10()
    base = set(indices(pixel_traces(block, 2, 3)))

    for i, j in [(7, 3), (2, 8), (7, 8)]:
        assert set(indices(pixel_traces(block, i, j))) == base


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
def test_exactly_one_of_the_four_partners_is_a_collection():
    # Whatever the caller labels them, each set of four contains one arriving
    # charge and three inductions. That is the invariant a panel layout can
    # safely be built on.
    block = reference_block()

    for i, j in [(2, 3), (7, 3), (2, 8), (7, 8), (0, 0), (9, 9)]:
        collected = [
            entry
            for entry in pixel_traces(block, i, j)
            if entry["trace"].min() > -1e-9
        ]
        assert len(collected) == 1, (
            f"({i}, {j}) has {len(collected)} unipolar traces, expected exactly 1"
        )


@needs_reference
def test_all_one_hundred_rows_are_distinct_responses():
    # a580d01 relies on this: the rows are not copies of one quarter.
    block = reference_block()
    seen = {block[i, j].tobytes() for i in range(10) for j in range(10)}

    assert len(seen) == 100


@needs_reference
def test_the_four_partner_cells_repeat_across_a_quarter_group():
    # The redundancy noted synthetically above, confirmed on real data: 100
    # starts, 25 distinct sets of four. Relevant to pochoir_viewer-u9ht --
    # the extra cells are redundant rather than invalid.
    block = reference_block()
    sets = {
        frozenset(tuple(e["index"]) for e in pixel_traces(block, i, j))
        for i in range(10)
        for j in range(10)
    }

    assert len(sets) == 25


# --- the path index orientation ----------------------------------------------
#
# pixel_traces takes (i, j) directly, so nothing in this module yet converts a
# path index. But every caller will, and the convention is p = i*10 + j with i
# from x and j from y. THE fr FILE STATES NOTHING ABOUT ITS OWN ORIENTATION --
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
