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

HEADING = "## The induced-current view"


def section() -> str:
    start = text.index(HEADING)
    rest = text[start + len(HEADING) :]
    end = rest.find("\n## ")
    return rest if end == -1 else rest[:end]


def flat() -> str:
    """The section with whitespace normalised: the README hard-wraps, so a
    quoted phrase can straddle a line break."""
    return " ".join(section().split())


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


def test_both_implementations_agree_with_the_documented_offset():
    # Python and JS index the same buffer; the doc describes one rule.
    assert f"PIXEL_OFFSET = {PIXEL_OFFSET}" in current_py
    assert f"PIXEL_OFFSET = {PIXEL_OFFSET};" in build_js


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
    # k/(T-1) * (N-1) -- both endpoints matter: tick 0 at the first point and
    # the last tick exactly at the last.
    assert "k/(T-1) * (N-1)" in flat()
    # tickToIndex lives in drift_anim.js -- current_build.js has the
    # similarly-shaped tickToX, which maps to pixels, not path index.
    assert "(k / (nTicks - 1)) * (nPoints - 1)" in anim_js


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


def test_the_stated_ratio_follows_from_the_two_numbers():
    # "3999 ticks ... 400 points ... roughly ten ticks per stored point"
    body = section()
    ticks = int(re.search(r"\*\*(\d+) ticks\*\*", flat()).group(1))
    points = int(re.search(r"most (\d+) points\*\*", flat()).group(1))

    assert round(ticks / points) == 10
    assert "ten ticks per stored point" in flat()


# --- the claims about the view's behaviour ------------------------------------


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
    # four comparable, so it has to be documented.
    if "function sharedPeak()" in view_js:
        return

    assert "peak" in flat().lower(), (
        "each panel autoscales now, but the section does not mention the "
        "per-panel peak that makes them comparable"
    )


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
