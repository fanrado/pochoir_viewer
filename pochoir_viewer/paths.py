"""Loading and thinning of pochoir drift paths.

Each raw path is 4000 steps but terminates early and then repeats its final
point, so the tail is dead weight: 100x4000x3 float64 is ~9.6 MB before
trimming.
"""

from pathlib import Path

import numpy as np

from .io import load_npz


def load_paths(root: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(paths, endtags)`` for a dataset root."""
    root = Path(root)
    _, paths = load_npz(root / "paths" / "drift3d.npz")
    _, endtags = load_npz(root / "paths" / "drift3d_endtag.npz")
    return paths, endtags


def trim_stagnant(path: np.ndarray, eps: float = 1e-9) -> np.ndarray:
    """Drop the repeated tail of `path`, keeping one copy of its final point."""
    path = np.asarray(path)
    if len(path) < 2:
        return path

    moving = np.flatnonzero(np.linalg.norm(path - path[-1], axis=1) > eps)
    if len(moving) == 0:
        # Never moved anywhere: two points is the minimum a segment needs.
        return path[:2]

    return np.concatenate([path[: moving[-1] + 1], path[-1:]])


def decimate(path: np.ndarray, max_points: int = 400) -> np.ndarray:
    """Thin `path` to at most `max_points`, always keeping its endpoints."""
    path = np.asarray(path)
    if len(path) <= max_points:
        return path

    idx = np.unique(np.linspace(0, len(path) - 1, max_points).round().astype(int))
    return path[idx]


def path_summaries(paths: np.ndarray, endtags: np.ndarray) -> list[dict]:
    """One JSON-ready record per path, for the viewer's hover readout.

    Avoids shipping the per-path arrays a second time.
    """
    summaries = []
    for i, raw in enumerate(paths):
        trimmed = trim_stagnant(raw)
        start, end = trimmed[0], trimmed[-1]
        summaries.append(
            {
                "id": int(i),
                "start": [float(v) for v in start],
                "end": [float(v) for v in end],
                "n_steps": int(len(trimmed)),
                "z_travel": float(start[2] - end[2]),
                "endtag": float(endtags[i]),
            }
        )
    return summaries
