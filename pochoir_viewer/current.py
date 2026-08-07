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


#: Half-width of the 10-wide drift domain: the reciprocity offset between the
#: central pixel's quarter and each neighbouring pixel's quarter.
PIXEL_OFFSET = 5


def pixel_traces(block: np.ndarray, i: int, j: int) -> dict[str, np.ndarray]:
    """Return the four induced-current traces for the path starting at ``(i, j)``.

    A response row is indexed by the electron's STARTING position, not by the
    pixel it lands on. By reciprocity the quarter of the domain a start
    position falls in identifies which pixel picks up the current, so the four
    pixels a single path induces on are read from four different rows of the
    same block. The 10-wide domain splits 5 + 5, so for a start in the central
    quarter ``[:5, :5]``:

    ``central``     ``block[i, j]``
    ``neighbor_x``  ``block[i + 5, j]``
    ``neighbor_y``  ``block[i, j + 5]``
    ``diagonal``    ``block[i + 5, j + 5]``

    ``(i, j)`` must lie in the central quarter: outside it the offsets name a
    different pair of pixels entirely and would read past the block.

    ASSUMPTION: the ``+5`` reciprocity offsets come from the human's
    description of the ``fr`` layout, not from anything recorded in the file
    itself. If the plotted traces look wrong, raise it rather than adjusting
    these offsets.
    """
    if not (0 <= i < PIXEL_OFFSET and 0 <= j < PIXEL_OFFSET):
        raise ValueError(
            f"start position ({i}, {j}) is outside the central quarter "
            f"[:{PIXEL_OFFSET}, :{PIXEL_OFFSET}]; the reciprocity offsets are "
            "meaningless there"
        )

    k = PIXEL_OFFSET
    return {
        "central": block[i, j],
        "neighbor_x": block[i + k, j],
        "neighbor_y": block[i, j + k],
        "diagonal": block[i + k, j + k],
    }


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
