// The interactive potential slice: a single textured plane through the volume.
//
// The pure maths lives in potential_build.js; this module owns the fetch, the
// three.js objects, and the DOM wiring.

import * as THREE from "three";
import { contourSegments } from "./contour_build.js";
import {
  extractSlice,
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
export async function fetchPotential(base = "data") {
  const metaResponse = await fetch(`${base}/potential.json`);
  if (!metaResponse.ok) {
    throw new Error(`${base}/potential.json: HTTP ${metaResponse.status}`);
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
  const origin = meta.origin ?? [0, 0, 0];
  const zstride = meta.zstride ?? 1;
  return {
    value: volume[(i * meta.shape[1] + j) * meta.shape[2] + k],
    mm: [origin[0] + i * sx, origin[1] + j * sy, origin[2] + k * zstride * sz],
  };
}

/** Draw the vertical colorbar and its hover tick. */
export function createColorbar(meta, doc = globalThis.document) {
  const canvas = doc.getElementById("colorbar");
  const ctx = canvas?.getContext("2d");
  const { width, height } = canvas ?? { width: 0, height: 0 };

  const maxLabel = doc.getElementById("colorbar-max");
  const minLabel = doc.getElementById("colorbar-min");
  if (maxLabel) maxLabel.textContent = `${meta.vmax.toFixed(0)} V`;
  if (minLabel) minLabel.textContent = `${meta.vmin.toFixed(0)} V`;

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
export function wireSliceControls(view, doc = globalThis.document) {
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
 * Build one translucent mesh per equipotential level, plus its checkbox.
 *
 * Surface colours come from the shared ramp, so a sheet's colour matches its
 * position on the colorbar. Skipped levels are stated rather than dropped
 * silently.
 */
export function buildIsoSurfaces(meta, group, panel, doc = globalThis.document) {
  const meshes = [];

  for (const surface of meta.isosurfaces ?? []) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(surface.positions), 3),
    );
    geometry.setIndex(surface.indices);
    geometry.computeVertexNormals();

    const [r, g, b] = rampRGB(rampPosition(surface.level, meta.vmin, meta.vmax));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(`rgb(${r},${g},${b})`),
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = `iso ${surface.level} V`;
    group.add(mesh);
    meshes.push(mesh);

    if (!panel) continue;
    const label = doc.createElement("label");
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => { mesh.visible = box.checked; });
    label.append(box, ` ${surface.level} V (${surface.n_tris} tris)`);
    panel.append(label);
  }

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
  if (meta.units !== "V") return [...WEIGHT_CONTOUR_LEVELS];

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
export function createContourView(meta, volume, sceneRoot, doc = document) {
  const group = new THREE.Group();
  group.name = "contourGroup";
  group.visible = false;
  sceneRoot.add(group);

  const levelsPanel = doc.getElementById("contour-levels");
  const legend = doc.getElementById("contour-legend");

  let levels = defaultContourLevels(meta);
  const enabled = new Map(levels.map((level) => [level, true]));
  const objects = new Map();

  const unit = meta.units === "V" ? " V" : "";
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

    // Offset along the normal by a fraction of a voxel: enough to clear the
    // texture, too little to read as a gap.
    const [sx, sy, sz] = meta.spacing;
    const nudge =
      0.02 * (axis === "x" ? sx : axis === "y" ? sy : sz * (meta.zstride ?? 1));
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
