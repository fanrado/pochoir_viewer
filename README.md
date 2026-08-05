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

### Dataset naming

pochoir is inconsistent about how it spells the drift array. It writes
`drift.npz` under `boundary/`, `domain/`, `increment/` and `initial/`, but
`drift3d.npz` under `paths/`, `potential/`, `starts/` and `velocity/`. The
contents are identical.

The viewer accepts either spelling wherever it reads a drift array, so an
output folder using the other convention works without any flag. If a
directory somehow contains both, `drift3d.npz` wins as the explicitly-3D name.
The same tolerance applies to the endtag array (`drift3d_endtag.npz` or
`drift_endtag.npz`). Names are matched exactly rather than globbed, so
neighbours like `drift_insulator.npz` are never picked up by mistake.

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

## Navigation

The single most important thing to know: **all rotation happens about the
yellow dot.** That dot is the orbit pivot, and it is drawn precisely because it
moves — a pivot that has drifted somewhere unexpected is the usual reason
rotation starts feeling wrong.

| input | effect |
| --- | --- |
| left-drag | orbit about the yellow pivot |
| right-drag (or two-finger drag) | pan — **this moves the pivot** |
| scroll | zoom |
| double-click a path or boundary surface | put the pivot on that point |

Right-drag panning is the one action that relocates the pivot. If rotation
suddenly swings the scene around some far-off point, the pivot has been panned
away; press <kbd>C</kbd> or click **center on domain** to bring it home, or
double-click whatever you actually want to inspect to move it there.

The **pivot readout** in the panel always names the pivot's position, and its
z is reported in **true mm regardless of the z-compression setting** — with
compression at ×10 the cathode still reads about 160.1 mm, not 16.0.

### View cube

The cube in the top-right corner mirrors the current orientation. Click a face,
edge, or corner to snap to that canonical view — faces give axis views, edges
and corners give isometric ones — or drag the cube to orbit. Face labels are
domain-specific: **+Z cathode** and **-Z anode** tell you which end of the
drift you are looking at. Clicking a face reframes the geometry for the current
z-compression, so a +Z view fits the pad plane while a +X view fits the drift
slab. None of the cube's actions move the pivot.

### Keyboard shortcuts

| key | action |
| --- | --- |
| <kbd>1</kbd> … <kbd>6</kbd> | axis views: +X, -X, +Y, -Y, +Z, -Z |
| <kbd>F</kbd> | move the pivot to the geometry under the cursor |
| <kbd>C</kbd> | center the pivot on the domain |
| <kbd>R</kbd> | reset the view |

Shortcuts stand down while a slider or button has focus, so arrow keys still
adjust the focused control.
