"""Command line entry point.

The only supported way to regenerate viewer data from a pochoir OUTPUT
directory.
"""

import argparse
import json
from pathlib import Path

from .export import build_scene
from .grid import Grid
import numpy as np

from .io import find_drift, find_field
from .potential import default_levels, load_potential, write_potential


def _add_export_parser(subparsers) -> None:
    p = subparsers.add_parser("export", help="write a viewer scene JSON")
    p.add_argument("--root", required=True, help="pochoir OUTPUT directory")
    p.add_argument("--dest", required=True, help="scene JSON to write")
    p.add_argument(
        "--spacing",
        type=float,
        default=0.1,
        help="node spacing in mm, applied to all three axes (default: 0.1)",
    )
    p.add_argument(
        "--max-points",
        type=int,
        default=400,
        help="maximum points kept per drift path (default: 400)",
    )
    p.add_argument(
        "--field",
        choices=("drift", "weight"),
        default="drift",
        help="which field to export (default: drift)",
    )


def _add_export_potential_parser(subparsers) -> None:
    p = subparsers.add_parser(
        "export-potential", help="write the potential volume and isosurfaces"
    )
    p.add_argument("--root", required=True, help="pochoir OUTPUT directory")
    p.add_argument("--dest-dir", required=True, help="directory to write into")
    p.add_argument(
        "--field",
        choices=("drift", "weight"),
        default="drift",
        help="which potential to export (default: drift)",
    )
    p.add_argument(
        "--stride",
        type=_int_list,
        default=None,
        help="per-axis stride 'sx,sy,sz' (weight default: 2,2,1)",
    )
    p.add_argument(
        "--zmax",
        type=int,
        default=None,
        help="crop z at this index (weight default: 300)",
    )
    p.add_argument(
        "--zstride",
        type=int,
        default=None,
        help="shorthand for stride 1,1,N",
    )
    p.add_argument(
        "--levels",
        type=_float_list,
        default=None,
        help="comma-separated levels; defaults per field",
    )


def _int_list(text: str) -> list[int]:
    """Parse a comma-separated int list, e.g. ``2,2,1``."""
    parts = [part for part in text.split(",") if part.strip()]
    try:
        values = [int(part) for part in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"expected comma-separated integers, got {text!r}"
        ) from None
    if len(values) != 3:
        raise argparse.ArgumentTypeError(
            f"stride needs three components, got {text!r}"
        )
    return values


def _float_list(text: str) -> list[float]:
    """Parse a comma-separated float list, e.g. ``-500,-2000``."""
    try:
        return [float(part) for part in text.split(",") if part.strip()]
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"expected comma-separated numbers, got {text!r}"
        ) from None


#: Per-field defaults. The weighting potential is 310 MB at full resolution and
#: numerically negligible past z index 265, so it is strided and cropped.
_WEIGHT_STRIDE = (2, 2, 1)
_WEIGHT_ZMAX = 300


def _export_potential(args) -> int:
    field = args.field
    source = find_field(args.root, "potential", field)
    arr = load_potential(args.root, field)
    grid = Grid.from_shape(arr.shape)

    stride = tuple(args.stride) if args.stride else None
    zmax = args.zmax
    if field == "weight":
        if stride is None and args.zstride is None:
            stride = _WEIGHT_STRIDE
        if zmax is None:
            zmax = _WEIGHT_ZMAX
    if stride is None:
        stride = (1, 1, 1)

    meta = write_potential(
        args.root,
        args.dest_dir,
        grid,
        levels=args.levels,
        stride=stride,
        zmax=zmax,
        zstride=args.zstride,
        field=field,
    )

    print(f"source {source}")
    print(f"field {field}, stride {list(meta.get('stride', [1, 1, meta['zstride']]))}")
    if zmax is not None and zmax < arr.shape[2]:
        # State what was dropped and why, so nobody has to wonder.
        beyond = float(np.abs(arr[:, :, zmax:]).max())
        print(
            f"cropped at z={zmax} ({zmax * grid.spacing[2]:.1f} mm); "
            f"per-plane max beyond z={zmax} is {beyond:.3g}"
        )
    print(
        f"wrote {Path(args.dest_dir) / meta['bin']} "
        f"({meta['bytes'] / 1e6:.1f} MB, shape {meta['shape']}, "
        f"units {meta['units'] or 'dimensionless'})"
    )
    # Volts get the unit and one decimal; weighting levels are bare ratios.
    volts = meta["units"] == "V"
    for surface in meta["isosurfaces"]:
        level = (
            f"{surface['level']:9.1f} V" if volts else f"{surface['level']:9.4g}"
        )
        print(f"  {level} -> {surface['n_tris']} triangles")
    if meta["skipped_levels"]:
        print(
            f"  skipped (outside {meta['vmin']}..{meta['vmax']}): "
            f"{meta['skipped_levels']}"
        )
    return 0


def _export(args) -> int:
    scene = build_scene(
        args.root,
        spacing=(args.spacing,) * 3,
        max_points=args.max_points,
        field=args.field,
    )

    dest = Path(args.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(scene)
    dest.write_text(blob)

    print(
        f"wrote {args.dest} ({len(blob) / 1e6:.1f} MB, "
        f"{len(scene['boundary'])} boundary groups, {len(scene['paths'])} paths)"
    )
    return 0


def _glue_negative_values(argv: list[str]) -> list[str]:
    """Rewrite ``--levels -500,-2000`` as ``--levels=-500,-2000``.

    argparse treats any value starting with ``-`` as another option, which
    would reject the documented form of a negative level list.
    """
    glued: list[str] = []
    argv = list(argv)
    while argv:
        token = argv.pop(0)
        if token == "--levels" and argv and argv[0].startswith("-"):
            glued.append(f"--levels={argv.pop(0)}")
        else:
            glued.append(token)
    return glued


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pochoir_viewer")
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_export_parser(subparsers)
    _add_export_potential_parser(subparsers)

    if argv is None:
        import sys

        argv = sys.argv[1:]
    args = parser.parse_args(_glue_negative_values(argv))
    handlers = {"export": _export, "export-potential": _export_potential}
    return handlers[args.command](args)
