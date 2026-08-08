// The interactive potential slice: a single textured plane through the volume.
//
// The pure maths lives in potential_build.js; this module owns the fetch, the
// three.js objects, and the DOM wiring.

import * as THREE from "three";
import { contourSegments } from "./contour_build.js";
import {
  extractSlice,
  metaStride,
  scalePosition,
  rampPosition,
  rampRGB,
  sliceLabel,
  slicePlaneParams,
  valuesToRGBA,
} from "./potential_build.js";

/**
 * Fetch the optional potential payload.
 *
 * Returns null when it is absent or unusable — the potential export is opt-in,
 * so a missing payload is a normal state, not an error.
 */
export async function fetchPotential(base = "data", name = "potential.json") {
  const metaResponse = await fetch(`${base}/${name}`);
  if (!metaResponse.ok) {
    throw new Error(`${base}/${name}: HTTP ${metaResponse.status}`);
  }
  const meta = await metaResponse.json();

  const binResponse = await fetch(`${base}/${meta.bin}`);
  if (!binResponse.ok) {
    throw new Error(`${base}/${meta.bin}: HTTP ${binResponse.status}`);
  }
  const buffer = await binResponse.arrayBuffer();

  if (buffer.byteLength !== meta.bytes) {
    throw new Error(
      `${meta.bin} is ${buffer.byteLength} bytes, expected ${meta.bytes} ` +
        `— re-run: python -m pochoir_viewer export-potential`,
    );
  }

  return { meta, volume: new Float32Array(buffer) };
}

/** Number of samples along `axis` for this volume. */
export function axisExtent(meta, axis) {
  return meta.shape[{ x: 0, y: 1, z: 2 }[axis]];
}

/**
 * Build the slice plane and return its mesh plus an updater.
 *
 * The mesh is added to `sceneRoot`, so the z-compression slider scales it in
 * step with the rest of the geometry.
 */
export function createSliceView(meta, volume, sceneRoot) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthWrite: false, // read through the translucent boundary planes
    transparent: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "potentialSlice";
  mesh.visible = false;
  sceneRoot.add(mesh);

  let texture = null;
  let texWidth = 0;
  let texHeight = 0;
  let scaleOpts = { scale: "linear", decades: 8 };
  let last = null; // remembered so a scale change can repaint the same slice

  function updateSlice(axis, index) {
    last = { axis, index };
    const { width, height, values } = extractSlice(volume, meta.shape, axis, index);

    // extractSlice runs along the plane's width axis first; a DataTexture wants
    // whole rows, so transpose into row-major (b * width + a) order.
    const rowMajor = new Float32Array(values.length);
    for (let a = 0; a < width; a++) {
      for (let b = 0; b < height; b++) {
        rowMajor[b * width + a] = values[a * height + b];
      }
    }
    const rgba = valuesToRGBA(rowMajor, meta.vmin, meta.vmax, scaleOpts);

    if (texture && width === texWidth && height === texHeight) {
      texture.image.data.set(rgba); // same dimensions: reuse the buffer
    } else {
      texture?.dispose();
      texture = new THREE.DataTexture(
        rgba,
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      // Voxels stay honest: no interpolation smoothing.
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texWidth = width;
      texHeight = height;
      material.map = texture;
      material.needsUpdate = true;
    }
    texture.needsUpdate = true;

    const plane = slicePlaneParams(axis, index, meta);
    mesh.scale.set(plane.width, plane.height, 1);
    mesh.position.set(...plane.center);
    mesh.rotation.set(...plane.rotation);

    return plane;
  }

  /** Change the colour scaling and repaint the current slice in place. */
  function setScale(opts) {
    scaleOpts = { ...scaleOpts, ...opts };
    if (last) updateSlice(last.axis, last.index);
    return scaleOpts;
  }

  return {
    mesh,
    updateSlice,
    setScale,
    getScale: () => ({ ...scaleOpts }),
    meta,
    get texture() { return texture; },
  };
}

/** Voxel indices for a point on the slice plane, given its UV. */
export function uvToVoxel(u, v, axis, index, meta) {
  const clamp = (n, limit) => Math.min(Math.max(n, 0), limit - 1);
  const [ni, nj, nk] = meta.shape;

  if (axis === "z") {
    return [clamp(Math.floor(u * ni), ni), clamp(Math.floor(v * nj), nj), index];
  }
  if (axis === "x") {
    return [index, clamp(Math.floor(u * nj), nj), clamp(Math.floor(v * nk), nk)];
  }
  return [clamp(Math.floor(u * ni), ni), index, clamp(Math.floor(v * nk), nk)];
}

/**
 * Value and TRUE-mm position of a voxel.
 *
 * Computed straight from the indices, so the reported z is true mm whatever
 * sceneRoot.scale.z is doing — the compression never enters the arithmetic.
 */
export function voxelReading(volume, meta, i, j, k) {
  const [sx, sy, sz] = meta.spacing;
  const [tx, ty, tz] = metaStride(meta);
  const origin = meta.origin ?? [0, 0, 0];
  return {
    value: volume[(i * meta.shape[1] + j) * meta.shape[2] + k],
    // Every axis carries its own stride, so the reported x and y agree with the
    // boundary geometry and the pivot readout rather than reading half-scale.
    mm: [
      origin[0] + i * tx * sx,
      origin[1] + j * ty * sy,
      origin[2] + k * tz * sz,
    ],
  };
}

/**
 * True millimetre extent of a loaded payload, with its sample counts.
 *
 * Each axis holds every stride[k]-th sample, so the span it covers is
 * shape[k] * stride[k] * spacing[k] — not shape[k] * spacing[k], which would
 * report a strided export at a fraction of its real size.
 */
export function payloadExtent(meta) {
  const stride = metaStride(meta);
  const voxel = meta.spacing.map((s, k) => stride[k] * s);
  return {
    shape: [...meta.shape],
    stride,
    voxel,
    mm: meta.shape.map((n, k) => n * voxel[k]),
  };
}

/**
 * Which axes of `meta` fail to cover the scene domain.
 *
 * A payload may legitimately end one voxel short of the domain, since the
 * extent above counts whole voxels; anything more than that is a real crop.
 * Returns one entry per short axis, empty when the payload covers the domain.
 */
export function payloadShortfall(meta, sceneExtentMm) {
  if (!sceneExtentMm) return [];
  const { mm, voxel } = payloadExtent(meta);
  const shortfall = [];
  for (let k = 0; k < 3; k += 1) {
    const domain = sceneExtentMm[k];
    if (domain == null) continue;
    if (mm[k] < domain - voxel[k]) {
      shortfall.push({ axis: "xyz"[k], mm: mm[k], domain });
    }
  }
  return shortfall;
}

/**
 * Show the loaded payload's extent, and warn when it does not reach the domain.
 *
 * This exists because a stale export already cost a debugging round: Step 13.1
 * changed the weighting default from a 30 mm z crop to the full 160.1 mm
 * domain, but web/data/ is gitignored, so the viewer kept loading the cropped
 * payload. The slice stopped a few mm past the pixel plane and nothing on
 * screen said the data — rather than the rendering — was short.
 *
 * Called once per payload load, never per frame.
 */
export function renderPayloadInfo(meta, sceneExtentMm, doc = globalThis.document) {
  const box = doc.getElementById("payload-info");
  if (!box) return null;

  const { shape, stride, mm } = payloadExtent(meta);
  const fmt = (v) => v.toFixed(1);
  const text =
    `volume ${mm.map(fmt).join(" x ")} mm` +
    `  (${shape.join(" x ")}, stride ${stride.join(",")})`;

  const shortfall = payloadShortfall(meta, sceneExtentMm);
  const warnings = shortfall.map(({ axis, mm: extent, domain }) =>
    axis === "z"
      ? `payload cropped at ${fmt(extent)} mm - re-export without --zmax ` +
        `to reach the cathode (${fmt(domain)} mm)`
      : `payload cropped at ${fmt(extent)} mm along ${axis} - the domain is ` +
        `${fmt(domain)} mm`,
  );

  box.textContent = [text, ...warnings].join("\n");
  box.classList.toggle("payload-cropped", warnings.length > 0);
  return { text, warnings };
}

/**
 * Fail with the caller's name when there is no document to wire against.
 * Without this the first getElementById raises a bare "cannot read properties
 * of undefined", which says nothing about which entry point was misused.
 */
function requireDocument(doc, who) {
  if (!doc || typeof doc.getElementById !== "function") {
    throw new TypeError(
      `${who} needs a document: none was passed and globalThis.document is unavailable`,
    );
  }
}

/** Draw the vertical colorbar and its hover tick. */
export function createColorbar(meta, doc = globalThis.document) {
  requireDocument(doc, "createColorbar");
  const canvas = doc.getElementById("colorbar");
  const ctx = canvas?.getContext("2d");
  const { width, height } = canvas ?? { width: 0, height: 0 };

  // Units follow the field: volts for drift, a bare ratio for weighting.
  // Absent units means the Phase 8 drift wire format, which was always volts.
  const volts = (meta.units ?? "V") === "V";
  const tag = (v) => (volts ? `${v.toFixed(0)} V` : `${v}`);
  const maxLabel = doc.getElementById("colorbar-max");
  const minLabel = doc.getElementById("colorbar-min");
  if (maxLabel) maxLabel.textContent = tag(meta.vmax);
  if (minLabel) minLabel.textContent = tag(meta.vmin);

  const scaleBox = doc.getElementById("colorbar-scale");
  let opts = { scale: "linear", decades: 8 };

  /**
   * Decade tick labels for log mode, placed with the SHARED scalePosition, so
   * a tick can never sit somewhere the image does not agree with.
   */
  function drawTicks() {
    if (!scaleBox) return;
    for (const old of [...(scaleBox.children ?? [])]) {
      if (old.className === "cb-tick") old.remove?.();
    }
    if (opts.scale !== "log") return;

    for (let d = 0; d <= opts.decades; d++) {
      const value = meta.vmax * Math.pow(10, -d);
      const t = scalePosition(value, meta.vmin, meta.vmax, opts);
      const tick = doc.createElement("span");
      tick.className = "cb-tick";
      tick.style.top = `${(1 - t) * 100}%`;
      tick.textContent = d === 0 ? `${meta.vmax}` : `1e-${d}`;
      scaleBox.append(tick);
    }
  }

  function draw(hovered = null) {
    if (!ctx) return;
    // One ramp sample per row, top = vmax, through the same mapping as the plane.
    const column = new Float32Array(height);
    for (let row = 0; row < height; row++) {
      column[row] = meta.vmax - ((meta.vmax - meta.vmin) * row) / (height - 1);
    }
    const rgba =
      opts.scale === "log"
        ? logColumn(column, height)
        : valuesToRGBA(column, meta.vmin, meta.vmax, opts);

    for (let row = 0; row < height; row++) {
      const [r, g, b] = rgba.slice(row * 4, row * 4 + 3);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, row, width, 1);
    }
    if (hovered === null) return;

    // Triangular tick at the hovered value's position, on the active scale.
    const t = scalePosition(hovered, meta.vmin, meta.vmax, opts);
    const y = Math.round((1 - t) * (height - 1));
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(0, y - 4);
    ctx.lineTo(7, y);
    ctx.lineTo(0, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /**
   * In log mode the bar itself must be uniform in ramp position, not in value,
   * so each row is painted from its own normalised position.
   */
  function logColumn(_column, rows) {
    const rgba = new Uint8Array(rows * 4);
    for (let row = 0; row < rows; row++) {
      const t = 1 - row / (rows - 1);
      const [r, g, b] = rampRGB(t);
      rgba[row * 4] = r;
      rgba[row * 4 + 1] = g;
      rgba[row * 4 + 2] = b;
      rgba[row * 4 + 3] = 255;
    }
    return rgba;
  }

  function setScale(next) {
    opts = { ...opts, ...next };
    drawTicks();
    draw();
    return opts;
  }

  draw();
  drawTicks();
  return { draw, setTick: draw, setScale };
}

/**
 * Wire the axis radios and the slice slider to `view`.
 *
 * On axis change the slider range is rebuilt from the volume shape and the
 * current index clamped, so a tall z range cannot leave a stale index behind.
 */
export function wireSliceControls(view, doc = globalThis.document, onRender = null) {
  requireDocument(doc, "wireSliceControls");
  const slider = doc.getElementById("slice-idx");
  const label = doc.getElementById("slice-label");
  const radios = {
    x: doc.getElementById("axis-x"),
    y: doc.getElementById("axis-y"),
    z: doc.getElementById("axis-z"),
  };

  let axis = Object.keys(radios).find((a) => radios[a]?.checked) ?? "z";

  function render(index) {
    view.updateSlice(axis, index);
    if (label) label.textContent = sliceLabel(axis, index, view.meta);
    onRender?.(axis, index);
  }

  function setAxis(next) {
    axis = next;
    const limit = axisExtent(view.meta, axis) - 1;
    const wanted = Math.min(Number(slider.value), limit);
    slider.max = String(limit);
    slider.value = String(wanted);
    render(wanted);
  }

  for (const [name, radio] of Object.entries(radios)) {
    radio?.addEventListener("change", () => {
      if (radio.checked) setAxis(name);
    });
  }

  slider?.addEventListener("input", () => render(Number(slider.value)));

  // Open on the middle of the starting axis: more informative than an edge.
  const limit = axisExtent(view.meta, axis) - 1;
  slider.max = String(limit);
  slider.value = String(Math.floor(limit / 2));
  render(Number(slider.value));

  return { getAxis: () => axis, setAxis, render };
}

/**
 * `count` contour levels across (vmin, vmax), linear or log spaced.
 *
 * Log spacing is what makes the weighting field legible: it spans ~39.5
 * decades, so linear levels land almost entirely inside the top 1% of the
 * range. Endpoints are excluded — a contour exactly at the extreme has nothing
 * to separate.
 *
 * Only `.vmin` and `.vmax` are read, so per-slice scaling can pass one slice's
 * own range here in place of the payload-wide meta.
 */
export function contourLevels(meta, count, opts = { scale: "linear", decades: 8 }) {
  const n = Math.max(1, Math.floor(count));
  const levels = [];

  if (opts.scale === "log") {
    // The decades window is the floor only when vmin cannot supply one. A
    // per-slice range has a positive vmin, and honouring it is what puts the
    // levels inside the data: a slice spanning 3.7e-4..5.0e-4 covers well under
    // one decade, so an 8-decade window below its max would place all but a
    // handful of levels beneath anything the slice contains. Global ranges start
    // at vmin = 0, where the window remains the only usable floor.
    const floor = Math.max(meta.vmin, meta.vmax * Math.pow(10, -opts.decades));
    const logFloor = Math.log10(floor);
    const logMax = Math.log10(meta.vmax);
    for (let k = 1; k <= n; k++) {
      levels.push(Math.pow(10, logFloor + ((logMax - logFloor) * k) / (n + 1)));
    }
    return levels;
  }

  for (let k = 1; k <= n; k++) {
    levels.push(meta.vmin + ((meta.vmax - meta.vmin) * k) / (n + 1));
  }
  return levels;
}

/** Evenly spaced contour levels across (vmin, vmax), excluding the endpoints. */
export function defaultContourLevels(meta, step = 1000) {
  if ((meta.units ?? "V") !== "V") return [...WEIGHT_CONTOUR_LEVELS];

  const levels = [];
  const first = Math.ceil(meta.vmin / step) * step;
  for (let v = first; v < meta.vmax; v += step) {
    if (v > meta.vmin) levels.push(v);
  }
  return levels;
}

/** Weighting-potential contour levels: log-ish, matching WEIGHT_LEVELS. */
export const WEIGHT_CONTOUR_LEVELS = [0.9, 0.75, 0.5, 0.25, 0.1, 0.05, 0.01];

/** The two contour level-scaling modes. */
export const CONTOUR_SCALINGS = ["global", "slice"];

/**
 * Value range of one extracted slice, or null when the slice is flat.
 *
 * A flat slice has nothing for a contour to separate, so callers fall back to
 * the global range rather than dividing by a zero span.
 */
export function sliceRange(values) {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let n = 0; n < values.length; n += 1) {
    const v = values[n];
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  return vmax > vmin ? { vmin, vmax } : null;
}

/**
 * Draw contour lines over the slice plane.
 *
 * ONE merged LineSegments holds every level, coloured per vertex by that level's
 * ramp position. Step 10.15 used one object per level, which is fine for seven
 * but not for the CONTOUR_LEVEL_COUNT levels drawn now: that many draw calls
 * would lock the page.
 *
 * Geometry is placed with the SAME slicePlaneParams as the textured plane, so
 * lines cannot drift from the colour bands they trace, and nudged a fraction of
 * one voxel along the normal to avoid z-fighting.
 */

export function createContourView(meta, volume, sceneRoot, doc = globalThis.document) {
  const group = new THREE.Group();
  group.name = "contourGroup";
  group.visible = false;
  sceneRoot.add(group);

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  lines.name = "contourLines";
  group.add(lines);

  let levels = defaultContourLevels(meta);
  let scaleOpts = { scale: "linear", decades: 8 };
  let last = null;

  // Per-slice is the weighting default and global the drift default. The
  // weighting slice maxima span 37.6x (0.954 at z=101 against 0.025 at z=150),
  // so a global range leaves a low-max slice nearly blank; the drift potential
  // runs a near-linear -9500..0 V and gains nothing from renormalising.
  // meta.vmin < 0 identifies the signed drift field, the same test
  // wireScaleControls uses to disable log.
  let scaling = meta.vmin < 0 ? "global" : "slice";

  /**
   * The levels to draw on one slice, and the range they were placed across.
   *
   * Global scaling uses the level set as given. Per-slice re-places the SAME
   * NUMBER of levels across the slice's own range, which is the whole point:
   * 200 levels spread over the payload's 0..0.954 leave a 0.025-max slice with
   * almost every level above its data. The colour ramp keys to the same range
   * the levels came from, or a per-slice set would collapse into one colour at
   * the bottom of the ramp.
   *
   * Deliberately NOT touched: the slice image and the colorbar keep the
   * payload-wide meta.vmin/vmax, so the voltage scale on screen stays stable
   * and comparable while scrubbing.
   */
  function activeLevels(slice) {
    if (scaling !== "slice") return { levels, range: meta };
    const range = sliceRange(slice.values);
    if (!range) return { levels, range: meta }; // flat slice
    return {
      levels: contourLevels(range, levels.length, scaleOpts),
      range,
    };
  }

  /** Rebuild the merged buffer for the given slice. Returns the segment count. */
  function update(axis, index) {
    last = { axis, index };
    const slice = extractSlice(volume, meta.shape, axis, index);
    const plane = slicePlaneParams(axis, index, meta);

    const positions = [];
    const colors = [];
    const scratch = new THREE.Color();

    const active = activeLevels(slice);

    for (const level of active.levels) {
      const segments = contourSegments(slice.values, slice.width, slice.height, level);
      if (segments.length === 0) continue;

      const t = scalePosition(level, active.range.vmin, active.range.vmax, scaleOpts);
      const [r, g, b] = rampRGB(t);
      scratch.setRGB(r / 255, g / 255, b / 255);

      for (let n = 0; n < segments.length; n += 2) {
        positions.push(
          (segments[n] - 0.5) * plane.width,
          (segments[n + 1] - 0.5) * plane.height,
          0,
        );
        colors.push(scratch.r, scratch.g, scratch.b);
      }
    }

    // Offset along the normal by a fraction of ONE VOXEL, which is
    // stride[k] * spacing[k] on each axis.
    const [sx, sy, sz] = meta.spacing;
    const [tx, ty, tz] = metaStride(meta);
    const voxel = axis === "x" ? tx * sx : axis === "y" ? ty * sy : tz * sz;
    const normal = new THREE.Vector3(
      axis === "x" ? 1 : 0,
      axis === "y" ? 1 : 0,
      axis === "z" ? 1 : 0,
    ).multiplyScalar(0.02 * voxel);

    lines.geometry.dispose(); // replaced wholesale; do not leak the old buffer
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(colors), 3),
    );
    lines.geometry = geometry;

    lines.position.set(...plane.center).add(normal);
    lines.rotation.set(...plane.rotation);

    return positions.length / 6; // two vertices per segment
  }

  /** Replace the level set, keeping the current slice. Returns segment count. */
  function setLevels(next) {
    levels = [...next];
    return last ? update(last.axis, last.index) : 0;
  }

  function setScale(opts) {
    scaleOpts = { ...scaleOpts, ...opts };
    if (last) update(last.axis, last.index);
  }

  /** Switch level scaling. Returns the new segment count. */
  function setScaling(mode) {
    if (!CONTOUR_SCALINGS.includes(mode)) return 0;
    scaling = mode;
    paintScalingButtons();
    return last ? update(last.axis, last.index) : 0;
  }

  // Like the contour toggle below, these live here so the contour layer owns
  // all of its own DOM.
  const scalingButtons = {
    global: doc.getElementById("scaling-global"),
    slice: doc.getElementById("scaling-slice"),
  };

  function paintScalingButtons() {
    for (const [mode, button] of Object.entries(scalingButtons)) {
      const on = mode === scaling;
      button?.setAttribute("aria-pressed", String(on));
      button?.classList?.toggle("active", on);
    }
  }

  for (const [mode, button] of Object.entries(scalingButtons)) {
    button?.addEventListener("click", () => setScaling(mode));
  }

  // The group toggle lives here rather than in viewer.js so the contour layer
  // owns all of its own DOM.
  const toggle = doc.getElementById("layer-contours");
  toggle?.addEventListener("click", () => {
    const on = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.classList?.toggle("active", on);
    group.visible = on;
  });

  paintScalingButtons();
  return {
    group,
    update,
    setLevels,
    setScale,
    setScaling,
    levels: () => [...levels],
    scaling: () => scaling,
  };
}

/**
 * Exclusive display mode for the slice: image, contours, or both.
 *
 * Contours mode hides the textured plane entirely rather than fading it, so the
 * result is a clean line plot with nothing bleeding through from behind.
 * Switching modes touches only visibility — never the camera, the contour level
 * selection, or the slice index.
 */
export const SLICE_MODES = ["image", "contours", "both"];

export function wireSliceModes(
  sliceView,
  contourView,
  doc = globalThis.document,
  { signal } = {},
) {
  const buttons = new Map(
    SLICE_MODES.map((mode) => [mode, doc.getElementById(`mode-${mode}`)]),
  );

  let mode =
    SLICE_MODES.find(
      (m) => buttons.get(m)?.getAttribute("aria-pressed") === "true",
    ) ?? "both";

  function apply() {
    for (const [name, button] of buttons) {
      const on = name === mode;
      button?.setAttribute("aria-pressed", String(on));
      button?.classList?.toggle("active", on);
    }
    if (sliceView) sliceView.mesh.visible = mode !== "contours";
    if (contourView) contourView.group.visible = mode !== "image";
  }

  for (const [name, button] of buttons) {
    // `signal` lets a caller that re-wires on every rebuild drop the previous
    // set of listeners; without it each rebuild leaves closures holding a
    // disposed sliceView alive.
    button?.addEventListener("click", () => {
      mode = name;
      apply();
    }, signal ? { signal } : undefined);
  }

  apply();
  return { getMode: () => mode, apply };
}

/** Contour levels are no longer user-adjustable; the count is fixed here. */
export const CONTOUR_LEVEL_COUNT = 200;

/**
 * Decades of log range an unsigned field opens on.
 *
 * 12 reaches the 1e-12 physics floor: below that the weighting values are
 * relaxation-solver residue rather than field (README "A caveat on the deep
 * tail"). Opening on the full ~39.5-decade span instead would spend most of
 * the fixed CONTOUR_LEVEL_COUNT levels on that noise and thin out the
 * meaningful range fivefold. The slider still reaches 40 for anyone who wants
 * to look at the residue tail.
 */
export const PHYSICS_FLOOR_DECADES = 12;

/**
 * Wire the colour-scale and decades controls.
 *
 * `onLevels(levels)` is called with a fresh level set whenever the spacing
 * changes; `onScale(opts)` whenever the image scaling changes. A status line
 * reports the segment count and elapsed time so the cost of a rebuild is
 * visible rather than mysterious.
 */
export function wireScaleControls(meta, handlers = {}, doc = globalThis.document) {
  const signed = meta.vmin < 0;
  const buttons = {
    linear: doc.getElementById("scale-linear"),
    log: doc.getElementById("scale-log"),
  };
  const decadesRow = doc.getElementById("decades-row");
  const decadesInput = doc.getElementById("log-decades");
  const decadesLabel = doc.getElementById("log-decades-label");
  const status = doc.getElementById("contour-status");

  // Log is meaningless on signed data and Step 13.2 throws on it, so the drift
  // field gets the option disabled rather than a crash.
  if (signed && buttons.log) {
    buttons.log.disabled = true;
    buttons.log.title =
      "log scaling needs non-negative values (drift potential is -9500..0 V)";
  }

  // Weighting defaults to log — a linear ramp hides everything past the pad.
  let scale = signed ? "linear" : "log";

  // At the markup's 8 the log floor is vmax*1e-8, so contourLevels places
  // nothing in the near-cathode region and Contours goes blank there while
  // Image still paints it. Open unsigned fields at the physics floor instead,
  // and push the value back into the slider so the control agrees with what is
  // drawn.
  let decades = signed
    ? Number(decadesInput?.value ?? 8)
    : PHYSICS_FLOOR_DECADES;
  if (!signed && decadesInput) decadesInput.value = String(decades);

  const opts = () => ({ scale, decades });

  function paintButtons() {
    for (const [name, button] of Object.entries(buttons)) {
      const on = name === scale;
      button?.setAttribute("aria-pressed", String(on));
      button?.classList?.toggle("active", on);
    }
    if (decadesRow) decadesRow.hidden = scale !== "log";
    if (decadesLabel) {
      decadesLabel.textContent = `${decades} (floor ${Math.pow(10, -decades).toExponential(1)} x max)`;
    }
  }

  function emitLevels() {
    const count = CONTOUR_LEVEL_COUNT;
    if (status) status.textContent = "computing...";

    const started = Date.now();
    const levels = contourLevels(meta, count, opts());
    const segments = handlers.onLevels?.(levels) ?? 0;
    const elapsed = Date.now() - started;

    const note = `${count} levels, ${segments} segments, ${elapsed} ms`;
    if (status) status.textContent = note;
    console.log(`contours: ${note}`);
  }

  function emitScale() {
    paintButtons();
    handlers.onScale?.(opts());
    emitLevels(); // level placement follows the spacing
  }

  for (const [name, button] of Object.entries(buttons)) {
    button?.addEventListener("click", () => {
      if (button.disabled) return;
      scale = name;
      emitScale();
    });
  }

  decadesInput?.addEventListener("input", () => {
    decades = Number(decadesInput.value);
    paintButtons(); // label tracks the drag
  });
  decadesInput?.addEventListener("change", emitScale);

  paintButtons();
  return { getScale: opts, refresh: emitScale, refreshLevels: emitLevels };
}
