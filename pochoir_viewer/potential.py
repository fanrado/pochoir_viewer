"""The drift potential volume.

This is the second dataset the viewer shows. It is far bulkier than the
geometry, so it travels as raw float32 bytes rather than inside scene.json.
"""

from pathlib import Path

import numpy as np

from .io import find_drift, load_npz


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
