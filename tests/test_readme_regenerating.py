"""The README's 'Regenerating the input data' section must actually run.

6b86292 centralises five copy-paste commands. A doc that hands out exact
invocations is a stronger promise than prose: a stale flag there is not a
misleading sentence, it is a command that exits 2. So every flag in the
section is checked against the parsers, and every output filename against the
name the viewer fetches -- which is the specific failure the section itself
warns about ("a wrong --dest, --dest-dir or --basename produces a file the
page will never load").

The reference dataset lives outside the repo, so the commands are parsed, not
executed.
"""

import argparse
import re
import shlex
from pathlib import Path

import pytest

from pochoir_viewer.cli import (
    _add_export_current_parser,
    _add_export_parser,
    _add_export_potential_parser,
)


def parser() -> argparse.ArgumentParser:
    """The CLI's real parser, assembled without its handlers.

    NEVER call cli.main here. These commands name the reference dataset and
    web/data by their real paths, so running one regenerates the developer's
    payloads as a side effect of the test suite. Parsing is all that is being
    checked anyway: whether a reader who copy-pastes the line gets past
    argparse.
    """
    root = argparse.ArgumentParser(prog="pochoir_viewer")
    subparsers = root.add_subparsers(dest="command", required=True)
    _add_export_parser(subparsers)
    _add_export_potential_parser(subparsers)
    _add_export_current_parser(subparsers)
    return root

README = Path(__file__).resolve().parent.parent / "README.md"
ROOT = README.parent

text = README.read_text()
viewer_js = (ROOT / "web" / "viewer.js").read_text()

SECTION_HEADING = "## Regenerating the input data"


def section() -> str:
    start = text.index(SECTION_HEADING)
    rest = text[start + len(SECTION_HEADING) :]
    end = rest.find("\n## ")
    return rest if end == -1 else rest[:end]


def own_content() -> str:
    """The section's own prose: its five entries and the all-at-once block.

    Bounded at '### Install', which is NOT part of this section -- see
    test_the_section_does_not_swallow_the_install_instructions.
    """
    body = section()
    end = body.find("### Install")
    return body if end == -1 else body[:end]


def commands(scope=None) -> list[list[str]]:
    """Every `python -m pochoir_viewer ...` invocation in `scope`."""
    found = []
    for line in (scope if scope is not None else own_content()).splitlines():
        line = line.strip()
        if line.startswith("python -m pochoir_viewer"):
            found.append(shlex.split(line)[3:])
    return found


def test_the_section_exists():
    assert SECTION_HEADING in text


def test_the_section_does_not_swallow_the_install_instructions():
    # 6b86292 inserted '## Regenerating the input data' between '## Quick
    # start' and the '### Install' / '### Adding the potential view' that
    # belonged to it. Markdown nesting is by level, so both are now
    # subsections of Regenerating -- "how to pip install" reads as a step of
    # regenerating the data, and a reader scanning the outline for setup will
    # not find it under Quick start any more.
    strays = [h for h in ("### Install", "### Adding the potential view") if h in section()]

    assert strays == [], (
        f"these belong to '## Quick start' but now nest under "
        f"'{SECTION_HEADING}': {strays}"
    )


def test_it_carries_the_commands_it_promises():
    # "Five products, three commands" -- five in the per-product entries and
    # five again in the all-at-once block.
    assert len(commands()) == 10, f"found {len(commands())} invocations, expected 10"


def test_every_subcommand_named_is_real():
    subcommands = {c[0] for c in commands()}

    assert subcommands == {"export", "export-potential", "export-current"}


# --- the flags parse ---------------------------------------------------------


@pytest.mark.parametrize("argv", commands(), ids=lambda a: " ".join(a[:2]))
def test_every_documented_command_parses(argv):
    # Covers both halves of "it exits 2 for the reader": an unknown flag and a
    # required one left out both raise SystemExit here.
    concrete = [a.replace("$ROOT", "../OUTPUT/store_largepix_wgrid") for a in argv]

    try:
        parsed = parser().parse_args(concrete)
    except SystemExit:
        pytest.fail(f"copy-pasting this exits nonzero: {' '.join(argv)}")

    assert parsed.command == argv[0]


@pytest.mark.parametrize("argv", commands(), ids=lambda a: " ".join(a[:2]))
def test_every_documented_flag_reaches_a_real_destination(argv):
    # parse_args accepts a flag only if it exists, but this also catches a
    # value that parses to None -- a flag declared with no dest to land in.
    concrete = [a.replace("$ROOT", "../OUTPUT/store_largepix_wgrid") for a in argv]
    parsed = parser().parse_args(concrete)

    for flag in (a for a in concrete if a.startswith("--")):
        dest = flag.removeprefix("--").replace("-", "_")
        assert hasattr(parsed, dest), f"{flag} has no destination"
        assert getattr(parsed, dest) is not None, f"{flag} parsed to None"


def test_the_export_current_command_passes_a_time_step():
    # Called out separately because it is the one flag with no default, and
    # the section makes a point of it.
    for argv in commands():
        if argv[0] == "export-current":
            assert "--time-step" in argv


def test_no_command_uses_a_basename_override():
    # The section warns that --basename produces a file the page will not
    # fetch; its own commands must not do it.
    for argv in commands():
        assert "--basename" not in argv, f"documented command overrides the stem: {argv}"


# --- the filenames are the ones the viewer fetches ---------------------------


def documented_destinations() -> set[str]:
    return set(re.findall(r"web/data/([\w.]+)", section()))


def test_the_scene_destinations_match_what_viewer_js_fetches():
    fetched = set(re.findall(r'"data/([\w.]+\.json)"', viewer_js))

    missing = fetched - documented_destinations()
    assert missing == set(), f"the viewer fetches files the section does not write: {missing}"


def test_the_potential_stems_match_the_viewer():
    # These are fetched without the data/ prefix, from FIELD_FILES.
    stems = set(re.findall(r'potential: "([\w.]+\.json)"', viewer_js))

    assert stems <= documented_destinations() | {"potential.json", "potential_weight.json"}
    for stem in stems:
        assert stem.removesuffix(".json") in section(), (
            f"the viewer fetches {stem} but the section never names that stem"
        )


def test_the_five_products_are_all_named():
    for name in ("scene.json", "scene_weight.json", "potential.json",
                 "potential_weight.json", "current.json"):
        assert name in section(), f"the section does not name {name}"


def test_the_binaries_are_named_alongside_their_json():
    for name in ("potential.bin", "potential_weight.bin", "current.bin"):
        assert name in section(), f"the section does not name {name}"


# --- the code reference the section gives ------------------------------------


def test_the_viewer_js_line_reference_points_at_the_fetch_names():
    # 'web/viewer.js:289-292'. Line references rot silently; this one is the
    # reader's entry point for checking a name on disk, so it has to land.
    cited = re.search(r"web/viewer\.js:(\d+)-(\d+)", section())
    assert cited, "the section no longer cites a viewer.js location"

    first, last = int(cited.group(1)), int(cited.group(2))
    lines = viewer_js.splitlines()
    quoted = "\n".join(lines[first - 1 : last])

    assert "FIELD_FILES" in quoted or "data/scene.json" in quoted, (
        f"viewer.js:{first}-{last} no longer holds the payload names:\n{quoted}"
    )


def test_the_cross_reference_anchor_resolves():
    # '[Why it is strided, not cropped](#why-it-is-strided-not-cropped)'
    for anchor in re.findall(r"\]\(#([\w-]+)\)", section()):
        slugs = {
            re.sub(r"[^\w -]", "", h).strip().lower().replace(" ", "-")
            for h in re.findall(r"^#+ (.+)$", text, re.M)
        }
        assert anchor in slugs, f"the section links to #{anchor}, which is not a heading"


# --- the claims about defaults -----------------------------------------------


def test_the_documented_defaults_match_the_parsers():
    # --spacing 0.1 and --max-points 400 are quoted as defaults.
    cli = (ROOT / "pochoir_viewer" / "cli.py").read_text()

    for flag, value in (("--spacing", "0.1"), ("--max-points", "400")):
        assert f"`{flag}` (default {value}" in section(), f"{flag}'s default moved in the docs"
        block = cli[cli.index(f'"{flag}"') : cli.index(f'"{flag}"') + 300]
        assert f"default={value}" in block, f"{flag}'s real default is not {value}"


def test_the_weight_stride_default_is_quoted_correctly():
    from pochoir_viewer.cli import _WEIGHT_STRIDE

    stride = ",".join(str(n) for n in _WEIGHT_STRIDE)
    assert f"--stride {stride}" in section(), (
        f"the section does not quote the real weight default {stride}"
    )


def test_the_time_step_unit_is_stated():
    # The one place a reader could copy a number and be silently wrong by 1000x.
    assert "microseconds per tick" in section()
