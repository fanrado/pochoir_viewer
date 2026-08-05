"""Command line entry point.

The only supported way to regenerate viewer data from a pochoir OUTPUT
directory.
"""

import argparse
import json
from pathlib import Path

from .export import build_scene
from .grid import Grid
from .io import find_drift
from .potential import DEFAULT_LEVELS, load_potential, write_potential


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


def _add_export_potential_parser(subparsers) -> None:
    p = subparsers.add_parser(
        "export-potential", help="write the potential volume and isosurfaces"
    )
    p.add_argument("--root", required=True, help="pochoir OUTPUT directory")
    p.add_argument("--dest-dir", required=True, help="directory to write into")
    p.add_argument(
        "--zstride",
        type=int,
        default=1,
        help="keep every Nth z sample (default: 1)",
    )
    p.add_argument(
        "--levels",
        type=_float_list,
        default=list(DEFAULT_LEVELS),
        help="comma-separated equipotential levels in volts",
    )


def _float_list(text: str) -> list[float]:
    """Parse a comma-separated float list, e.g. ``-500,-2000``."""
    try:
        return [float(part) for part in text.split(",") if part.strip()]
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"expected comma-separated numbers, got {text!r}"
        ) from None


def _export_potential(args) -> int:
    source = find_drift(args.root, "potential", "field")
    arr = load_potential(args.root)
    grid = Grid.from_shape(arr.shape)

    meta = write_potential(
        args.root,
        args.dest_dir,
        grid,
        levels=args.levels,
        zstride=args.zstride,
    )

    print(f"source {source}")
    print(
        f"wrote {Path(args.dest_dir) / meta['bin']} "
        f"({meta['bytes'] / 1e6:.1f} MB, shape {meta['shape']}, zstride {meta['zstride']})"
    )
    for surface in meta["isosurfaces"]:
        print(f"  {surface['level']:9.1f} V -> {surface['n_tris']} triangles")
    if meta["skipped_levels"]:
        print(f"  skipped (outside {meta['vmin']}..{meta['vmax']} V): {meta['skipped_levels']}")
    return 0


def _export(args) -> int:
    scene = build_scene(
        args.root,
        spacing=(args.spacing,) * 3,
        max_points=args.max_points,
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
