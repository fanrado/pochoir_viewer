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


def block10(t: int = 3) -> np.ndarray:
    return domain_block(labelled(10, t), 100)


def test_the_four_named_traces_are_returned():
    traces = pixel_traces(block10(), 0, 0)

    assert set(traces) == {"central", "neighbor_x", "neighbor_y", "diagonal"}


def test_each_trace_is_the_row_the_docstring_names():
    block = block10()
    i, j = 2, 3

    traces = pixel_traces(block, i, j)

    assert traces["central"][0] == 203
    assert traces["neighbor_x"][0] == 703  # (i + 5, j)
    assert traces["neighbor_y"][0] == 208  # (i, j + 5)
    assert traces["diagonal"][0] == 708  # (i + 5, j + 5)


def test_the_offsets_are_the_module_constant_not_a_literal():
    # If PIXEL_OFFSET moves, the traces must move with it; a hardcoded 5 in
    # the body would leave the constant lying about what is drawn.
    block = block10()
    i, j = 1, 1

    traces = pixel_traces(block, i, j)

    np.testing.assert_array_equal(traces["neighbor_x"], block[i + PIXEL_OFFSET, j])
    np.testing.assert_array_equal(traces["neighbor_y"], block[i, j + PIXEL_OFFSET])


def test_the_four_traces_are_four_distinct_rows():
    # The reciprocity claim: one path induces on four pixels, read from four
    # different source rows rather than four copies of one.
    traces = pixel_traces(block10(), 4, 4)

    firsts = {float(v[0]) for v in traces.values()}
    assert len(firsts) == 4


def test_a_trace_keeps_the_full_sample_axis():
    traces = pixel_traces(block10(t=3999), 0, 0)

    assert all(v.shape == (3999,) for v in traces.values())


def test_the_traces_are_views_not_copies():
    # Cheap to plot many of; also documents that mutating one edits the block.
    block = block10()
    traces = pixel_traces(block, 0, 0)

    assert traces["central"].base is not None


def test_every_position_in_the_central_quarter_is_accepted():
    block = block10()

    for i in range(PIXEL_OFFSET):
        for j in range(PIXEL_OFFSET):
            assert pixel_traces(block, i, j)["central"][0] == i * 100 + j


@pytest.mark.parametrize("i, j", [(-1, 0), (0, -1), (10, 0), (0, 10), (99, 99)])
def test_a_start_outside_the_block_is_refused(i, j):
    # 94799a9 opened every quarter; only indices off the block are invalid now.
    with pytest.raises(ValueError, match="outside the"):
        pixel_traces(block10(), i, j)


def test_the_refusal_names_the_position_and_the_block(i=12, j=2):
    with pytest.raises(ValueError, match=r"\(12, 2\).*10x10"):
        pixel_traces(block10(), i, j)


def test_every_start_in_the_block_is_now_accepted():
    # The point of 94799a9: three quarters of the domain used to raise.
    block = block10()

    for i in range(10):
        for j in range(10):
            assert set(pixel_traces(block, i, j)) == {
                "central", "neighbor_x", "neighbor_y", "diagonal"
            }


def test_the_partner_relation_is_its_own_inverse():
    # partner(partner(k)) == k, or the four traces would not be a closed set
    # of two pixel pairs.
    for half in (2, 5, 8):
        for k in range(2 * half):
            assert partner_index(partner_index(k, half), half) == k


def test_the_partner_mirrors_rather_than_always_adding():
    assert partner_index(2, 5) == 7
    assert partner_index(7, 5) == 2


def test_the_half_width_is_derived_from_the_block():
    # "half is derived from the block, never hardcoded": a 6x6 block must use
    # 3, not PIXEL_OFFSET.
    block = domain_block(labelled(6), 36)

    traces = pixel_traces(block, 1, 1)

    assert traces["neighbor_x"][0] == block[4, 1, 0]


def test_the_first_quarter_is_unchanged_by_the_generalisation():
    # Whatever else moved, the 25 starts that already worked must read the
    # same four cells as before.
    block = block10()

    for i in range(PIXEL_OFFSET):
        for j in range(PIXEL_OFFSET):
            traces = pixel_traces(block, i, j)
            assert traces["central"][0] == block[i, j, 0]
            assert traces["neighbor_x"][0] == block[i + PIXEL_OFFSET, j, 0]
            assert traces["neighbor_y"][0] == block[i, j + PIXEL_OFFSET, 0]
            assert traces["diagonal"][0] == block[i + PIXEL_OFFSET, j + PIXEL_OFFSET, 0]


def test_the_four_traces_stay_distinct_in_every_quarter():
    block = block10()

    for i, j in [(7, 2), (2, 7), (7, 7), (9, 9)]:
        firsts = {float(v[0]) for v in pixel_traces(block, i, j).values()}
        assert len(firsts) == 4, f"({i}, {j}) returned duplicate cells"


# --- the assumption the docstring flags --------------------------------------


def test_a_narrow_block_no_longer_indexes_out_of_range():
    # This used to die on a bare numpy IndexError: the guard checked i and j
    # against PIXEL_OFFSET but never the block width. 94799a9 derives the
    # half-width from the block, which closes it.
    small = domain_block(labelled(10), 16)

    traces = pixel_traces(small, 0, 0)

    assert traces["neighbor_x"][0] == small[2, 0, 0]


# --- against the real dataset ------------------------------------------------
#
# The reference dataset lives outside the repo, so these skip when it is
# absent. They are worth the exception because the +5 reciprocity offsets are
# the one thing in this module that no synthetic fixture can validate: a
# labelled grid proves the indexing is self-consistent, not that it names the
# right pixels. Physics can.

REFERENCE_ROOT = Path(__file__).resolve().parent.parent.parent / "OUTPUT" / "store_largepix_wgrid"
have_reference = REFERENCE_ROOT.is_dir()
needs_reference = pytest.mark.skipif(
    not have_reference, reason=f"reference dataset not present at {REFERENCE_ROOT}"
)


@needs_reference
def test_the_reference_response_matches_the_documented_shape():
    response = load_response(find_response(REFERENCE_ROOT))

    assert response.shape == REFERENCE_SHAPE


@needs_reference
def test_the_reference_response_yields_the_ten_wide_domain():
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)

    assert block.shape == (10, 10, REFERENCE_SHAPE[1])


@needs_reference
def test_the_central_trace_dominates_its_neighbours():
    # The reciprocity check. If the +5 offsets named the wrong rows there
    # would be no reason for this ordering to hold: collection on the central
    # pixel is an order of magnitude above the induced neighbour signals, and
    # the diagonal -- furthest away -- is the smallest of the four.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)
    traces = pixel_traces(block, 2, 3)
    peak = {k: float(np.abs(v).max()) for k, v in traces.items()}

    assert peak["central"] > 5 * peak["neighbor_x"]
    assert peak["central"] > 5 * peak["neighbor_y"]
    assert peak["diagonal"] < peak["neighbor_x"]
    assert peak["diagonal"] < peak["neighbor_y"]


@needs_reference
def test_the_two_neighbours_are_comparable_to_each_other():
    # x and y are symmetric in the geometry, so a swapped or duplicated offset
    # would most likely show up as one of them collapsing.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)
    traces = pixel_traces(block, 2, 3)
    x = float(np.abs(traces["neighbor_x"]).max())
    y = float(np.abs(traces["neighbor_y"]).max())

    assert 0.5 < x / y < 2.0, f"neighbour peaks are lopsided: x={x}, y={y}"


@needs_reference
def test_the_central_trace_is_a_unipolar_collection_signal():
    # Collection integrates to the drifted charge; the induced neighbour
    # traces are bipolar and integrate to near zero. That difference is the
    # clearest evidence the central row is the one being collected on.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)
    traces = pixel_traces(block, 2, 3)

    central = traces["central"]
    assert central.min() > -1e-9, "the central trace swings negative"
    for name in ("neighbor_x", "neighbor_y"):
        assert traces[name].min() < 0, f"{name} is not bipolar"


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


# --- does the generalisation put the collection on the right panel? ----------
#
# 94799a9 opened all four quarters, and its docstring claims the keys are
# relative to the electron's own quarter: "central is the pixel whose quarter
# contains this start, whichever quarter that is".
#
# The real data disagrees. The collecting pad's trace is unipolar and an order
# of magnitude above the three induced ones -- that signature is what
# identifies it, and it does NOT stay on the `central` key outside the first
# quarter. Measured over all 100 starts, the key carrying it is:
#
#     C C C C C Y Y Y Y Y      rows are i, columns are j
#     ...                      (5 rows of C/Y, then 5 of X/D)
#     X X X X X D D D D D
#
# i.e. exactly the quarter (i//5, j//5). So for 75 of the 100 starts the panel
# labelled "central" shows a neighbour's induced current while one of the
# neighbour panels shows the collection. That is worse than the RangeError it
# replaced: a mislabelled plot looks entirely correct.
#
# The fix is to FOLD the start into the first quarter rather than mirror the
# partner: central = block[i % half, j % half], partners at +half. Verified
# against the dataset -- folding (7, 3) to (2, 3) recovers the unipolar
# 1.87e-3 collection trace that the current code files under neighbor_x.


@needs_reference
def test_the_central_panel_carries_the_collection_in_every_quarter():
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)

    def collecting_key(i, j):
        traces = pixel_traces(block, i, j)
        return max(traces, key=lambda k: np.abs(traces[k]).max())

    wrong = [
        (i, j, collecting_key(i, j))
        for i in range(10)
        for j in range(10)
        if collecting_key(i, j) != "central"
    ]

    assert wrong == [], (
        f"{len(wrong)} of 100 starts put the collection signal on a neighbour "
        f"panel; e.g. {wrong[:3]}"
    )


@needs_reference
def test_the_central_trace_is_unipolar_wherever_the_start_is():
    # The same defect stated physically rather than by ranking: collection
    # integrates the drifted charge and never changes sign; the induced
    # neighbour traces are bipolar.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)

    bipolar = [
        (i, j)
        for i in range(10)
        for j in range(10)
        if pixel_traces(block, i, j)["central"].min() < -1e-9
    ]

    assert bipolar == [], (
        f"the central panel is bipolar for {len(bipolar)} starts, so it is "
        f"not showing a collection signal; e.g. {bipolar[:3]}"
    )


@needs_reference
def test_folding_into_the_first_quarter_would_recover_the_collection():
    # Not a demand for this exact implementation -- evidence that the fix is
    # available and that the physics is symmetric, so every pad sees the same
    # four traces at the same relative start.
    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)
    half = block.shape[0] // 2

    for i, j in [(7, 3), (2, 8), (7, 8), (9, 9)]:
        folded = pixel_traces(block, i % half, j % half)
        assert folded["central"].min() > -1e-9, f"({i}, {j}) folded is not unipolar"
        peaks = {k: float(np.abs(v).max()) for k, v in folded.items()}
        assert peaks["central"] > 5 * peaks["neighbor_x"], f"({i}, {j}) folded"
