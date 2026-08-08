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

import pochoir_viewer.current as current_module
from pochoir_viewer.current import domain_block

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


def html_source() -> str:
    return (ROOT / "web" / "index.html").read_text()

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
    # the README names threw a RangeError (pochoir_viewer-u9ht). Every quarter
    # is selectable now, and with pixel_traces gone the check is simply that
    # each documented cell is inside the block the payload ships.
    block = domain_block(labelled_response(), N_PATHS)
    rows, cols = block.shape[0], block.shape[1]

    outside = [
        f"({i}, {j})"
        for i, j in documented_selection()
        if not (0 <= i < rows and 0 <= j < cols)
    ]

    assert outside == [], (
        "the README tells the reader to select cells outside the block: "
        + ", ".join(outside)
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


# --- the reciprocity rule is gone ---------------------------------------------
#
# Phase K removed the partner machinery from both implementations and Phase L
# removed the prose. What is left to protect is that the OLD MEANING does not
# creep back: a reader who carries it across reads every panel as a neighbouring
# pad rather than as its own selected path.


def test_the_section_does_not_describe_partner_pads():
    body = flat()

    for stale in ("x-neighbour", "y-neighbour", "reciprocity", "block[i+"):
        assert stale not in body, f"the section still describes partner pads: {stale!r}"


def test_the_section_names_removed_functions_nowhere():
    for name in ("pixel_traces", "tracesForPath", "partner_index", "PIXEL_OFFSET"):
        assert not hasattr(current_module, name), f"{name} is back in the module"
        assert name not in flat(), f"the section still points at {name}"


def test_the_panels_are_stated_to_be_four_separate_electrons():
    # The correction that matters: the previous README described one electron's
    # effect on four pads, so silence here would let the old reading survive.
    body = flat()

    assert "not one electron" in body, "the section does not rule out the old reading"
    assert "own pad" in body



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


# --- the zoom controls (f546137) ---------------------------------------------
#
# Zoom is the second way the four panels stop being comparable, after the
# per-panel amplitude scaling. Both are read off labels rather than seen in the
# picture, so the doc is doing the work the picture cannot. Each documented
# gesture is checked against the handler that implements it.

view_js_zoom = view_js


def zoom_section() -> str:
    start = text.index("### Zooming the time axis")
    rest = text[start:]
    end = rest.find("\n### ", 1)
    body = rest if end == -1 else rest[:end]
    return " ".join(body.split())


def test_the_zoom_section_exists():
    assert "### Zooming the time axis" in text


def test_every_documented_gesture_has_a_handler():
    # A table promising a gesture the code does not wire is a bug report
    # waiting to be filed.
    body = zoom_section()

    assert "drag horizontally" in body and 'addEventListener("pointerdown"' in view_js
    assert "wheel over a panel" in body and 'addEventListener("wheel"' in view_js
    assert "double-click a panel" in body and 'addEventListener("dblclick"' in view_js


def test_every_wired_gesture_is_documented():
    # The other direction: an undocumented gesture is undiscoverable, and this
    # panel gives no visual hint that zoom exists at all.
    for handler, phrase in (
        ("pointerdown", "drag"),
        ("wheel", "wheel"),
        ("dblclick", "double-click"),
    ):
        assert f'addEventListener("{handler}"' in view_js
        assert phrase in zoom_section().lower(), f"{handler} is wired but not documented"


def test_the_reset_all_control_is_documented_by_its_label():
    # The doc must name the button as it is labelled, or a reader cannot find
    # it on screen.
    button = re.search(r'<button id="current-reset-zoom">([^<]*)</button>', html_source())

    assert button, "the reset button is gone"
    assert button.group(1).strip() in zoom_section()


def test_the_drag_is_documented_as_direction_agnostic():
    # zoomTo runs through clampViewport, which orders the pair.
    assert "either direction" in zoom_section()


def test_the_wheel_anchor_is_documented():
    assert "keeping the tick under it put" in zoom_section()


def test_the_independence_is_documented_with_its_consequence():
    # The consequence matters more than the feature: four panels showing
    # different spans look identical apart from their labels.
    body = zoom_section()

    assert "Each panel zooms independently" in body
    assert "not directly comparable" in body
    assert "the only thing that says so" in body


def test_zoom_is_documented_as_time_only():
    # If a reader thought zoom changed the vertical scale, the peak in the
    # title would stop meaning what it says.
    body = zoom_section()

    assert "time-only" in body.lower()
    assert "vertical scale does not change" in body


def test_the_time_only_claim_matches_the_code():
    # peakMagnitude is called on the whole trace, not the visible slice.
    assert "peakMagnitude([trace])" in view_js
    assert "peakMagnitude([trace.slice" not in view_js


def test_the_omitted_cursor_is_documented():
    # The subtlest behaviour here, and the one a user would otherwise report
    # as a missing cursor rather than an honest one.
    body = zoom_section()

    assert "no cursor rather than one pinned to an edge" in body
    assert "at a time it is not at" in body


def test_the_omitted_cursor_claim_matches_the_code():
    assert "cursor >= view.tickLo && cursor <= view.tickHi" in view_js
