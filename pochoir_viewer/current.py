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

    ``points_per_tick`` and ``path_steps`` let the browser relate a path point
    index to a response tick, which it otherwise cannot do: the path array is
    padded to a fixed length while the response is binned, and each path really
    ends at a different step. Both are measured, never assumed.
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
    trimmed = [trim_stagnant(raw) for raw in paths[: m * m]]
    starts = [[float(v) for v in path[0]] for path in trimmed]

    # How many stored path points advance per response tick. The path array is
    # padded to a fixed length and the response is binned, so the two axes are
    # NOT the same clock: 4000 points against 4000 bins is 1.0 here, but a
    # dataset with 200000 points against 4000 bins gives 50. Computed from the
    # arrays every time -- assuming 1.0 silently mis-times every animation on
    # the larger datasets.
    raw_path_length = paths.shape[1]
    points_per_tick = raw_path_length / (n_ticks + 1)

    # Per-path REAL length, in path-id order. The stored array repeats its final
    # point out to raw_path_length, so a single global length would run every
    # electron to the anode at the last tick; path 0 actually ends at 1810.
    # Without this the viewer cannot know when a given electron is collected.
    path_steps = [int(len(path)) for path in trimmed]

    meta = {
        "bin": binary.name,
        "shape": [int(n) for n in block.shape],
        "n_ticks": int(n_ticks),
        "time_step_us": float(time_step_us),
        "time_units": "us",
        "bytes": binary.stat().st_size,
        "starts": starts,
        "points_per_tick": float(points_per_tick),
        "path_steps": path_steps,
    }
    (dest_dir / f"{stem}.json").write_text(json.dumps(meta))
    return meta
