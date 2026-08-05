"""Assembly of the single JSON payload the web viewer fetches.

One fetch, one file, so the viewer has no data-assembly logic of its own.
"""

from pathlib import Path

from .boundary import boundary_groups
from .grid import Grid
from .io import find_drift, find_field, load_npz
from .paths import decimate, load_paths, path_summaries, trim_stagnant

#: Micron precision, adequate at 0.1 mm node spacing.
_NDIGITS = 4


def _round(value: float) -> float:
    return round(float(value), _NDIGITS)


def _round_meta(meta: dict) -> dict:
    """Round the numeric entries of Grid.to_meta(), leaving its shape alone."""
    return {
        k: [v if isinstance(v, int) else _round(v) for v in val]
        if isinstance(val, list)
        else val
        for k, val in meta.items()
    }


def build_scene(
    root: str | Path,
    spacing: tuple[float, float, float] = (0.1, 0.1, 0.1),
    max_points: int = 400,
    field: str = "drift",
) -> dict:
    """Build the complete viewer scene for a pochoir output directory.

    The weighting domain has no drift paths, so `field="weight"` emits an empty
    paths list and labels its boundary slabs by z position rather than by role.
    """
    root = Path(root)

    _, mask = load_npz(find_field(root, "boundary", field))
    grid = Grid.from_shape(mask.shape, spacing=spacing)

    weighting = field != "drift"
    paths, endtags = ([], []) if weighting else load_paths(root)

    boundary = [
        {
            "name": group["name"],
            "z_min_mm": _round(group["z_min_mm"]),
            "z_max_mm": _round(group["z_max_mm"]),
            "quads": [[_round(v) for v in quad] for quad in group["quads"]],
        }
        for group in boundary_groups(
            mask, grid, naming="index" if weighting else "role"
        )
    ]

    scene_paths = [
        {
            "id": int(i),
            "points": [
                _round(v)
                for point in decimate(trim_stagnant(raw), max_points=max_points)
                for v in point
            ],
        }
        for i, raw in enumerate(paths)
    ]

    summaries = [
        {
            "id": s["id"],
            "start": [_round(v) for v in s["start"]],
            "end": [_round(v) for v in s["end"]],
            "n_steps": s["n_steps"],
            "z_travel": _round(s["z_travel"]),
            "endtag": _round(s["endtag"]),
        }
        for s in path_summaries(paths, endtags)
    ]

    meta = {
            "source": str(root),
            "grid": _round_meta(grid.to_meta()),
            "extent_mm": [_round(v) for v in grid.extent_mm()],
            "n_paths": len(scene_paths),
    }
    if weighting:
        # Only the non-default field adds keys, keeping drift byte-identical.
        meta["field"] = field

    return {
        "meta": meta,
        "boundary": boundary,
        "paths": scene_paths,
        "summaries": summaries,
    }
