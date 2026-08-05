"""The README must not still document the removed isosurface feature.

3760fa8 swept it out by hand. Prose drifts silently -- nothing else in the suite
reads the README -- so these checks pin the sweep against what the code actually
offers now: the CLI's real flags, index.html's real layer buttons, and the real
dependency list. A doc that promises `--levels` is a bug report waiting to be
filed.

The reference dataset lives outside the repo, so the byte sizes the README
quotes cannot be confirmed here; only self-consistency and code agreement can.
"""

import re
from pathlib import Path

from pochoir_viewer.cli import main  # noqa: F401  -- import guard: the module must load

README = Path(__file__).resolve().parent.parent / "README.md"
ROOT = README.parent

text = README.read_text()


# --- the feature is gone from the prose --------------------------------------


def test_readme_does_not_mention_isosurfaces():
    # "isosurface" survives only in the one paragraph that explains the removal
    # to someone holding a stale web/data directory.
    hits = [
        line.strip()
        for line in text.splitlines()
        if re.search(r"isosurface", line, re.I)
    ]
    stale_note = [h for h in hits if "removed" in h or "Earlier versions" in h]

    assert len(hits) == len(stale_note), (
        "README still documents isosurfaces as a live feature:\n"
        + "\n".join(h for h in hits if h not in stale_note)
    )


def test_readme_does_not_document_the_levels_flag():
    assert "--levels" not in text


def test_readme_does_not_require_scikit_image():
    assert "scikit-image" not in text
    assert "marching cubes" not in text.lower()


def test_readme_does_not_promise_two_potential_layers():
    # The Isosurfaces button is gone; only Potential slice remains.
    assert "two potential layer" not in text


# --- the prose agrees with the code ------------------------------------------


def export_potential_flags() -> set[str]:
    """Flags the README's export-potential table documents."""
    start = text.index("| flag | meaning |")
    rows = []
    for line in text[start:].splitlines()[2:]:
        if not line.strip().startswith("|"):
            break
        rows.append(line)
    return {m.group(0) for row in rows for m in re.finditer(r"--[a-z-]+", row)}


def test_every_documented_export_potential_flag_exists():
    source = (ROOT / "pochoir_viewer" / "cli.py").read_text()

    missing = [f for f in export_potential_flags() if f'"{f}"' not in source]

    assert missing == [], f"README documents flags the CLI does not accept: {missing}"


def test_the_layer_table_matches_the_buttons_in_index_html():
    # Scoped to the #layer-buttons group, which is what the table describes.
    # #layer-contours lives further down inside the contours section and is
    # documented there instead, so it is deliberately out of scope here.
    html = (ROOT / "web" / "index.html").read_text()
    group = html[html.index('<div id="layer-buttons"') :]
    group = group[: group.index("</div>")]
    buttons = set(re.findall(r'<button id="layer-\w+"[^>]*>([^<]+)</button>', group))

    start = text.index("| **Drift paths** |")
    end = text.index("Toggling a layer never moves the camera", start)
    documented = set(re.findall(r"\| \*\*([^*]+)\*\* \|", text[start:end]))

    assert documented == buttons, (
        f"README layer table {sorted(documented)} does not match "
        f"index.html buttons {sorted(buttons)}"
    )


def test_requirements_section_matches_requirements_txt():
    reqs = (ROOT / "requirements.txt").read_text()

    assert ("scikit-image" in text) == ("scikit-image" in reqs)
