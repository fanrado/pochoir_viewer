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

#: Accepted spellings of the drift field array, in precedence order.
DRIFT_FIELD_NAMES = ("drift3d.npz", "drift.npz")

#: Accepted spellings of the drift endtag array, in precedence order.
DRIFT_ENDTAG_NAMES = ("drift3d_endtag.npz", "drift_endtag.npz")

#: Accepted spellings of the weighting field array, in precedence order.
WEIGHT_FIELD_NAMES = ("weight3d.npz", "weight.npz")

_DRIFT_KINDS = {"field": DRIFT_FIELD_NAMES, "endtag": DRIFT_ENDTAG_NAMES}

#: Candidate filenames per (field, kind). The weighting field has no endtag.
_FIELD_KINDS = {
    "drift": _DRIFT_KINDS,
    "weight": {"field": WEIGHT_FIELD_NAMES},
}


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


def find_field(
    root: str | Path, subdir: str, field: str = "drift", kind: str = "field"
) -> Path:
    """Resolve a field array in ``root/subdir``, accepting either spelling.

    pochoir writes ``drift.npz``/``weight.npz`` under some subdirectories and
    ``drift3d.npz``/``weight3d.npz`` under others, with identical contents.
    Candidates are tried in the order given by :data:`DRIFT_FIELD_NAMES`,
    :data:`DRIFT_ENDTAG_NAMES` and :data:`WEIGHT_FIELD_NAMES`, so if a
    directory somehow holds both spellings the explicitly-3D name wins. That
    precedence only guards against ambiguity.

    Names are matched exactly, never globbed: ``drift*.npz`` would wrongly
    match ``drift_insulator.npz`` in ``initial/`` and ``drift3d_endtag.npz``
    in ``paths/``, and ``weight*.npz`` would catch ``weight_insulator.npz``.
    """
    try:
        kinds = _FIELD_KINDS[field]
    except KeyError:
        raise ValueError(
            f"unknown field {field!r}, expected one of {sorted(_FIELD_KINDS)}"
        ) from None

    try:
        candidates = kinds[kind]
    except KeyError:
        raise ValueError(
            f"unknown {field} kind {kind!r}, expected one of {sorted(kinds)}"
        ) from None

    directory = Path(root) / subdir
    for name in candidates:
        candidate = directory / name
        if candidate.is_file():
            return candidate

    present = sorted(p.name for p in directory.glob("*.npz"))
    raise FileNotFoundError(
        f"no {kind} {field} array in {directory}: tried {list(candidates)}, "
        f"found {present}"
    )


def find_response(root: str | Path) -> Path:
    """Resolve the field-response ``fr_*.npy`` at the top level of ``root``.

    This is the one place the module globs, and the exception is deliberate
    rather than an erosion of the exact-match rule stated in
    :func:`find_field`. Every other array pochoir writes has a name fixed by
    the tool, so it can be named outright; the response stem encodes the run
    configuration (``fr_4p4pitch_3.8pix_nogrid_10pathsperpixel.npy`` in the
    reference dataset) and is not knowable in advance. There is nothing to
    match exactly against.

    The glob is kept as tight as the unknown stem allows: ``root.glob`` at the
    top level only, never ``rglob``, so nothing buried in a subdirectory can
    be picked up, and non-files are dropped so a *directory* named
    ``fr_something.npy`` neither resolves as the response nor counts towards
    ambiguity. Zero matches raise FileNotFoundError; more than one raises
    ValueError listing every candidate, so an ambiguous directory never
    silently resolves to an arbitrary one of them.
    """
    root = Path(root)
    matches = sorted(p for p in root.glob("fr_*.npy") if p.is_file())
    if not matches:
        raise FileNotFoundError(f"no field-response fr_*.npy in {root}")
    if len(matches) > 1:
        names = ", ".join(p.name for p in matches)
        raise ValueError(
            f"ambiguous field response in {root}: {len(matches)} candidates "
            f"match fr_*.npy ({names}); remove or move all but one"
        )
    return matches[0]


def find_drift(root: str | Path, subdir: str, kind: str = "field") -> Path:
    """Resolve the drift array in ``root/subdir``. See :func:`find_field`."""
    return find_field(root, subdir, field="drift", kind=kind)


def find_dataset(root: str | Path, rel: str) -> Path:
    """Resolve `rel` (e.g. ``"boundary/weight.npz"``) against `root`.

    For drift arrays prefer :func:`find_drift`, which tolerates both spellings.

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
