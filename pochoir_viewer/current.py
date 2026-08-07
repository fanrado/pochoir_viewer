"""Reading of the pochoir field-response array and the block the viewer draws.

The response is a bare ``.npy`` of shape ``(R, T)``: one induced-current
waveform of ``T`` samples per response row. Unlike everything in
:mod:`pochoir_viewer.io` it is not an ``.npz``, so it is loaded directly rather
than through :func:`~pochoir_viewer.io.load_npz`.
"""

from math import isqrt
from pathlib import Path

import numpy as np


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
