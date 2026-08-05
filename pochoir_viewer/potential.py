"""The drift potential volume.

This is the second dataset the viewer shows. It is far bulkier than the
geometry, so it travels as raw float32 bytes rather than inside scene.json.
"""

import json
from pathlib import Path

import numpy as np

from .io import find_drift, load_npz


#: Equipotential levels drawn by default, in volts.
DEFAULT_LEVELS = (-500.0, -2000.0, -4000.0, -6000.0, -8000.0)


def load_potential(root: str | Path) -> np.ndarray:
    """Load the drift potential array for a dataset root."""
    _, potential = load_npz(find_drift(root, "potential", "field"))
    return potential


def potential_stats(arr: np.ndarray) -> dict:
    """Value range of `arr`, for the colormap and the colorbar labels."""
    return {"vmin": float(np.min(arr)), "vmax": float(np.max(arr)), "units": "V"}


def volume_float32(
    arr: np.ndarray, zstride: int = 1
) -> tuple[np.ndarray, tuple[int, int, int]]:
    """Pack `arr` as a contiguous float32 volume, thinned by `zstride` in z.

    The result is C-contiguous so its raw bytes can be written straight to disk
    and read back as a Float32Array in the browser with no reordering.
    """
    if zstride < 1:
        raise ValueError(f"zstride must be >= 1, got {zstride}")

    volume = np.ascontiguousarray(arr[:, :, ::zstride], dtype=np.float32)
    return volume, volume.shape


def write_potential(
    root: str | Path,
    dest_dir: str | Path,
    grid,
    levels=DEFAULT_LEVELS,
    zstride: int = 1,
) -> dict:
    """Write ``potential.bin`` and ``potential.json`` into `dest_dir`.

    Returns the metadata that was written. ``bytes`` is taken from the file
    actually on disk so the browser can validate the length of its fetch.
    """
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    arr = load_potential(root)
    volume, shape = volume_float32(arr, zstride)
    surfaces, skipped = isosurfaces(arr, grid, levels=levels, zstride=zstride)

    binary = dest_dir / "potential.bin"
    binary.write_bytes(volume.tobytes())

    stats = potential_stats(arr)
    meta = {
        "shape": [int(n) for n in shape],
        "zstride": int(zstride),
        "spacing": [float(s) for s in grid.spacing],
        "origin": [float(o) for o in grid.origin],
        "units": stats["units"],
        "vmin": stats["vmin"],
        "vmax": stats["vmax"],
        "bin": binary.name,
        "bytes": binary.stat().st_size,
        "isosurfaces": surfaces,
        "skipped_levels": skipped,
    }
    (dest_dir / "potential.json").write_text(json.dumps(meta))
    return meta


def isosurfaces(
    arr: np.ndarray,
    grid,
    levels=DEFAULT_LEVELS,
    zstride: int = 1,
) -> tuple[list[dict], list[float]]:
    """Triangulate equipotential surfaces, returning ``(surfaces, skipped)``.

    Precomputing the meshes here keeps marching cubes out of the browser. The
    field is a smooth monotonic ramp, so each level comes back as a near-planar
    sheet and the payload stays small.

    Note that -2000 V coincides with the grid boundary plane at z index 131, so
    that surface is expected to sit flush with the grid geometry rather than
    floating in the drift volume.

    Levels outside the open interval ``(vmin, vmax)`` cannot be triangulated;
    they are skipped and reported instead of raising.
    """
    from skimage import measure  # lazy: only isosurfaces needs scikit-image

    volume, _ = volume_float32(arr, zstride)
    vmin = float(np.min(volume))
    vmax = float(np.max(volume))
    sx, sy, sz = grid.spacing

    surfaces: list[dict] = []
    skipped: list[float] = []

    for level in levels:
        level = float(level)
        if not vmin < level < vmax:
            skipped.append(level)
            continue

        verts, faces, _normals, _values = measure.marching_cubes(volume, level=level)

        # Vertices come back in the INDEX SPACE OF THE STRIDED VOLUME, so the
        # z index must be multiplied by zstride before scaling to mm —
        # otherwise every surface collapses toward the anode.
        mm = np.empty_like(verts)
        mm[:, 0] = verts[:, 0] * sx
        mm[:, 1] = verts[:, 1] * sy
        mm[:, 2] = verts[:, 2] * zstride * sz

        surfaces.append(
            {
                "level": level,
                "positions": [round(float(v), 4) for v in mm.ravel()],
                "indices": [int(i) for i in faces.ravel()],
                "n_tris": int(len(faces)),
            }
        )

    return surfaces, skipped
