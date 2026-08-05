"""The CLI help and the README must agree with the actual defaults.

This file exists because the weighting defaults have drifted from their
documentation four times (pochoir_viewer-ju0, -fhv, -60x, -y44r): each time the
behaviour changed, at least one doc site kept describing the old one. These
checks turn that class of drift into a test failure.
"""

import io
import re
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from pochoir_viewer.cli import _WEIGHT_STRIDE, _WEIGHT_ZMAX, main

README = Path(__file__).resolve().parent.parent / "README.md"


def export_potential_help() -> str:
    buffer = io.StringIO()
    with redirect_stdout(buffer), pytest.raises(SystemExit):
        main(["export-potential", "--help"])
    return buffer.getvalue()


# --- the CLI help ------------------------------------------------------------


def test_the_stride_help_names_the_actual_weight_default():
    stride = ",".join(str(n) for n in _WEIGHT_STRIDE)

    assert stride in export_potential_help(), f"--stride help does not mention {stride}"


def test_the_stride_help_does_not_name_a_different_tuple():
    """Catches a help string left behind after the constant changed."""
    help_text = export_potential_help()
    stride = ",".join(str(n) for n in _WEIGHT_STRIDE)

    quoted = re.findall(r"\b\d,\d,\d\b", help_text)
    others = [s for s in quoted if s != stride and s != "2,2,1"]  # 2,2,1 is the _int_list example
    assert others == [], f"help mentions stride tuples that are not the default: {others}"


def test_the_zmax_help_matches_whether_a_default_crop_exists():
    help_text = export_potential_help()

    if _WEIGHT_ZMAX is None:
        assert "no crop" in help_text, "--zmax help should say there is no default crop"
        assert "weight default: 300" not in help_text
    else:
        assert str(_WEIGHT_ZMAX) in help_text


def test_the_zmax_help_warns_that_cropping_is_lossy():
    # No crop of this field is lossless; the help must not imply otherwise.
    assert "lossy" in export_potential_help()


def test_the_help_lists_both_fields():
    help_text = export_potential_help()

    assert "drift" in help_text
    assert "weight" in help_text


# --- the README --------------------------------------------------------------


def readme() -> str:
    return README.read_text()


def test_the_readme_names_the_actual_default_stride():
    stride = ",".join(str(n) for n in _WEIGHT_STRIDE)

    assert f"`--stride {stride}`" in readme(), f"README does not name --stride {stride}"


def test_the_readme_does_not_claim_a_default_crop():
    """The exact wording that was stale for two commits after cc60c10."""
    text = readme()

    assert "no default crop" in text
    assert "defaults to `--stride 2,2,1` and" not in text
    assert "(the default crop)" not in text


def test_the_readme_does_not_call_the_crop_lossless():
    # A bare "lossless" grep is too crude: the README correctly says "No crop of
    # this field is lossless", which is the opposite claim. Look for the
    # affirmative wording that was actually wrong.
    text = readme()

    # "is lossless" would also match the correct sentence below, so match only
    # the affirmative phrasings this project actually shipped and retired.
    for claim in ("lossless in practice", "That crop is lossless", "crop is lossless,"):
        assert claim not in text, f"README still claims {claim!r}"
    assert "No crop of this field is lossless" in text


def test_the_readme_section_heading_matches_the_behaviour():
    # It strides rather than crops, and the heading should say so.
    assert "Why it is strided, not cropped" in readme()


def test_the_readme_keeps_the_crop_table_for_explicit_zmax():
    # The table is still correct as a reference for --zmax; only the claim that
    # it describes the DEFAULT was wrong.
    text = readme()

    for row in ("| 265 |", "| 300 |", "| 400 |", "| 600 |"):
        assert row in text, f"crop table row {row} is missing"


def test_the_readme_records_that_the_old_default_was_replaced():
    # Historical context is fine and useful; a bare stale claim is not.
    text = readme()

    assert "old `--zmax 300` default was replaced" in text
