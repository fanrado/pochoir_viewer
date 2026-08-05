// The interactive potential slice: a single textured plane through the volume.
//
// The pure maths lives in potential_build.js; this module owns the fetch, the
// three.js objects, and the DOM wiring.

import * as THREE from "three";
import { contourSegments } from "./contour_build.js";
import {
  extractSlice,
  metaStride,
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

  function updateSlice(axis, index) {
    const { width, height, values } = extractSlice(volume, meta.shape, axis, index);

    // extractSlice runs along the plane's width axis first; a DataTexture wants
    // whole rows, so transpose into row-major (b * width + a) order.
    const rowMajor = new Float32Array(values.length);
    for (let a = 0; a < width; a++) {
      for (let b = 0; b < height; b++) {
        rowMajor[b * width + a] = values[a * height + b];
      }
    }
    const rgba = valuesToRGBA(rowMajor, meta.vmin, meta.vmax);

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

  return { mesh, updateSlice, meta, get texture() { return texture; } };
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

/** Draw the vertical colorbar and its hover tick. */
export function createColorbar(meta, doc = globalThis.document) {
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

  // One ramp sample per row, top = vmax, via the same mapping as the plane.
  const column = new Float32Array(height);
  for (let row = 0; row < height; row++) {
    column[row] = meta.vmax - ((meta.vmax - meta.vmin) * row) / (height - 1);
  }
  const rgba = valuesToRGBA(column, meta.vmin, meta.vmax);

  function draw(hovered = null) {
    if (!ctx) return;
    for (let row = 0; row < height; row++) {
      const [r, g, b] = rgba.slice(row * 4, row * 4 + 3);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, row, width, 1);
    }
    if (hovered === null) return;

    // Triangular tick at the hovered value's position.
    const t = rampPosition(hovered, meta.vmin, meta.vmax);
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

  draw();
  return { draw, setTick: draw };
}

/**
 * Wire the axis radios and the slice slider to `view`.
 *
 * On axis change the slider range is rebuilt from the volume shape and the
 * current index clamped, so a tall z range cannot leave a stale index behind.
 */
export function wireSliceControls(view, doc = globalThis.document, onRender = null) {
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
 * Bright, saturated hues for the isosurface shells, innermost level first.
 *
 * DELIBERATE REVERSAL of Step 8.13, which tied shell colour to the colorbar
 * ramp: low weighting values sit at the dark end of that ramp, which made every
 * outer shell muddy and the shells indistinguishable. The colorbar still
 * governs THE SLICE IMAGE; only these shells use the fixed palette, and the
 * per-level swatches keep the mapping legible.
 *
 * Indexed by level order. If more levels are requested than there are hues the
 * palette wraps, so two shells can repeat a colour rather than one going black.
 */
export const ISO_PALETTE = [
  0xff40d0, // magenta  — innermost / highest level
  0xff9020, // orange
  0xffe020, // yellow
  0x40e040, // green
  0x30e0e0, // cyan
  0x4070ff, // blue
  0xa050ff, // violet   — outermost / lowest level
];

/** Opacity at and above which a shell is drawn as a solid, depth-writing mesh. */
const OPAQUE_AT = 0.98;

/**
 * The shells the opacity slider currently drives.
 *
 * Held at module scope, and the slider handler is attached once, so a field
 * switch that rebuilds every mesh does not leave the slider updating discarded
 * materials or stack a second handler on the element.
 */
let activeIsoMeshes = [];
let isoOpacityWired = false;

function wireIsoOpacity(meshes, doc, fallback) {
  activeIsoMeshes = meshes;

  const slider = doc.getElementById("iso-opacity");
  const label = doc.getElementById("iso-opacity-label");

  const apply = (value) => {
    for (const mesh of activeIsoMeshes) applyIsoOpacity(mesh.material, value);
    if (label) label.textContent = `opacity ${Math.round(value * 100)}%`;
  };

  if (!slider) {
    apply(fallback);
    return;
  }
  if (!isoOpacityWired) {
    slider.addEventListener("input", () => apply(Number(slider.value)));
    isoOpacityWired = true;
  }
  apply(Number(slider.value)); // adopt the live value, not the default
}

/**
 * Apply `opacity` to a shell material, flipping blend flags at the top end.
 *
 * A fully opaque mesh left in transparent blending mode sorts wrongly and shows
 * artefacts, so at the top of the slider it becomes a genuine solid.
 */
export function applyIsoOpacity(material, opacity) {
  material.opacity = opacity;
  const solid = opacity >= OPAQUE_AT;
  material.transparent = !solid;
  material.depthWrite = solid;
  material.needsUpdate = true;
}

/**
 * Build one mesh per equipotential level, plus its checkbox.
 *
 * Shells are ordered back to front via renderOrder — outermost first — because
 * several of them interleave with the pad plane at 10.0 mm and the grid plane at
 * 13.1 mm, and unordered transparent draws blend incorrectly there.
 *
 * Skipped levels are stated rather than dropped silently.
 */
export function buildIsoSurfaces(
  meta,
  group,
  panel,
  doc = globalThis.document,
  opacity = 0.35,
) {
  const meshes = [];
  const surfaces = meta.isosurfaces ?? [];

  // Highest level = innermost shell = first palette entry.
  const byLevelDescending = [...surfaces]
    .map((s, index) => ({ s, index }))
    .sort((a, b) => b.s.level - a.s.level);
  const paletteOf = new Map(
    byLevelDescending.map(({ index }, rank) => [
      index,
      ISO_PALETTE[rank % ISO_PALETTE.length],
    ]),
  );
  const rankOf = new Map(byLevelDescending.map(({ index }, rank) => [index, rank]));

  for (const [index, surface] of surfaces.entries()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(surface.positions), 3),
    );
    geometry.setIndex(surface.indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(paletteOf.get(index)),
      side: THREE.DoubleSide,
    });
    applyIsoOpacity(material, opacity);

    const mesh = new THREE.Mesh(geometry, material);
    // Units follow the field, so a weighting shell is not labelled in volts.
    mesh.name = `iso ${surface.level}${(meta.units ?? "V") === "V" ? " V" : ""}`;
    // Outermost shell (highest rank) draws first.
    // Lower renderOrder draws first, so the outermost shell leads.
    mesh.renderOrder = -rankOf.get(index) || 0;
    group.add(mesh);
    meshes.push(mesh);

    if (!panel) continue;
    const label = doc.createElement("label");
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => { mesh.visible = box.checked; });
    label.append(
      box,
      ` ${surface.level}${(meta.units ?? "V") === "V" ? " V" : ""}` +
        ` (${surface.n_tris} tris)`,
    );
    panel.append(label);
  }

  // The slider owns the live value; rebuilt meshes adopt whatever it currently
  // says, so the user's choice survives slice, axis and field changes.
  wireIsoOpacity(meshes, doc, opacity);

  const skipped = meta.skipped_levels ?? [];
  if (skipped.length > 0 && panel) {
    const note = doc.createElement("div");
    note.className = "iso-skipped";
    note.textContent = `skipped (out of range): ${skipped.map((v) => `${v} V`).join(", ")}`;
    panel.append(note);
  }

  return meshes;
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

/**
 * Draw contour lines over the slice plane.
 *
 * Contours are placed with the SAME slicePlaneParams as the textured plane, so
 * the lines cannot drift away from the colour bands they trace. Each level is
 * nudged along the plane normal by a fraction of a voxel to stop it z-fighting
 * with the texture.
 */
export function createContourView(meta, volume, sceneRoot, doc = globalThis.document) {
  const group = new THREE.Group();
  group.name = "contourGroup";
  group.visible = false;
  sceneRoot.add(group);

  const levelsPanel = doc.getElementById("contour-levels");
  const legend = doc.getElementById("contour-legend");

  let levels = defaultContourLevels(meta);
  const enabled = new Map(levels.map((level) => [level, true]));
  const objects = new Map();

  const unit = (meta.units ?? "V") === "V" ? " V" : "";
  const label = (level) => `${level}${unit}`;

  function colorFor(level) {
    const [r, g, b] = rampRGB(rampPosition(level, meta.vmin, meta.vmax));
    return new THREE.Color(`rgb(${r},${g},${b})`);
  }

  // One checkbox per level, plus a legend row naming value and unit.
  for (const level of levels) {
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: colorFor(level) }),
    );
    lines.name = `contour ${label(level)}`;
    group.add(lines);
    objects.set(level, lines);

    if (levelsPanel) {
      const row = doc.createElement("label");
      const box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.addEventListener("change", () => {
        enabled.set(level, box.checked);
        lines.visible = box.checked;
      });
      row.append(box, ` ${label(level)}`);
      levelsPanel.append(row);
    }

    if (legend) {
      const row = doc.createElement("div");
      const swatch = doc.createElement("span");
      swatch.className = "contour-swatch";
      swatch.style.background = `#${colorFor(level).getHexString()}`;
      row.append(swatch, ` ${label(level)}`);
      legend.append(row);
    }
  }

  /** Rebuild every enabled level for the given slice. */
  function update(axis, index) {
    const slice = extractSlice(volume, meta.shape, axis, index);
    const plane = slicePlaneParams(axis, index, meta);

    // Offset along the normal by a fraction of ONE VOXEL: enough to clear the
    // texture, too little to read as a gap. A voxel is stride[k] * spacing[k] on
    // each axis, so the fraction stays consistent whatever the export strided.
    const [sx, sy, sz] = meta.spacing;
    const [tx, ty, tz] = metaStride(meta);
    const voxel = axis === "x" ? tx * sx : axis === "y" ? ty * sy : tz * sz;
    const nudge = 0.02 * voxel;
    const normal = new THREE.Vector3(
      axis === "x" ? 1 : 0,
      axis === "y" ? 1 : 0,
      axis === "z" ? 1 : 0,
    ).multiplyScalar(nudge);

    for (const [level, lines] of objects) {
      if (!enabled.get(level)) {
        lines.visible = false;
        continue;
      }
      const segments = contourSegments(slice.values, slice.width, slice.height, level);

      // UV -> plane-local -> world, using the plane's own transform.
      const positions = new Float32Array((segments.length / 2) * 3);
      for (let n = 0; n < segments.length; n += 2) {
        positions[(n / 2) * 3] = (segments[n] - 0.5) * plane.width;
        positions[(n / 2) * 3 + 1] = (segments[n + 1] - 0.5) * plane.height;
        positions[(n / 2) * 3 + 2] = 0;
      }

      // Dispose the old buffer so repeated slider drags do not leak.
      lines.geometry.dispose();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      lines.geometry = geometry;

      lines.position.set(...plane.center).add(normal);
      lines.rotation.set(...plane.rotation);
      lines.visible = true;
    }
  }

  // The group toggle lives here rather than in viewer.js so the contour layer
  // owns all of its own DOM.
  const toggle = doc.getElementById("layer-contours");
  toggle?.addEventListener("click", () => {
    const on = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.classList.toggle("active", on);
    group.visible = on;
  });

  return { group, update, levels: () => [...levels] };
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

export function wireSliceModes(sliceView, contourView, doc = globalThis.document) {
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
    button?.addEventListener("click", () => {
      mode = name;
      apply();
    });
  }

  apply();
  return { getMode: () => mode, apply };
}

/**
 * Fill the legend with the isosurface palette swatches.
 *
 * Step 11.2 broke the old legend by decoupling shell colour from the colorbar;
 * these swatches restore it, so a bright shell can still be read as a value.
 */
export function buildIsoLegend(meshes, doc = globalThis.document) {
  const legend = doc.getElementById("contour-legend");
  if (!legend) return;

  legend.replaceChildren?.();
  const heading = doc.createElement("div");
  heading.textContent = "isosurfaces";
  legend.append(heading);

  // Innermost (highest level) first, matching the palette order.
  const rows = [...meshes].sort(
    (a, b) => Number(b.name.split(" ")[1]) - Number(a.name.split(" ")[1]),
  );
  for (const mesh of rows) {
    const row = doc.createElement("div");
    const swatch = doc.createElement("span");
    swatch.className = "contour-swatch";
    // Taken from the rendered material, so the swatch cannot drift from the shell.
    swatch.style.background = `#${mesh.material.color.getHexString()}`;
    row.append(swatch, ` ${mesh.name.replace(/^iso /, "")}`);
    legend.append(row);
  }
}
