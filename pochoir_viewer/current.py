"""Reading of the pochoir field-response array and the block the viewer draws.

The response is a bare ``.npy`` of shape ``(R, T)``: one induced-current
waveform of ``T`` samples per response row. Unlike everything in
:mod:`pochoir_viewer.io` it is not an ``.npz``, so it is loaded directly rather
than through :func:`~pochoir_viewer.io.load_npz`.
"""

import json
from math import isqrt
from pathlib import Path

import numpy as np

from .io import find_response
from .paths import load_paths, trim_stagnant


def load_response(path: str | Path) -> np.ndarray:
    """Load the field-response array and return it as ``(R, T)``.

    The file is a bare array, not an npz — routing it through
    :func:`~pochoir_viewer.io.load_npz` would fail on the missing key list.
    For the reference file this is ``(625, 3999)``.
    """
    array = np.load(Path(path))
    if array.ndim != 2:
        raise ValueError(
            f"expected a 2-D (R, T) response in {path}, got shape {array.shape}"
        )
    return array


def domain_block(response: np.ndarray, n_paths: int) -> np.ndarray:
    """Cut the ``(M, M, T)`` drift-domain block out of an ``(R, T)`` response.

    The response rows form an ``N x N`` grid of source positions flattened in
    C order, so row ``r`` is position ``(a, b)`` with ``r = a*N + b``. The
    viewer draws the first ``M x M`` corner of that grid, where ``M**2`` is
    ``n_paths``.

    **The block is not** ``response[:n_paths]``. Under the ``r = a*N + b``
    layout the corner is the STRIDED set of rows ``0-9, 25-34, 50-59, ...``
    (for ``N=25, M=10``). Taking the first ``n_paths`` rows instead would grab
    a ``4 x 25`` slab spanning the full width of the grid and only a sliver of
    its height — a different set of source positions, so every plotted
    waveform would be the wrong one. Reshape first, then slice.

    ``N`` and ``M`` are derived from the inputs, never assumed: other response
    files hold more than 625 rows.
    """
    rows = response.shape[0]
    n = isqrt(rows)
    if n * n != rows:
        raise ValueError(
            f"response has {rows} rows, which is not a perfect square; "
            "cannot infer the N x N source grid"
        )

    m = isqrt(n_paths)
    if m * m != n_paths:
        raise ValueError(f"n_paths={n_paths} is not a perfect square")
    if m > n:
        raise ValueError(
            f"n_paths={n_paths} needs a {m} x {m} block but the response only "
            f"holds a {n} x {n} source grid"
        )

    return response.reshape(n, n, -1)[:m, :m, :]


#: Half-width of the reference 10-wide drift domain.
#:
#: Retained as the documented value for that domain; :func:`pixel_traces`
#: derives the half-width from the block it is given rather than reading this,
#: so a differently sized block works without touching it.
PIXEL_OFFSET = 5


def partner_index(k: int, half: int) -> int:
    """The index of ``k``'s partner in the other quarter along one axis.

    The partner MIRRORS about the quarter boundary rather than always adding
    ``half``: below the boundary it is ``k + half``, at or above it is
    ``k - half``. Always adding would run off the end of the block for any
    ``k >= half``, which is why three quarters of the domain used to raise.
    """
    return k + half if k < half else k - half


def pixel_traces(block: np.ndarray, i: int, j: int) -> list[dict]:
    """The four in-block partner traces for the path starting at ``(i, j)``.

    Returns an ordered list of ``{"index": [a, b], "trace": ...}`` — the four
    partners ``(i, j)``, ``(px, j)``, ``(i, py)``, ``(px, py)``, where the
    partner index mirrors about the quarter boundary (:func:`partner_index`)
    and ``half`` is derived from the block shape. So a start at ``(7, 2)``
    reads ``(7, 2)``, ``(2, 2)``, ``(7, 7)`` and ``(2, 7)``. Every ``(i, j)``
    inside the block is valid; only out-of-block indices are rejected.

    KEYED BY BLOCK INDEX, DELIBERATELY, and asserting nothing about pad role.
    Naming these 'central' / 'neighbor_x' / 'neighbor_y' / 'diagonal' claims
    which pad collects the charge, and that claim rotates with the quarter: it
    holds for the 25 starts in the first quarter and is wrong for the other 75,
    which filed their collection trace under an induction heading. A
    mislabelled plot still looks plausible, so the labelling is left to the
    caller, which has the index pair and can name panels from it.

    RECIPROCITY, now measured rather than assumed. Row ``(i, j)`` is the
    current induced on ONE FIXED PAD by an electron starting at ``(i, j)``. A
    start inside that pad's collecting quarter gives a UNIPOLAR trace — the
    charge arrives — while a start outside it gives a BIPOLAR trace that
    integrates to zero, pure induction as the electron passes. Measured on the
    reference dataset: ``block[2, 3]`` has sum+ 2.000e-02 against sum- 2.7e-17
    (collected), whereas ``block[7, 3]`` has sum+ = sum- = 8.184e-04 (induced
    only). All 100 rows are distinct responses, so folding to the first quarter
    would discard real data.
    """
    rows, cols = block.shape[0], block.shape[1]
    if not (0 <= i < rows and 0 <= j < cols):
        raise ValueError(
            f"start position ({i}, {j}) is outside the {rows}x{cols} block"
        )

    px = partner_index(i, rows // 2)
    py = partner_index(j, cols // 2)
    return [
        {"index": [a, b], "trace": block[a, b]}
        for a, b in ((i, j), (px, j), (i, py), (px, py))
    ]


def write_current(
    root: str | Path,
    dest_dir: str | Path,
    time_step_us: float,
    basename: str | None = None,
) -> dict:
    """Write ``current.bin`` and ``current.json`` into `dest_dir`.

    Shaped after :func:`~pochoir_viewer.potential.write_potential`: the bulk
    goes to a raw float32 ``.bin`` and the JSON carries metadata only, with
    ``bytes`` read back off the file actually on disk so the browser can
    validate the length of its fetch. Returns the metadata that was written.

    The block is ``(M, M, T)`` written C-order, so ``(i, j)`` is row-major with
    the tick index varying fastest. ``M`` is not a parameter: the viewer draws
    exactly the paths in ``paths/``, so ``n_paths`` comes from that array and
    ``M = isqrt(n_paths)``, keeping the payload and the drawn paths in step by
    construction.

    ``starts`` carries one ``[x, y, z]`` per path in mm so the selector can
    label positions. It is ordered to match the block read C-order — entry
    ``i * M + j`` is the start for ``block[i, j]`` — which assumes the paths
    array is itself flattened in that order, the same assumption the ``(N, N)``
    reshape in :func:`domain_block` rests on.
    """
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    response = load_response(find_response(root))
    paths, _ = load_paths(root)
    n_paths = len(paths)
    block = np.ascontiguousarray(domain_block(response, n_paths), dtype=np.float32)

    stem = basename or "current"
    binary = dest_dir / f"{stem}.bin"
    binary.write_bytes(block.tobytes())

    m, _, n_ticks = block.shape
    starts = [
        [float(v) for v in trim_stagnant(raw)[0]] for raw in paths[: m * m]
    ]

    meta = {
        "bin": binary.name,
        "shape": [int(n) for n in block.shape],
        "n_ticks": int(n_ticks),
        "time_step_us": float(time_step_us),
        "time_units": "us",
        "bytes": binary.stat().st_size,
        "starts": starts,
    }
    (dest_dir / f"{stem}.json").write_text(json.dumps(meta))
    return meta
