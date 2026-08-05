"""The README's skipped/readable .npz table must be arithmetically sound and
must describe a layout that list_datasets actually classifies that way.

The dataset itself is outside the repo, so the counts cannot be confirmed
against it from here. What CAN be confirmed is that the table adds up, that the
directories it names match SKIP_DIRS, and that a synthetic tree built to the
table's own shape produces the numbers the table claims.
"""

import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from pochoir_viewer.io import SKIP_DIRS, list_datasets

README = Path(__file__).resolve().parent.parent / "README.md"
ROOT = README.parent


def split_table() -> list[list[str]]:
    """The skipped/readable table rows, as cell lists."""
    text = README.read_text()
    start = text.index("| skipped | files | readable | files |")
    end = text.index("`initial/` holding four files", start)
    rows = []
    for line in text[start:end].splitlines():
        line = line.strip()
        if not line.startswith("|") or set(line) <= set("| -"):
            continue
        rows.append([c.strip() for c in line.strip("|").split("|")])
    return rows[1:]  # drop the header


def counts(column_name: int, count_col: int) -> dict[str, int]:
    """Directory -> file count for one side of the table, excluding the total."""
    out = {}
    for row in split_table():
        name, number = row[column_name], row[count_col]
        if not name or name.startswith("**"):
            continue
        out[name.strip("`/")] = int(number)
    return out


# --- the table adds up -------------------------------------------------------


def test_the_skipped_column_sums_to_its_stated_total():
    assert sum(counts(0, 1).values()) == 9


def test_the_readable_column_sums_to_its_stated_total():
    assert sum(counts(2, 3).values()) == 9


def test_the_two_sides_sum_to_the_stated_eighteen():
    assert sum(counts(0, 1).values()) + sum(counts(2, 3).values()) == 18


def test_the_stated_totals_match_the_prose():
    text = README.read_text()

    assert "18 `.npz` files" in text
    assert "9 skipped, 9 readable" in text


def test_the_totals_row_says_nine_and_nine():
    totals = [row for row in split_table() if row[0].startswith("**")]

    assert len(totals) == 1
    assert totals[0][1] == "**9**"
    assert totals[0][3] == "**9**"


def test_every_count_is_positive():
    for side in (counts(0, 1), counts(2, 3)):
        for directory, n in side.items():
            assert n > 0, f"{directory} claims {n} files"


# --- the table agrees with the code -----------------------------------------


def test_the_skipped_directories_are_exactly_SKIP_DIRS():
    """A table naming a directory the code does not skip would be fiction."""
    assert set(counts(0, 1)) == set(SKIP_DIRS)


def test_no_readable_directory_is_in_SKIP_DIRS():
    assert set(counts(2, 3)).isdisjoint(SKIP_DIRS)


def test_the_readable_directories_are_distinct_from_the_skipped_ones():
    assert set(counts(0, 1)).isdisjoint(counts(2, 3))


def test_the_prose_explains_the_four_file_initial_directory():
    # The reconciling detail: initial/ holds four files, not one, which is why
    # four skipped directories account for nine files.
    text = README.read_text()

    assert "`initial/` holding four files" in text
    assert counts(0, 1)["initial"] == 4


# --- a tree built to the table classifies the way the table says -------------


@pytest.fixture
def reference_like(tmp_path):
    """A synthetic dataset with exactly the table's per-directory file counts."""
    root = tmp_path / "OUTPUT"
    for directory, n in {**counts(0, 1), **counts(2, 3)}.items():
        (root / directory).mkdir(parents=True)
        for k in range(n):
            np.savez(root / directory / f"array{k}.npz", a=np.zeros(1))
    return root


def test_the_synthetic_tree_holds_eighteen_files(reference_like):
    assert len(list(reference_like.rglob("*.npz"))) == 18


def test_list_datasets_returns_the_readable_nine(reference_like):
    # The claim the README invites the reader to check.
    assert len(list_datasets(reference_like)) == 9


def test_the_nine_are_exactly_the_readable_directories(reference_like):
    found = {p.relative_to(reference_like).parts[0] for p in list_datasets(reference_like)}

    assert found == set(counts(2, 3))


def test_no_skipped_directory_contributes(reference_like):
    for path in list_datasets(reference_like):
        assert path.relative_to(reference_like).parts[0] not in SKIP_DIRS


def test_the_documented_command_prints_nine(reference_like):
    """Run the exact one-liner the README offers, against the synthetic tree."""
    text = README.read_text()
    match = re.search(
        r'python -c "(from pochoir_viewer\.io import list_datasets; print\(len\(list_datasets\(\'([^\']+)\'\)\)\))"',
        text,
    )
    assert match, "the verification one-liner is missing or has changed shape"

    snippet = match.group(1).replace(match.group(2), str(reference_like))
    result = subprocess.run(
        [sys.executable, "-c", snippet], capture_output=True, text=True, cwd=ROOT
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "9"


def test_the_documented_command_points_at_the_reference_dataset():
    text = README.read_text()

    assert "list_datasets('../OUTPUT/store_largepix_wgrid')" in text
