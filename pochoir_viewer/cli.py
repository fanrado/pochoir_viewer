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
from .potential import load_potential, write_potential


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
        "export-potential", help="write the potential volume"
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
        help="per-axis stride 'sx,sy,sz' (weight default: 2,2,2)",
    )
    p.add_argument(
        "--zmax",
        type=int,
        default=None,
        help="crop z at this index (default: no crop; lossy, see README)",
    )
    p.add_argument(
        "--zstride",
        type=int,
        default=None,
        help="shorthand for stride 1,1,N",
    )
    p.add_argument(
        "--basename",
        default=None,
        help="output stem, overriding the per-field default",
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


#: Per-field defaults for the weighting potential.
#:
#: The full volume is 310 MB, too large to ship, so it is STRIDED rather than
#: cropped: the field carries real structure all the way out to 159.8 mm, and a
#: z crop throws that away. At stride 2 the 3.1 mm pad-to-grid gap still gets 16
#: z samples and the payload is 38.8 MB. Pass --zmax to crop anyway; the run
#: then prints exactly what that discards.
_WEIGHT_STRIDE = (2, 2, 2)
_WEIGHT_ZMAX = None


def _report_z_range(arr, zmax, sz: float) -> None:
    """State the z coverage honestly — never call a crop lossless.

    The weighting potential decays over dozens of orders of magnitude but stays
    nonzero almost to the cathode, so a crop discards real structure. Say what
    is kept, or what is thrown away.
    """
    nonzero = np.flatnonzero(np.abs(arr).max(axis=(0, 1)) > 0)
    last = int(nonzero[-1]) if nonzero.size else 0
    positive = arr[arr > 0]

    if zmax is None or zmax >= arr.shape[2]:
        tail = f"full z range kept; field is nonzero out to {last * sz:.1f} mm"
        if positive.size:
            smallest = float(positive.min())
            decades = np.log10(float(np.abs(arr).max()) / smallest)
            tail += f", min positive {smallest:.3g} ({decades:.1f} decades)"
        print(tail)
        return

    def abs_sum(a: np.ndarray) -> float:
        return float(sum(np.abs(a[:, :, k]).sum() for k in range(a.shape[2])))

    dropped = arr[:, :, zmax:]
    beyond = float(np.abs(dropped).max())
    total = abs_sum(arr)
    share = abs_sum(dropped) / total if total else 0.0
    print(
        f"cropped at z={zmax} ({zmax * sz:.1f} mm), DISCARDING the field from "
        f"there to {last * sz:.1f} mm where it is still nonzero; "
        f"largest discarded value {beyond:.3g}; "
        # Three significant figures rather than three decimals: the share spans
        # orders of magnitude, and a fixed-decimal 0.0001% prints as "0.000%",
        # which reads as exactly nothing.
        f"discarded {share * 100:.3g}% of the total magnitude"
    )


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
        stride=stride,
        zmax=zmax,
        zstride=args.zstride,
        field=field,
        basename=args.basename,
    )

    print(f"source {source}")
    print(f"field {field}, stride {list(meta.get('stride', [1, 1, meta['zstride']]))}")
    _report_z_range(arr, zmax, grid.spacing[2])

    dest = Path(args.dest_dir)
    stem = Path(meta["bin"]).stem
    print(
        f"wrote {dest / meta['bin']} and {dest / f'{stem}.json'} "
        f"({meta['bytes'] / 1e6:.1f} MB, shape {meta['shape']}, "
        f"units {meta['units'] or 'dimensionless'})"
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pochoir_viewer")
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_export_parser(subparsers)
    _add_export_potential_parser(subparsers)

    if argv is None:
        import sys

        argv = sys.argv[1:]
    args = parser.parse_args(argv)
    handlers = {"export": _export, "export-potential": _export_potential}
    return handlers[args.command](args)
