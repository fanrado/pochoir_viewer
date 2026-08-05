"""The drift potential volume.

This is the second dataset the viewer shows. It is far bulkier than the
geometry, so it travels as raw float32 bytes rather than inside scene.json.
"""

import json
from pathlib import Path

import numpy as np

from .io import find_field, load_npz


def load_potential(root: str | Path, field: str = "drift") -> np.ndarray:
    """Load the potential array for a dataset root."""
    _, potential = load_npz(find_field(root, "potential", field))
    return potential


#: Units per field. The weighting potential is a ratio, not a voltage.
FIELD_UNITS = {"drift": "V", "weight": "dimensionless"}


def potential_stats(arr: np.ndarray, field: str = "drift") -> dict:
    """Value range of `arr`, for the colormap and the colorbar labels."""
    return {
        "vmin": float(np.min(arr)),
        "vmax": float(np.max(arr)),
        "units": FIELD_UNITS[field],
    }


def volume_float32(
    arr: np.ndarray,
    stride: tuple[int, int, int] = (1, 1, 1),
    zmax: int | None = None,
    zstride: int | None = None,
    spacing: tuple[float, float, float] | None = None,
) -> tuple[np.ndarray, tuple[int, int, int], dict]:
    """Pack `arr` as a contiguous float32 volume, strided and z-cropped.

    Returns ``(volume, shape, meta)``. The volume is C-contiguous so its raw
    bytes can be written straight to disk and read back as a Float32Array in
    the browser with no reordering.

    The weighting potential is 310 MB at full resolution, so a z crop plus a
    transverse stride is what makes it shippable. The crop is LOSSY, and by
    more than the peak residual suggests: the field decays smoothly and is not
    exactly zero until z index 1599. Beyond z 265 the largest remaining value
    is 1.0e-3 out of a 0..1 range but 1.46% of the total magnitude is
    discarded; beyond the z 300 default it is 5.2e-4 and 0.76%. The share is
    the number to weigh for induced charge, which integrates this field, and
    every export-potential run prints both. See the crop table in README.md.
    `zmax` beyond the array clamps rather than raising.

    `zstride` is the Phase 8 spelling and maps to ``stride=(1, 1, zstride)``;
    combining it with an explicit `stride` is contradictory and raises.

    `meta` carries the stride, the crop, and the per-axis mm factors so
    downstream code never re-derives them. The factors need `spacing`, which is
    left to the caller rather than defaulted — grid.py owns the 0.1 mm default.
    """
    via_zstride = zstride is not None
    if via_zstride:
        if tuple(stride) != (1, 1, 1):
            raise ValueError(
                f"pass either zstride or stride, not both "
                f"(got zstride={zstride}, stride={tuple(stride)})"
            )
        stride = (1, 1, zstride)

    stride = tuple(int(s) for s in stride)
    if len(stride) != 3:
        raise ValueError(f"stride needs three components, got {stride}")
    if any(s < 1 for s in stride):
        # Complain in the spelling the caller actually used.
        if via_zstride:
            raise ValueError(f"zstride must be >= 1, got {zstride}")
        raise ValueError(f"every stride component must be >= 1, got {stride}")

    volume = np.ascontiguousarray(
        arr[:: stride[0], :: stride[1], :zmax : stride[2]], dtype=np.float32
    )

    meta = {
        "stride": list(stride),
        "zmax": zmax,
        "mm_factors": (
            None if spacing is None else [stride[k] * spacing[k] for k in range(3)]
        ),
    }
    return volume, volume.shape, meta


def write_potential(
    root: str | Path,
    dest_dir: str | Path,
    grid,
    stride: tuple[int, int, int] = (1, 1, 1),
    zmax: int | None = None,
    zstride: int | None = None,
    field: str = "drift",
    basename: str | None = None,
) -> dict:
    """Write ``potential.bin`` and ``potential.json`` into `dest_dir`.

    Returns the metadata that was written. ``bytes`` is taken from the file
    actually on disk so the browser can validate the length of its fetch.
    """
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    arr = load_potential(root, field)
    volume, shape, vmeta = volume_float32(
        arr, stride=stride, zmax=zmax, zstride=zstride, spacing=grid.spacing
    )

    # Drift keeps the Phase 8 names; other fields are suffixed so the two
    # payloads can live side by side in one web/data directory. An explicit
    # basename overrides both.
    if basename:
        stem = basename
    else:
        stem = "potential" if field == "drift" else f"potential_{field}"
    binary = dest_dir / f"{stem}.bin"
    binary.write_bytes(volume.tobytes())

    stats = potential_stats(arr, field)
    effective = vmeta["stride"]
    meta = {
        "shape": [int(n) for n in shape],
        # zstride is kept for the Phase 8 wire format; stride generalizes it.
        "zstride": int(effective[2]),
        "spacing": [float(s) for s in grid.spacing],
        "origin": [float(o) for o in grid.origin],
        "units": stats["units"],
        "vmin": stats["vmin"],
        "vmax": stats["vmax"],
        "bin": binary.name,
        "bytes": binary.stat().st_size,
    }
    if field != "drift":
        # Only the non-default field adds keys, so a drift payload stays
        # byte-identical to the Phase 8 wire format.
        meta["field"] = field
        meta["stride"] = list(effective)
        meta["zmax"] = zmax
    (dest_dir / f"{stem}.json").write_text(json.dumps(meta))
    return meta
