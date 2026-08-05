# POCHOIR VIEWER

A browser viewer for pochoir drift-field output: the boundary surfaces of the
drift domain plus the simulated electron drift paths, in one three.js scene.

## Quick start

```bash
python -m pochoir_viewer export --root ../OUTPUT/store_largepix_wgrid --dest web/data/scene.json
cd web && python -m http.server 8000
```

Then open <http://localhost:8000>.

The first command reads a pochoir OUTPUT directory and writes a single
`scene.json` (~0.9 MB for the reference dataset); the viewer does one fetch and
has no data-assembly logic of its own. Re-run it whenever the OUTPUT directory
changes. Generated data under `web/data/` is deliberately not committed.

## Data assumptions

The pochoir `.npz` files store bare arrays with no grid metadata, so the
sampling geometry is **inferred, not read**:

| quantity | assumed value |
| --- | --- |
| grid spacing | 0.1 mm on all three axes |
| origin | (0, 0, 0) |
| units | mm |

For the reference dataset that gives a 44 x 44 x 1601 grid, i.e. a
4.4 x 4.4 x 160.1 mm domain. If your run used a different node pitch, override
it — the export is wrong otherwise:

```bash
python -m pochoir_viewer export --root ... --dest ... --spacing 0.05
```

`--spacing` takes one value and applies it to all three axes. `--max-points`
(default 400) caps how many points per drift path survive decimation.

## Unused inputs

`initial/`, `domain/`, `increment/` and `starts/` are intentionally ignored —
they hold solver scratch state rather than results, and `domain/drift.npz` is
an empty array. The exclusion lives in exactly one place, `SKIP_DIRS` in
`pochoir_viewer/io.py`. Of the 18 `.npz` files in the reference dataset, 9 sit
under those directories and 9 are readable datasets.

## Requirements

- Python with numpy, for the export step.
- **Network access at page load.** three.js is not vendored; `web/index.html`
  pins it via an import map to unpkg (`three@0.169.0`). The page will not
  render offline.

## A note on the z scale

The domain is a needle: 160.1 mm of drift against 4.4 mm transverse, an aspect
ratio of about 36:1. At true scale it is a nearly invisible sliver, so the
viewer opens with the z axis compressed by a factor of 10. **That is a display
choice, not the data.** Compressing z exaggerates transverse motion and so
misrepresents drift angles — a path that looks steeply inclined at x10 is
ten times shallower in reality. The compression factor in force is always
stated on screen next to the slider, along with both the true and the displayed
dimensions, and the **x1 (true scale)** button restores the undistorted
geometry in one click. Any conclusion about path angle should be checked at x1.
