"""Reduction of a 0/1 boundary mask to a small set of rectangles.

boundary/drift.npz marks 7220 True nodes. One voxel each would be unusable in
the browser, so each occupied z-layer is decomposed into a handful of merged
quads that cover exactly the same nodes.
"""

import numpy as np

from .grid import Grid


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


def _group_names(count: int) -> list[str]:
    """Names for `count` slabs ordered by ascending z."""
    # display label, not a physics claim
    if count == 1:
        return ["anode"]
    middles = [
        "grid" if n == 0 else f"grid-{n + 1}" for n in range(max(count - 2, 0))
    ]
    return ["anode"] + middles + ["cathode"]


def boundary_groups(mask: np.ndarray, grid: Grid) -> list[dict]:
    """Collapse the mask into named mm-space slabs for the viewer.

    Consecutive z-layers with array-equal 2D masks become one slab, given a
    thickness of one node along z so it is visible edge-on.
    """
    layers = mask_layers(mask)

    runs: list[list[tuple[int, np.ndarray]]] = []
    for z, layer in layers:
        prev = runs[-1][-1] if runs else None
        if prev is not None and z == prev[0] + 1 and np.array_equal(layer, prev[1]):
            runs[-1].append((z, layer))
        else:
            runs.append([(z, layer)])

    ox, oy, _ = grid.origin
    sx, sy, sz = grid.spacing

    groups = []
    for run in runs:
        z_first, layer = run[0]
        z_last = run[-1][0]
        groups.append(
            {
                "z_min_mm": grid.index_to_mm((0, 0, z_first))[2],
                "z_max_mm": grid.origin[2] + (z_last + 1) * sz,
                "quads": [
                    [ox + i0 * sx, oy + j0 * sy, ox + i1 * sx, oy + j1 * sy]
                    for i0, j0, i1, j1 in layer_rects(layer)
                ],
            }
        )

    groups.sort(key=lambda g: g["z_min_mm"])
    for name, group in zip(_group_names(len(groups)), groups):
        group["name"] = name

    return [
        {
            "name": g["name"],
            "z_min_mm": g["z_min_mm"],
            "z_max_mm": g["z_max_mm"],
            "quads": g["quads"],
        }
        for g in groups
    ]
