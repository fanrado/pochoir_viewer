"""The drift potential volume.

This is the second dataset the viewer shows. It is far bulkier than the
geometry, so it travels as raw float32 bytes rather than inside scene.json.
"""

import json
from pathlib import Path

import numpy as np

from .io import find_field, load_npz


#: Equipotential levels drawn by default for the drift field, in volts.
DEFAULT_LEVELS = (-500.0, -2000.0, -4000.0, -6000.0, -8000.0)

#: Levels for the weighting potential, dimensionless.
#:
#: Deliberately log-ish rather than evenly spaced: the weighting potential falls
#: off fast — 1.0 at the pad, 0.115 at the grid, 0.0025 by z = 150 — so linear
#: levels would bunch every surface into the first millimetre.
WEIGHT_LEVELS = (0.9, 0.75, 0.5, 0.25, 0.1, 0.05, 0.01)


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


def default_levels(field: str = "drift"):
    """Levels appropriate to `field`: volts for drift, ratios for weight."""
    return DEFAULT_LEVELS if field == "drift" else WEIGHT_LEVELS


def write_potential(
    root: str | Path,
    dest_dir: str | Path,
    grid,
    levels=None,
    stride: tuple[int, int, int] = (1, 1, 1),
    zmax: int | None = None,
    zstride: int | None = None,
    field: str = "drift",
) -> dict:
    """Write ``potential.bin`` and ``potential.json`` into `dest_dir`.

    Returns the metadata that was written. ``bytes`` is taken from the file
    actually on disk so the browser can validate the length of its fetch.
    """
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    if levels is None:
        levels = default_levels(field)

    arr = load_potential(root, field)
    volume, shape, vmeta = volume_float32(
        arr, stride=stride, zmax=zmax, zstride=zstride, spacing=grid.spacing
    )
    surfaces, skipped = isosurfaces(
        arr, grid, levels=levels, stride=stride, zmax=zmax, zstride=zstride
    )

    # Drift keeps the Phase 8 names; other fields are suffixed so the two
    # payloads can live side by side in one web/data directory.
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
        "isosurfaces": surfaces,
        "skipped_levels": skipped,
    }
    if field != "drift":
        # Only the non-default field adds keys, so a drift payload stays
        # byte-identical to the Phase 8 wire format.
        meta["field"] = field
        meta["stride"] = list(effective)
        meta["zmax"] = zmax
    (dest_dir / f"{stem}.json").write_text(json.dumps(meta))
    return meta


def isosurfaces(
    arr: np.ndarray,
    grid,
    levels=DEFAULT_LEVELS,
    stride: tuple[int, int, int] = (1, 1, 1),
    zmax: int | None = None,
    zstride: int | None = None,
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

    volume, _, vmeta = volume_float32(
        arr, stride=stride, zmax=zmax, zstride=zstride
    )
    effective = vmeta["stride"]
    vmin = float(np.min(volume))
    vmax = float(np.max(volume))
    sx, sy, sz = grid.spacing
    ox, oy, oz = grid.origin

    surfaces: list[dict] = []
    skipped: list[float] = []

    for level in levels:
        level = float(level)
        if not vmin < level < vmax:
            skipped.append(level)
            continue

        verts, faces, _normals, _values = measure.marching_cubes(volume, level=level)

        # Vertices come back in the INDEX SPACE OF THE STRIDED VOLUME, so each
        # index must be multiplied by its own stride before scaling to mm —
        # otherwise every surface collapses toward the origin on that axis.
        # The z crop is a PREFIX slice (arr[..., :zmax]), so it shifts nothing
        # and contributes no offset here. Do not add one.
        # Origin is added on every axis, matching Grid.index_to_mm and
        # boundary_groups: two index-to-mm conversions that disagree would put
        # the equipotential sheets off the boundary planes in the same scene.
        mm = np.empty_like(verts)
        mm[:, 0] = ox + verts[:, 0] * effective[0] * sx
        mm[:, 1] = oy + verts[:, 1] * effective[1] * sy
        mm[:, 2] = oz + verts[:, 2] * effective[2] * sz

        surfaces.append(
            {
                "level": level,
                "positions": [round(float(v), 4) for v in mm.ravel()],
                "indices": [int(i) for i in faces.ravel()],
                "n_tris": int(len(faces)),
            }
        )

    return surfaces, skipped
