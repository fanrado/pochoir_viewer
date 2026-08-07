"""The README must not still document the removed levels slider or checkboxes.

6b83a21 swept the "Levels and decades" section by hand. Shaped after
test_readme_iso_swept.py: prose drifts silently, so these checks pin the sweep
against the numbers the code actually ships -- CONTOUR_LEVEL_COUNT and
PHYSICS_FLOOR_DECADES in web/potential_view.js, and the slider attributes in
web/index.html.

Three features were removed across 02e863a..af737a4 and the README has to
reflect all three: the count slider (100..5000), the release-not-drag cost
table it justified, and the per-level checkbox panel with its 24-level cap.
"""

import re
from pathlib import Path

README = Path(__file__).resolve().parent.parent / "README.md"
ROOT = README.parent

text = README.read_text()
view_js = (ROOT / "web" / "potential_view.js").read_text()
index_html = (ROOT / "web" / "index.html").read_text()


def _const(name: str) -> int:
    """The value web/potential_view.js actually exports."""
    m = re.search(rf"export const {name} = (\d+);", view_js)
    assert m, f"{name} is no longer exported from potential_view.js"
    return int(m.group(1))


def _slider_attr(name: str) -> str:
    tag = re.search(r'<input[^>]*id="log-decades"[^>]*>', index_html)
    assert tag, "no #log-decades input in index.html"
    m = re.search(rf'{name}="([^"]*)"', tag.group(0))
    assert m, f"the decades slider has no {name}"
    return m.group(1)


# --- the removed count slider ------------------------------------------------


def test_readme_does_not_describe_an_adjustable_level_count():
    # "100 to 5000" was the slider's range; the count is a constant now.
    assert "100 to 5000" not in text
    assert "levels** slider" not in text


def test_readme_does_not_keep_the_level_cost_table():
    # The table's rows priced settings the panel can no longer reach.
    for row in ("| 1000 |", "| 5000 |"):
        assert row not in text, f"the levels cost table still carries {row}"


def test_readme_states_the_fixed_count_the_code_ships():
    count = _const("CONTOUR_LEVEL_COUNT")
    assert f"CONTOUR_LEVEL_COUNT = {count}" in text, (
        f"README does not name the shipped level count {count}"
    )


# --- the removed per-level checkboxes ----------------------------------------


def test_readme_does_not_promise_per_level_checkboxes():
    # The Boundary group keeps its own checkboxes, so this is scoped to
    # checkbox mentions that sit next to a contour level. Matched against
    # whitespace-normalised prose: the README hard-wraps, and "a checkbox /
    # per level" straddling a line break is the same claim.
    flat = " ".join(text.split())
    offenders = re.findall(
        r"[^.]*\bcheckbox\w*\b[^.]*", flat, re.I
    )
    # Tables carry no full stops, so a sentence can run long; report the tail.
    offenders = [
        s.strip()[-120:] for s in offenders if re.search(r"\blevel", s, re.I)
    ]
    assert offenders == [], (
        "README still documents per-level checkboxes:\n" + "\n".join(offenders)
    )


def test_readme_does_not_document_the_checkbox_cap():
    assert "up to 24 levels" not in text
    assert "24 checkboxes" not in text


def test_no_checkbox_markup_backs_the_prose():
    # If the README were right, index.html would still hold the panel.
    assert 'id="contour-levels"' not in index_html


# --- the decades default agrees with the code --------------------------------


def test_readme_states_the_physics_floor_the_code_ships():
    floor = _const("PHYSICS_FLOOR_DECADES")
    assert f"PHYSICS_FLOOR_DECADES = {floor}" in text, (
        f"README does not name the shipped unsigned default {floor}"
    )


def test_the_documented_floor_matches_the_documented_caveat():
    # The caveat says physics stops around 1e-12; the default must be the
    # decade count that lands exactly there, or the two paragraphs disagree.
    floor = _const("PHYSICS_FLOOR_DECADES")
    assert f"1e-{floor}" in text, f"the caveat no longer cites 1e-{floor}"


def test_readme_quotes_the_sliders_real_maximum():
    top = _slider_attr("max")
    assert f"maximum of {top} decades" in text, (
        f"README does not report the slider's real max of {top}"
    )
    assert "slider to 20 decades" not in text, "the pre-aa20183 max of 20 survives"


def test_readme_quotes_the_markups_signed_default():
    value = _slider_attr("value")
    assert f"keeps the {value}-decade default" in text, (
        f"README does not report the signed default of {value}"
    )


def test_readme_does_not_use_the_old_constant_name():
    # 53a4692 renamed FULL_SPAN_DECADES; a stale mention would document a
    # meaning ("the full span") the default no longer has.
    assert "FULL_SPAN_DECADES" not in text
