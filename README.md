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

### Install

```bash
pip install -r requirements.txt
```

Plain `export` needs **only numpy**. `scikit-image` is required *only* for
`export-potential`, which uses marching cubes for the isosurfaces; the import is
lazy, so everything else works without it installed.

### Adding the potential view (optional)

```bash
python -m pochoir_viewer export-potential --root ../OUTPUT/store_largepix_wgrid --dest-dir web/data
```

This writes `potential.bin` (the raw float32 volume) and `potential.json`
(metadata plus precomputed isosurface meshes) beside `scene.json`.

| flag | meaning |
| --- | --- |
| `--zstride N` | keep every Nth z sample: **12.4 MB** at `--zstride 1`, **3.1 MB** at `--zstride 4` |
| `--levels ...` | comma-separated equipotential levels in volts, default `-500,-2000,-4000,-6000,-8000` |

Levels outside the data range are reported as skipped rather than failing, and
the viewer states them in the panel.

This step is **optional**. Without `potential.json` the viewer still runs
normally with drift paths and boundary surfaces, and the two potential layer
buttons render disabled with a tooltip naming the command above.

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
`pochoir_viewer/io.py`.

The reference dataset holds 18 `.npz` files, and the split is exactly even —
9 skipped, 9 readable:

| skipped | files | readable | files |
| --- | --- | --- | --- |
| `initial/` | 4 | `boundary/` | 2 |
| `domain/` | 2 | `potential/` | 2 |
| `increment/` | 2 | `paths/` | 2 |
| `starts/` | 1 | `velocity/` | 2 |
| | | `current/` | 1 |
| **total** | **9** | **total** | **9** |

`initial/` holding four files — `drift`, `weight`, `drift_insulator` and
`weight_insulator` — is why the skipped side is larger than the directory count
suggests. Check it yourself in one command:

```bash
python -c "from pochoir_viewer.io import list_datasets; print(len(list_datasets('../OUTPUT/store_largepix_wgrid')))"
```

## Requirements

- Python with numpy, for the export step; plus scikit-image if you also run
  `export-potential` (see [Install](#install)).
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

## Layers

The **view** button group at the top of the panel chooses what is on screen.
All four are **independently toggleable** — showing drift paths over a potential
slice is the point, not an accident.

| button | shows |
| --- | --- |
| **Drift paths** | the 100 simulated electron trajectories |
| **Potential slice** | one plane through the potential volume, plus its controls |
| **Isosurfaces** | the precomputed equipotential sheets |
| **Boundary** | the anode / grid / cathode surfaces |

Toggling a layer never moves the camera or the pivot. The per-group boundary
checkboxes still work as a sub-filter underneath the **Boundary** button.

Drift paths and Boundary start on; the two potential layers start off and are
disabled entirely if `potential.json` was never exported.

### Reading the potential

Turning on **Potential slice** reveals its controls:

- **axis** — x, y, or z, selecting which way the plane cuts.
- **slice slider** — moves the plane through the volume; its label names the
  position, e.g. `z = 13.10 mm (index 131)`.
- **colorbar** — the value scale, labelled with the actual data range from
  `potential.json` (0 V at the top, -9500 V at the bottom for the reference
  dataset). A tick marks the value currently under the cursor.
- **voltage readout** — hovering the plane reports the voxel under the pointer
  as `(2.20, 2.20, 13.10) mm = -2000.0 V`.

The slice image uses nearest-neighbour sampling, so voxels stay honest rather
than being smoothed into a prettier but invented gradient. As with the pivot
readout, **the reported z is always true mm** — the z-compression setting and
any `--zstride` are both undone before the number is shown.

### A physics check you can see

The **-2000 V isosurface coincides with the grid plane at z = 13.1 mm.** Turn on
both **Isosurfaces** and **Boundary** and that sheet should sit flush with the
grid surface. If it floats away from it, something in the export or the grid
spacing is wrong — it is a free correctness check on the whole pipeline.

## The weighting field

The viewer shows two fields. The **field** selector at the top of the panel
switches between them; it is exclusive, unlike the layer buttons below it.

The weighting domain is a different size from the drift one: **220 x 220 x 1601
nodes = 22.0 x 22.0 x 160.1 mm**, five times wider transversely. Switching
fields refits the camera and restates the extent, because framing that suits one
domain leaves the other off-screen.

### Exporting it

Two more commands, alongside the drift ones:

```bash
python -m pochoir_viewer export --field weight --dest web/data/scene_weight.json
python -m pochoir_viewer export-potential --field weight --dest-dir web/data
```

The weighting payload is written as `scene_weight.json`, `potential_weight.bin`
and `potential_weight.json`, so both fields can sit in `web/data` at once.

### Why it is strided, not cropped

At full float32 resolution the weighting potential is **310 MB**, too much to
hand a browser, so `--field weight` defaults to `--stride 2,2,2` — a **38.8 MB**
volume plus about 3.7 MB of isosurface meshes, with **no default crop**. See
[Seeing the whole weighting field](#seeing-the-whole-weighting-field) for the
size trade-offs and why striding is preferred to cropping.

If you do crop with `--zmax`, it is lossy, and by more than the largest
discarded value suggests:

| beyond z index | largest remaining \|value\| | share of total \|value\| discarded |
| --- | --- | --- |
| 265 | 1.0e-3 | 1.46% |
| 300 | 5.2e-4 | 0.76% |
| 400 | 6.3e-5 | 0.08% |
| 600 | 1.4e-7 | 0.0001% |

The second column is the one to weigh if you are computing induced charge rather
than looking at the field: that integrates the weighting potential, so what
matters is the fraction of the total discarded, not the largest single value. A
crop at z 300 discards 0.76% of it; `--zmax 600` discards 0.0001%.

### What is different in the weighting view

- **No drift paths.** The weighting domain contains none, so the **Drift paths**
  layer button is disabled while the weighting field is selected.
- **Boundary groups are labelled by z position** — `z 0.0 mm`,
  `z 9.8-10.1 mm`, `z 13.1 mm`, `z 159.9-160.1 mm` — rather than
  anode/grid/cathode. The weighting boundary has full planes at z = 0 and at
  z = 1599-1600, and the role heuristic would confidently label the z = 0 plane
  "anode", which it is not. Position is what is actually known.
- **Units are dimensionless.** The weighting potential runs 0..1, so the
  colorbar, the hover readout and the contour legend all drop the volt suffix.
  Nothing in the UI hardcodes volts; it all reads the exported units.
- **The 3D view is nested shells.** The isosurfaces run 0.9, 0.75, 0.5, 0.25,
  0.1, 0.05, 0.01 — deliberately log-ish, since the potential falls off fast
  (1.0 at the pad, 0.115 at the grid, 0.0025 by z = 150). Each level is a closed
  **shell wrapping a pad**, not a flat sheet above it: the potential is 1.0 only
  on the pad itself and falls away in every direction, so the 0.5 shell spans
  z 8.4-11.2 mm, straddling the pad plane at 9.8-10.0 mm.

### Slices and contours

The axis buttons name both the plane and its normal:

| button | plane | normal |
| --- | --- | --- |
| **xy (z-slice)** | xy | z |
| **yz (x-slice)** | yz | x |
| **xz (y-slice)** | xz | y |

**Contours** overlays iso-lines on whichever slice is showing, with a checkbox
per level and a legend. Levels are evenly spaced every 1000 V for the drift
field and use the log-ish 0.9..0.01 set for the weighting field, and the legend
carries the unit for whichever field is loaded. Contour colours come from the
same ramp as the slice image and the colorbar, so a line always matches the band
it traces.

Note that an xy slice of the *drift* potential is nearly uniform — that field is
essentially one-dimensional in z — so contours there are sparse or absent by
nature. The yz and xz planes are where the drift structure is legible.

## Visibility and contour controls

### Payload filenames

The two fields write distinct files, so both can live in `web/data` at once:

| field | files |
| --- | --- |
| drift | `scene.json`, `potential.bin`, `potential.json` |
| weight | `scene_weight.json`, `potential_weight.bin`, `potential_weight.json` |

`--basename` overrides the stem if you want somewhere else:

```bash
python -m pochoir_viewer export-potential --root ... --dest-dir web/data --field weight --basename wpot
```

Earlier versions wrote `potential.bin` for **both** fields, so exporting one
silently destroyed the other and only the last export was present. If you have
a `web/data` from before that fix, re-run both exports.

### Isosurface appearance

Shell colours come from a fixed bright palette — magenta, orange, yellow,
green, cyan, blue, violet, running from the innermost (highest) level outwards.

**These deliberately do not match the colorbar.** Tying them to the ramp is what
the viewer used to do, and it made every shell muddy, because low weighting
values sit at the dark end of the ramp and the outer shells are exactly the low
values. The colorbar still governs **the slice image**; the shells get their own
palette, and the legend carries a swatch per level so a colour is still readable
as a value. Shells are drawn outermost-first so the nested translucency blends
correctly where they cross the pad and grid planes.

The **isosurface opacity** slider sets all shells at once. At 100% they switch
to genuine solid rendering rather than fully-opaque transparency, which would
otherwise sort incorrectly. The setting survives slice, axis and field changes.

### Slice display modes

| mode | shows |
| --- | --- |
| **Image** | the colormap plane only |
| **Contours** | iso-lines only — the plane is hidden, giving a clean `plt.contour`-style plot |
| **Both** (default) | image with the contour overlay |

**Contours** hides the textured plane outright rather than fading it, so nothing
bleeds through from behind. Switching modes never moves the camera or resets the
contour selection.

Contour levels are currently a fixed set per field: every 1000 V for the drift
potential, and the log-ish 0.9, 0.75, 0.5, 0.25, 0.1, 0.05, 0.01 for the
weighting potential. Each level has its own checkbox.

### Why the weighting levels are log-spaced

This is the one result that looks wrong until you see the numbers. The weighting
potential is *extremely* skewed, and its per-slice range varies enormously:

| xy slice | max | median |
| --- | --- | --- |
| z = 101 | 0.954 | 0.000067 |
| z = 131 | 0.116 | 0.000117 |
| z = 150 | 0.025 | 0.001107 |

The range spans about **37x** between z = 101 and z = 150, and within a single
slice the skew is severe: at z = 101 the median is 0.00007 against a maximum of
0.954, and **89.7% of the cells sit below 1% of that maximum.**

So evenly spaced levels are *faithful* — they are what `plt.contour` draws by
default — but on this field they put nearly every level inside the top 1% of the
data, leaving the other 99% as one flat region. That is why the weighting levels
are log-ish instead: they reveal structure that linear spacing collapses. If you
compare against a `plt.contour` reference and the lines look sparse, this skew is
the reason, not a bug.

## Seeing the whole weighting field

### The full-depth default

`--field weight` now exports the **entire z range** at `--stride 2,2,2`:

| stride | z range | shape | size |
| --- | --- | --- | --- |
| `1,1,1` | full | 220 x 220 x 1601 | 310 MB — too large to ship |
| **`2,2,2`** | **full** | **110 x 110 x 801** | **38.8 MB — the default** |
| `2,2,4` | full | 110 x 110 x 401 | 19.4 MB |
| `2,2,1` + `--zmax 300` | 0–30 mm | 110 x 110 x 300 | 14.5 MB |

At 0.2 mm z sampling the 3.1 mm pad-to-grid gap still gets 16 samples, which is
why stride 2 is acceptable. Trade size against resolution with `--stride`, and
crop with `--zmax` if you only care about the pad region.

### The corrected physics

**An earlier assumption in this project — that the weighting potential is
essentially zero beyond about 60 mm — was wrong.** The field is nonzero out to
**159.8 mm**, almost the full drift length. Its smallest positive value is
**3.4e-40**, so the volume spans about **39.5 orders of magnitude**.

That is why the old `--zmax 300` default was replaced: it silently discarded
real structure from 30 mm out to 159.8 mm. If you do crop, the export tells you
exactly what went with it — largest discarded value and the share of total
magnitude. No crop of this field is lossless, and the tool no longer claims
otherwise.

### Why log scaling is required, not a preference

Spread 39.5 decades across a linear colour ramp and everything outside the pad
region collapses into a single flat colour. That is arithmetic, not a viewer
defect: past 60 mm the values run from 1.4e-7 down to 3.5e-40, which is
indistinguishable from zero on a 0..1 linear scale.

Concretely, with 200 contour levels over the weighting volume:

| spacing | levels landing in the range past 60 mm |
| --- | --- |
| linear | **0** |
| log | **28** |

So the weighting field defaults to **log** colour scaling and log-spaced
contours. Drift defaults to linear.

**Log is unavailable for the drift potential**, and its toggle is disabled with
a tooltip explaining why: drift runs -9500..0 V, and the logarithm of a negative
number is undefined. The viewer refuses rather than painting nonsense.

### Levels and decades

The **levels** slider runs 100 to 5000. It recomputes on **release, not during
the drag** — deliberately, because the cost is real:

| levels | segments | time |
| --- | --- | --- |
| 200 | ~71,000 | ~0.08 s |
| 1000 | ~356,000 | ~0.36 s |
| 5000 | ~1,780,000 | ~1.6 s |

A status line reports the segment count and elapsed time after each rebuild, so
a slow setting explains itself. Per-level checkboxes appear up to 24 levels;
past that the panel just states the count, since 5000 checkboxes would be
useless.

The **decades** slider sets how far below the maximum the colour ramp reaches:
at 8 decades the floor is `1e-8 x max`, and anything at or below it takes the
ramp's first colour. Exact zeros land there too.

**A caveat on the deep tail.** Below roughly **1e-12** these values are
numerical residue from the relaxation solver, not physics. The 8-decade default
covers everything physically meaningful. Pushing the slider to 20 decades will
show solver noise — the control reaches that far because seeing the whole field
was the explicit ask, not because 20 decades is a sensible analysis setting.
