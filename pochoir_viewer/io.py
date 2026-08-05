"""Reading of pochoir output .npz files.

Single entry point so the 0/1 boundary masks and the path arrays are loaded
identically everywhere, and so the directories pochoir writes but we do not
consume are excluded in exactly one place.
"""

from pathlib import Path

import numpy as np

#: Output subdirectories written by pochoir that this viewer does not read.
#: ``domain/`` holds empty arrays; ``initial/``, ``increment/`` and ``starts/``
#: are solver scratch state rather than results.
SKIP_DIRS = frozenset({"initial", "domain", "increment", "starts"})


def load_npz(path: str | Path) -> tuple[str, np.ndarray]:
    """Load a single-array .npz and return its ``(key, array)``.

    Raises ValueError if the file does not hold exactly one array, so a
    multi-array file is never silently reduced to an arbitrary member.
    """
    path = Path(path)
    with np.load(path) as npz:
        keys = list(npz.keys())
        if len(keys) != 1:
            raise ValueError(f"expected 1 array in {path}, found {keys}")
        return keys[0], npz[keys[0]]


def list_datasets(root: str | Path) -> list[Path]:
    """Return every readable .npz under `root`, sorted.

    Paths with any component in :data:`SKIP_DIRS` are omitted.
    """
    root = Path(root)
    return sorted(
        p
        for p in root.rglob("*.npz")
        if not SKIP_DIRS.intersection(p.relative_to(root).parts)
    )


def find_dataset(root: str | Path, rel: str) -> Path:
    """Resolve `rel` (e.g. ``"boundary/drift.npz"``) against `root`.

    Raises FileNotFoundError listing the available datasets, which is the
    useful thing to see when a name is mistyped.
    """
    root = Path(root)
    path = root / rel
    if not path.is_file():
        available = "\n".join(f"  {p}" for p in list_datasets(root))
        raise FileNotFoundError(
            f"no dataset {rel!r} under {root}; available:\n{available}"
        )
    return path
