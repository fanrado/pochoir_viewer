"""The 'induced-current view' README section must match the code (cd1c937).

This section documents things no reader can check for themselves: which
response row belongs to which path, why one path yields four traces, and how
3999 ticks map onto 400 stored points. Prose is the only place those are
written down, so it is the only place they can rot. Each claim here is checked
against the constant or the function that implements it, never restated.

The section also gives a worked selection example, which is a stronger promise
than prose: an example that crashes the page is worse than no example.
"""

import re
from pathlib import Path

import numpy as np
import pytest

from pochoir_viewer.current import PIXEL_OFFSET, domain_block, pixel_traces

N_GRID = 25
N_PATHS = 100


def labelled_response(n: int = N_GRID, t: int = 4) -> np.ndarray:
    """A response the shape of the reference one, values irrelevant here."""
    return np.zeros((n * n, t))

README = Path(__file__).resolve().parent.parent / "README.md"
ROOT = README.parent

text = README.read_text()
current_py = (ROOT / "pochoir_viewer" / "current.py").read_text()
build_js = (ROOT / "web" / "current_build.js").read_text()
view_js = (ROOT / "web" / "current_view.js").read_text()
anim_js = (ROOT / "web" / "drift_anim.js").read_text()

REFERENCE_ROOT = Path(__file__).resolve().parent.parent.parent / "OUTPUT" / "store_largepix_wgrid"
needs_reference = pytest.mark.skipif(
    not REFERENCE_ROOT.is_dir(), reason=f"reference dataset not present at {REFERENCE_ROOT}"
)


HEADING = "## The induced-current view"


def section() -> str:
    start = text.index(HEADING)
    rest = text[start + len(HEADING) :]
    end = rest.find("\n## ")
    return rest if end == -1 else rest[:end]


def flat() -> str:
    """The section as prose: hard wrapping and blockquote markers removed.

    The README wraps, so a quoted phrase can straddle a line break, and the
    reciprocity note is a blockquote whose `>` markers land mid-sentence once
    the wrapping is collapsed.
    """
    body = re.sub(r"^\s*>\s?", "", section(), flags=re.M)
    return " ".join(body.split())


def test_the_section_exists():
    assert HEADING in text


# --- the worked selection example --------------------------------------------


def documented_selection() -> list[tuple[int, int]]:
    """The `{i,j}` pairs the multi-select paragraph tells the reader to pick."""
    paragraph = section()[section().index("multi-select") :]
    paragraph = paragraph[: paragraph.index("\n\n")]
    return [(int(a), int(b)) for a, b in re.findall(r"\{(\d+),\s*(\d+)\}", paragraph)]


def test_the_example_names_several_paths():
    assert len(documented_selection()) >= 2, "the multi-select example picks fewer than two"


def test_every_path_in_the_example_can_actually_be_selected():
    # Was red under the old central-quarter restriction: two of the four cells
    # the README names threw a RangeError (pochoir_viewer-u9ht). 94799a9 opened
    # every quarter, so the rule is now the block bounds. Checked by CALLING
    # pixel_traces rather than restating a range, so whichever side moves next
    # the two are compared directly.
    block = domain_block(labelled_response(), N_PATHS)

    broken = []
    for i, j in documented_selection():
        try:
            pixel_traces(block, i, j)
        except Exception as error:  # noqa: BLE001 -- any failure is a broken example
            broken.append(f"({i}, {j}): {type(error).__name__}")

    assert broken == [], (
        "the README tells the reader to select cells that fail: " + ", ".join(broken)
    )


def test_the_example_curve_count_matches_the_paths_it_picks():
    # "every panel draws four curves, one per path" has to agree with the
    # number of paths the same sentence names.
    paragraph = section()[section().index("multi-select") :]
    paragraph = paragraph[: paragraph.index("\n\n")]
    stated = re.search(r"draws (\w+) curves", paragraph)

    assert stated, "the example no longer says how many curves are drawn"
    words = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
    assert words.get(stated.group(1)) == len(documented_selection())


# --- the reciprocity offsets --------------------------------------------------


def offset_table() -> dict[str, str]:
    """The panel -> block-index table."""
    rows = re.findall(r"\| ([\w-]+) \| `block\[([^\]]+)\]` \|", section())
    return {panel: index for panel, index in rows}


def test_the_offset_table_covers_all_four_panels():
    assert set(offset_table()) == {"central", "x-neighbour", "y-neighbour", "diagonal"}


def test_the_documented_offsets_are_the_shipped_offset():
    # The table hardcodes +5; PIXEL_OFFSET is what the code uses. If the
    # constant moves, the table becomes wrong in a way no reader can detect.
    table = offset_table()

    assert table["central"] == "i, j"
    assert table["x-neighbour"] == f"i+{PIXEL_OFFSET}, j"
    assert table["y-neighbour"] == f"i, j+{PIXEL_OFFSET}"
    assert table["diagonal"] == f"i+{PIXEL_OFFSET}, j+{PIXEL_OFFSET}"


def test_the_documented_offset_matches_the_implementation_that_has_it():
    # The +5 table describes pixel_traces, which is Python-side and still
    # there. 75cf870 removed the partner machinery from the BROWSER helper --
    # the view stopped using it at 7c529b6 when panels became selection slots
    # -- so requiring the constant there would now fail on working code.
    assert f"PIXEL_OFFSET = {PIXEL_OFFSET}" in current_py
    assert "PIXEL_OFFSET" not in build_js, (
        "the browser helper carries the offset again; if the partner machinery "
        "is back, this test should check both implementations agree"
    )


def test_the_split_is_stated_as_the_offset_doubled():
    # "The 10-wide domain splits 5 + 5" -- the two halves are what make the
    # offset meaningful.
    assert f"splits {PIXEL_OFFSET} + {PIXEL_OFFSET}" in flat()


def test_the_assumption_is_flagged_rather_than_presented_as_fact():
    # The source carries an explicit ASSUMPTION note; the doc must not read
    # more confidently than the code it describes.
    body = section()

    assert "not from anything recorded in the file" in flat()
    assert "assumption" in body.lower()


# --- the row-to-path mapping --------------------------------------------------


def test_the_c_order_rule_is_stated_as_the_code_implements_it():
    body = section()

    assert "r = a*N + b" in flat()
    assert "N = isqrt(R)" in flat()
    assert "isqrt" in current_py


def test_the_not_the_first_rows_warning_survives():
    # The specific mistake domain_block's docstring warns about, and the one
    # that would produce plausible-looking wrong waveforms.
    body = section()

    assert "not the first" in flat()
    assert "response[:100]" in flat()


def test_the_worked_stride_example_is_arithmetically_right():
    # "rows 0-9, 25-34, 50-59, ... for N = 25, M = 10"
    body = flat()
    assert "N = 25, M = 10" in body
    for start in (0, 25, 50):
        assert f"{start}–{start + 9}" in body or f"{start}-{start + 9}" in body


def test_the_slab_shape_matches_the_stride_example():
    # 100 rows of a 25-wide grid is 4 x 25.
    assert "4 x 25" in flat()


# --- the tick mapping ---------------------------------------------------------


def test_the_documented_tick_formula_matches_tickToIndex():
    # 66a850a rewrote this for the two-conversion mapping. tickToIndex lives in
    # drift_anim.js -- current_build.js has the similarly-shaped tickToX, which
    # maps to pixels, not path index.
    body = flat()

    assert "`k * points_per_tick`" in body
    assert "min(raw / (path_steps - 1), 1) * (N - 1)" in body
    assert "const raw = k * pointsPerTick;" in anim_js
    assert "Math.min(raw / (steps - 1), 1)" in anim_js
    assert "fraction * (nPoints - 1)" in anim_js


def test_the_old_proportional_stretch_is_not_still_documented():
    # It was the formula here until 66a850a; leaving it would describe timing
    # the viewer no longer uses.
    assert "k/(T-1) * (N-1)" not in flat()


def test_the_two_clocks_are_explained_rather_than_assumed():
    body = flat()

    assert "not on the same clock" in body
    assert "recorded in `current.json`, never assumed" in body


def test_the_parking_behaviour_is_documented_with_its_reason():
    # The defect b36f0a0 fixed, and the one a reader would otherwise report as
    # a rendering glitch.
    body = flat()

    assert "parks when its own electron is collected" in body
    assert "1810" in body
    assert "moved in lockstep while their currents spiked at four different times" in body


def test_the_decimation_cap_matches_the_cli_default():
    cli = (ROOT / "pochoir_viewer" / "cli.py").read_text()
    block = cli[cli.index('"--max-points"') : cli.index('"--max-points"') + 300]
    default = re.search(r"default=(\d+)", block).group(1)

    assert f"decimated to at most {default} points" in flat()


def test_the_point_count_is_documented_as_per_path():
    # decimate() returns fewer points for short paths; a reader assuming 400
    # everywhere would misread the animation.
    assert "read per path" in flat()
    assert "decimate()" in flat()


def test_the_quoted_arrival_fraction_is_arithmetically_right():
    # "path 0 ends at 1810 of the 4000 stored points, so it reaches the anode
    # at about 45% of the tick window."
    body = flat()
    steps = int(re.search(r"path 0 ends at (\d+) of the (\d+) stored points", body).group(1))
    stored = int(re.search(r"path 0 ends at (\d+) of the (\d+) stored points", body).group(2))

    assert round(100 * steps / stored) == 45, (
        f"{steps} of {stored} is {100 * steps / stored:.0f}%, not the quoted 45%"
    )


@needs_reference
def test_the_quoted_path_length_matches_the_data():
    from pochoir_viewer.paths import load_paths, trim_stagnant

    paths, _ = load_paths(REFERENCE_ROOT)
    shortest = min(len(trim_stagnant(p)) for p in paths)

    assert shortest == 1810, f"the shortest path is {shortest} steps, not the quoted 1810"
    assert paths.shape[1] == 4000, f"paths are stored at {paths.shape[1]} points, not 4000"


# --- the claims about the view's behaviour ------------------------------------


def test_the_slot_semantics_are_described():
    body = flat()

    assert "four **selection slots**" in body
    assert "not one path's neighbours" in body
    assert "Panel *n*" in body and "*n*th selected path" in body
    assert "the other three stay completely blank" in body


def test_the_fill_order_matches_the_grid():
    # Source order in index.html is central, neighbor-x, neighbor-y, diagonal
    # in a 2-column grid, so slots fill top-left, top-right, bottom-left,
    # bottom-right. A reader checks the panel they expect against this.
    body = flat()

    assert "only the top-left panel has content" in body
    assert "The second selection fills the top-right, the third the bottom-left, the fourth the bottom-right." in body


def test_the_four_slot_cap_and_its_refusal_are_documented():
    body = flat()

    assert "up to four" in body
    assert "four is the limit" in body
    assert "a fifth click is refused outright" in body
    assert "the cell does not toggle" in body


def test_the_slot_reuse_is_documented():
    # Why an ordered array rather than a set: the panel position is stable.
    body = flat()

    assert "Deselecting frees that slot in place" in body
    assert "keeps its panel position" in body


def test_the_reciprocity_subsection_disclaims_the_panels():
    # It documents a real relationship that the VIEW no longer draws; without
    # the note a reader would map the table onto the four panels.
    body = flat()

    assert "Not what the panels show" in body
    assert "nothing in the viewer draws it any more" in body
    assert "| pad | row |" in section(), "the table header still says 'panel'"


def test_the_panels_section_describes_what_the_panels_now_show():
    # 7c529b6 changed what a panel IS: panel n is selection slot n, showing the
    # nth selected path's own trace. The section still describes the previous
    # design -- four pad-role panels for ONE path, sharing one vertical scale.
    stale = [
        phrase
        for phrase in (
            "share one vertical scale",
            "The **central** pixel and the **diagonal** neighbour",
            "every panel draws four curves",
        )
        if phrase in flat()
    ]

    assert stale == [], (
        "the README still describes the pre-7c529b6 panels:\n" + "\n".join(stale)
    )


def test_the_shared_scale_claim_matches_the_code():
    # The claim and the code have to agree whichever way this is resolved.
    documented = "share one vertical scale" in flat()
    implemented = "function sharedPeak()" in view_js

    assert documented == implemented, (
        f"README documents a shared scale ({documented}) but the code "
        f"{'has' if implemented else 'does not have'} one"
    )


def test_the_per_panel_peak_is_documented_if_the_scales_differ():
    # With per-panel autoscale the title's peak is the ONLY thing making the
    # four comparable, so it has to be documented -- and the warning matters
    # more than the mechanism, since the natural reading of two same-height
    # curves is that they are the same size.
    if "function sharedPeak()" in view_js:
        return

    body = flat()
    assert "autoscales to its own trace" in body
    assert "curve heights are not comparable between panels" in body
    assert "peak printed in each title" in body
    assert "read that, not the drawn amplitude" in body.lower()


def test_the_title_really_does_carry_the_peak():
    # The doc's advice is only useful if the code prints it.
    assert "peak ${peak.toExponential(2)}" in view_js


# --- the quoted amplitudes, against the real dataset --------------------------

def reference_peaks():
    from pochoir_viewer.current import load_response
    from pochoir_viewer.io import find_response

    block = domain_block(load_response(find_response(REFERENCE_ROOT)), 100)
    return np.abs(block).max(axis=2)


@needs_reference
def test_the_quoted_near_pad_peak_matches_the_data():
    # "A path near the pad it lands on peaks around 1.8e-3".
    peaks = reference_peaks()
    near = peaks[:5, :5]

    assert 1.5e-3 < near.min() and near.max() < 2.5e-3, (
        f"the near-pad quarter peaks at {near.min():.2e}..{near.max():.2e}, "
        "not around 1.8e-3"
    )


@needs_reference
def test_the_quoted_far_peak_matches_the_data():
    # "one several cells away around 5e-5". The far quarter tops out at
    # 4.96e-5 at (5, 5), so the quoted figure is its upper end.
    peaks = reference_peaks()
    far = peaks[5:, 5:]

    assert far.max() < 6e-5 and far.min() > 2e-5, (
        f"the far quarter peaks at {far.min():.2e}..{far.max():.2e}, not around 5e-5"
    )


@needs_reference
def test_the_two_quoted_figures_really_do_differ_by_orders_of_magnitude():
    # The claim the warning rests on: "may differ by orders of magnitude",
    # while both are drawn the same height.
    peaks = reference_peaks()

    ratio = peaks.max() / peaks.min()
    assert ratio > 50, f"the widest peak ratio is only {ratio:.0f}x"


def test_the_single_tick_counter_is_documented():
    body = section()

    assert "single tick counter" in flat()
    assert "One counter, not two" in flat()


def test_the_stop_at_the_end_claim_matches_the_code():
    viewer_js = (ROOT / "web" / "viewer.js").read_text()
    body = section()

    assert "stops at the final tick" in flat()
    assert "rather than looping" in flat()
    assert "tick >= nTicks - 1" in viewer_js


def test_the_selection_reset_claim_matches_the_code():
    viewer_js = (ROOT / "web" / "viewer.js").read_text()

    assert "resets the animation to tick 0" in flat()
    # Scoped to applyPathSelection's own body rather than a character window:
    # c75d7c2 added a try/catch that pushed the reset past any fixed span.
    body = viewer_js[viewer_js.index("function applyPathSelection()") :]
    body = body[: body.index("\n}\n")]
    assert "tick = 0" in body
    assert "setCursor(0)" in body


def test_the_time_axis_unit_claim_matches_the_payload_field():
    body = section()

    assert "time_step_us" in flat()
    assert "never in raw ticks" in flat()


# --- the cross-reference ------------------------------------------------------


def test_the_export_cross_reference_resolves():
    anchors = re.findall(r"\]\(#([\w-]+)\)", section())
    slugs = {
        re.sub(r"[^\w -]", "", h).strip().lower().replace(" ", "-")
        for h in re.findall(r"^#+ (.+)$", text, re.M)
    }

    for anchor in anchors:
        assert anchor in slugs, f"the section links to #{anchor}, which is not a heading"


def test_it_points_at_the_right_export_product():
    # "product 5" in the regeneration section is export-current.
    assert "product 5" in flat()
    regen = text[text.index("## Regenerating the input data") :]
    assert "**5. Induced current**" in regen
