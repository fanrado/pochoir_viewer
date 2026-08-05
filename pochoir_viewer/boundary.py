"""Reduction of a 0/1 boundary mask to a small set of rectangles.

boundary/drift.npz marks 7220 True nodes. One voxel each would be unusable in
the browser, so each occupied z-layer is decomposed into a handful of merged
quads that cover exactly the same nodes.
"""

import numpy as np


def mask_layers(mask: np.ndarray) -> list[tuple[int, np.ndarray]]:
    """Return ``(z_index, layer)`` for every z-layer holding any True node."""
    occupied = np.asarray(mask).astype(bool)
    return [
        (int(z), occupied[:, :, z])
        for z in range(occupied.shape[2])
        if occupied[:, :, z].any()
    ]


def _row_runs(row: np.ndarray) -> list[tuple[int, int]]:
    """Maximal contiguous half-open runs of True in a 1-D bool array."""
    # Difference of the padded row marks each rise (+1) and fall (-1).
    edges = np.diff(np.concatenate(([False], row, [False])).astype(np.int8))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return list(zip(starts.tolist(), ends.tolist()))


def layer_rects(layer2d: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Cover the True nodes of `layer2d` with non-overlapping half-open rects.

    Rows are scanned in order; a run extends an open rect only when its
    ``(j0, j1)`` is identical, so the result is a set of ``(i0, j0, i1, j1)``
    index rects that partition the True nodes.
    """
    layer = np.asarray(layer2d).astype(bool)
    n_rows = layer.shape[0]

    rects: list[tuple[int, int, int, int]] = []
    open_rects: dict[tuple[int, int], int] = {}  # (j0, j1) -> first row

    for i in range(n_rows):
        runs = set(_row_runs(layer[i]))
        for span in [s for s in open_rects if s not in runs]:
            j0, j1 = span
            rects.append((open_rects.pop(span), j0, i, j1))
        for span in runs:
            open_rects.setdefault(span, i)

    for span, i0 in open_rects.items():
        j0, j1 = span
        rects.append((i0, j0, n_rows, j1))

    return sorted(rects)
