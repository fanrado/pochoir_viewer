"""Command line entry point.

The only supported way to regenerate viewer data from a pochoir OUTPUT
directory.
"""

import argparse
import json
from pathlib import Path

from .export import build_scene


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pochoir_viewer")
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_export_parser(subparsers)

    args = parser.parse_args(argv)
    return _export(args)
