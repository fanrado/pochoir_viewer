// Tests for web/potential_view.js — slice mesh, colorbar, controls, isosurfaces.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  axisExtent,
  buildIsoSurfaces,
  createColorbar,
  createSliceView,
  fetchPotential,
  uvToVoxel,
  voxelReading,
  wireSliceControls,
} from "../../web/potential_view.js";
import { rampPosition, rampRGB } from "../../web/potential_build.js";

const SHAPE = [4, 5, 6];

function indexVolume(shape = SHAPE) {
  const [ni, nj, nk] = shape;
  const volume = new Float32Array(ni * nj * nk);
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++)
      for (let k = 0; k < nk; k++) volume[(i * nj + j) * nk + k] = i * 100 + j * 10 + k;
  return volume;
}

const meta = (over = {}) => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: -8000,
  vmax: 0,
  bin: "potential.bin",
  bytes: 4 * 5 * 6 * 4,
  isosurfaces: [],
  skipped_levels: [],
  ...over,
});

const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- fetchPotential ---------------------------------------------------------

function stubFetch(routes) {
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [suffix, response] of Object.entries(routes)) {
      if (String(url).endsWith(suffix)) return response;
    }
    return { ok: false, status: 404 };
  };
  return { restore() { if (prior === undefined) delete globalThis.fetch; else globalThis.fetch = prior; } };
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const okBytes = (buffer) => ({ ok: true, status: 200, arrayBuffer: async () => buffer });

test("fetchPotential returns meta and a Float32Array volume", async () => {
  const m = meta();
  const buffer = indexVolume().buffer;
  const stub = stubFetch({ "potential.json": okJson(m), "potential.bin": okBytes(buffer) });

  try {
    const { meta: got, volume } = await fetchPotential();

    assert.deepEqual(got.shape, SHAPE);
    assert.ok(volume instanceof Float32Array);
    assert.equal(volume.length, 120);
  } finally {
    stub.restore();
  }
});

test("fetchPotential honours the base path", async () => {
  const seen = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return String(url).endsWith(".json")
      ? okJson(meta())
      : okBytes(indexVolume().buffer);
  };

  try {
    await fetchPotential("assets");
    assert.ok(seen.every((u) => u.startsWith("assets/")), seen.join(", "));
  } finally {
    globalThis.fetch = prior;
  }
});

test("fetchPotential reports a missing metadata file with its status", async () => {
  const stub = stubFetch({});
  try {
    await assert.rejects(() => fetchPotential(), /potential\.json: HTTP 404/);
  } finally {
    stub.restore();
  }
});

test("fetchPotential reports a missing binary", async () => {
  const stub = stubFetch({ "potential.json": okJson(meta()) });
  try {
    await assert.rejects(() => fetchPotential(), /potential\.bin: HTTP 404/);
  } finally {
    stub.restore();
  }
});

test("fetchPotential rejects a binary whose length disagrees with the metadata", async () => {
  // A stale potential.bin against a fresh potential.json would otherwise be
  // read as garbage voxels rather than failing.
  const stub = stubFetch({
    "potential.json": okJson(meta({ bytes: 999999 })),
    "potential.bin": okBytes(indexVolume().buffer),
  });

  try {
    await assert.rejects(() => fetchPotential(), /expected 999999/);
  } finally {
    stub.restore();
  }
});

test("the length-mismatch error tells the user how to fix it", async () => {
  const stub = stubFetch({
    "potential.json": okJson(meta({ bytes: 8 })),
    "potential.bin": okBytes(indexVolume().buffer),
  });

  try {
    await assert.rejects(() => fetchPotential(), /export-potential/);
  } finally {
    stub.restore();
  }
});

test("fetchPotential reads the binary name from the metadata", async () => {
  const seen = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return String(url).endsWith(".json")
      ? okJson(meta({ bin: "volume.raw" }))
      : okBytes(indexVolume().buffer);
  };

  try {
    await fetchPotential();
    assert.ok(seen.some((u) => u.endsWith("volume.raw")), seen.join(", "));
  } finally {
    globalThis.fetch = prior;
  }
});

// --- axisExtent -------------------------------------------------------------

test("axisExtent maps each axis to its dimension", () => {
  assert.equal(axisExtent(meta(), "x"), 4);
  assert.equal(axisExtent(meta(), "y"), 5);
  assert.equal(axisExtent(meta(), "z"), 6);
});

// --- createSliceView --------------------------------------------------------

function sliceRig(over = {}) {
  const sceneRoot = new THREE.Group();
  const view = createSliceView(meta(over), indexVolume(), sceneRoot);
  return { view, sceneRoot };
}

test("the slice mesh joins sceneRoot so z-compression scales it too", () => {
  const { view, sceneRoot } = sliceRig();

  assert.ok(sceneRoot.children.includes(view.mesh));
  assert.equal(view.mesh.name, "potentialSlice");
});

test("the slice starts hidden", () => {
  assert.equal(sliceRig().view.mesh.visible, false);
});

test("the slice material is double-sided and does not write depth", () => {
  // It must be readable from both sides and through the translucent boundary.
  const { view } = sliceRig();

  assert.equal(view.mesh.material.side, THREE.DoubleSide);
  assert.equal(view.mesh.material.depthWrite, false);
});

test("updateSlice builds a texture with the slice dimensions", () => {
  const { view } = sliceRig();

  view.updateSlice("z", 2);

  assert.equal(view.texture.image.width, 4);
  assert.equal(view.texture.image.height, 5);
});

test("the texture uses nearest filtering so voxels stay honest", () => {
  const { view } = sliceRig();

  view.updateSlice("z", 2);

  assert.equal(view.texture.minFilter, THREE.NearestFilter);
  assert.equal(view.texture.magFilter, THREE.NearestFilter);
});

test("updateSlice transposes into row-major order for the DataTexture", () => {
  // extractSlice walks the width axis first; a DataTexture wants whole rows.
  // Getting this wrong yields a transposed but plausible image.
  const { view } = sliceRig();

  view.updateSlice("z", 0);
  const data = view.texture.image.data;

  // Voxel (i=3, j=0, k=0) has value 300; in row-major it sits at row 0, col 3.
  const at = (row, col) => data.slice((row * 4 + col) * 4, (row * 4 + col) * 4 + 3);
  const expected = rampRGB(rampPosition(300, -8000, 0));
  assert.deepEqual([...at(0, 3)], expected);
});

test("the same-size path reuses the texture buffer", () => {
  const { view } = sliceRig();

  view.updateSlice("z", 0);
  const first = view.texture;
  view.updateSlice("z", 3);

  assert.equal(view.texture, first, "texture was recreated for identical dimensions");
});

test("changing axis rebuilds the texture at the new dimensions", () => {
  const { view } = sliceRig();

  view.updateSlice("z", 0);
  const first = view.texture;
  view.updateSlice("x", 0);

  assert.notEqual(view.texture, first);
  assert.equal(view.texture.image.width, 5); // (j, k)
  assert.equal(view.texture.image.height, 6);
});

test("updateSlice positions, scales and rotates the plane", () => {
  const { view } = sliceRig();

  const plane = view.updateSlice("x", 1);

  assert.ok(close(view.mesh.scale.x, plane.width));
  assert.ok(close(view.mesh.position.x, plane.center[0]));
  assert.ok(close(view.mesh.rotation.y, Math.PI / 2));
});

test("updateSlice returns the plane parameters", () => {
  const { view } = sliceRig();

  const plane = view.updateSlice("z", 2);

  assert.deepEqual(Object.keys(plane).sort(), ["center", "height", "rotation", "width"]);
});

test("updateSlice rejects an out-of-range index", () => {
  const { view } = sliceRig();

  assert.throws(() => view.updateSlice("z", 99), /out of range/);
});

// --- uvToVoxel --------------------------------------------------------------

test("uvToVoxel pins the sliced axis to the slice index", () => {
  assert.equal(uvToVoxel(0.5, 0.5, "z", 4, meta())[2], 4);
  assert.equal(uvToVoxel(0.5, 0.5, "x", 3, meta())[0], 3);
  assert.equal(uvToVoxel(0.5, 0.5, "y", 2, meta())[1], 2);
});

test("uvToVoxel maps uv 0 to the first voxel", () => {
  assert.deepEqual(uvToVoxel(0, 0, "z", 0, meta()), [0, 0, 0]);
});

test("uvToVoxel maps uv 1 to the last voxel, not past it", () => {
  // floor(1 * ni) would be ni; the clamp is what keeps it in range.
  assert.deepEqual(uvToVoxel(1, 1, "z", 0, meta()), [3, 4, 0]);
});

test("uvToVoxel clamps values outside the unit square", () => {
  assert.deepEqual(uvToVoxel(-5, 9, "z", 0, meta()), [0, 4, 0]);
});

test("uvToVoxel uses the axes each slice spans", () => {
  assert.deepEqual(uvToVoxel(0.99, 0.99, "x", 1, meta()), [1, 4, 5]); // (j, k)
  assert.deepEqual(uvToVoxel(0.99, 0.99, "y", 1, meta()), [3, 1, 5]); // (i, k)
});

// --- voxelReading -----------------------------------------------------------

test("voxelReading reads the value at the C-order index", () => {
  const volume = indexVolume();

  assert.equal(voxelReading(volume, meta(), 2, 3, 4).value, 234);
});

test("voxelReading reports true mm", () => {
  const reading = voxelReading(indexVolume(), meta(), 1, 2, 3);

  assert.ok(close(reading.mm[0], 0.1));
  assert.ok(close(reading.mm[1], 0.2));
  assert.ok(close(reading.mm[2], 0.30000000000000004) || close(reading.mm[2], 0.3));
});

test("voxelReading carries the zstride into z, ignoring any display scaling", () => {
  // The compression must never enter this arithmetic.
  const reading = voxelReading(indexVolume(), meta({ zstride: 4 }), 0, 0, 3);

  assert.ok(close(reading.mm[2], 1.2));
});

test("voxelReading honours the origin", () => {
  const reading = voxelReading(indexVolume(), meta({ origin: [1, 2, 3] }), 0, 0, 0);

  assert.deepEqual(reading.mm, [1, 2, 3]);
});

test("voxelReading defaults a missing origin and zstride", () => {
  const bare = { shape: SHAPE, spacing: [1, 1, 1] };

  assert.deepEqual(voxelReading(indexVolume(), bare, 1, 1, 1).mm, [1, 1, 1]);
});

// --- DOM stubs --------------------------------------------------------------

function fakeCanvas(width = 16, height = 160) {
  const calls = { fillRect: [], fillStyle: [], paths: 0 };
  return {
    width,
    height,
    getContext: () => ({
      set fillStyle(v) { calls.fillStyle.push(v); },
      get fillStyle() { return calls.fillStyle.at(-1); },
      strokeStyle: "",
      fillRect: (...a) => calls.fillRect.push(a),
      beginPath: () => { calls.paths += 1; },
      moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    }),
    calls,
  };
}

function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    className: "",
    children: [],
    handlers: {},
    checked: false,
    value: "0",
    max: "0",
    type: "",
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); },
    fire(type) { for (const fn of this.handlers[type] ?? []) fn(); },
    append(...kids) { this.children.push(...kids); },
  };
}

function fakeDoc(elements = {}) {
  const created = [];
  return {
    elements,
    created,
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => { const el = fakeElement(tag); created.push(el); return el; },
  };
}

// --- createColorbar ---------------------------------------------------------

test("the colorbar labels its endpoints in volts", () => {
  const doc = fakeDoc({
    colorbar: fakeCanvas(),
    "colorbar-max": fakeElement(),
    "colorbar-min": fakeElement(),
  });

  createColorbar(meta(), doc);

  assert.equal(doc.elements["colorbar-max"].textContent, "0 V");
  assert.equal(doc.elements["colorbar-min"].textContent, "-8000 V");
});

test("the colorbar paints one row per pixel of height", () => {
  const canvas = fakeCanvas(16, 160);
  const doc = fakeDoc({ colorbar: canvas });

  createColorbar(meta(), doc);

  assert.equal(canvas.calls.fillRect.length, 160);
});

test("the colorbar runs vmax at the top and vmin at the bottom", () => {
  const canvas = fakeCanvas(16, 160);
  const doc = fakeDoc({ colorbar: canvas });

  createColorbar(meta(), doc);

  const first = canvas.calls.fillStyle[0];
  const last = canvas.calls.fillStyle[159];
  assert.equal(first, "rgb(252,240,76)"); // yellow = vmax
  assert.equal(last, "rgb(12,24,92)"); // dark blue = vmin
});

test("setTick draws a marker without repainting a different ramp", () => {
  const canvas = fakeCanvas(16, 160);
  const doc = fakeDoc({ colorbar: canvas });

  const bar = createColorbar(meta(), doc);
  const before = canvas.calls.paths;
  bar.setTick(-4000);

  assert.ok(canvas.calls.paths > before, "no tick path was drawn");
});

test("the colorbar survives a missing canvas", () => {
  // The potential panel is hidden until the payload loads.
  assert.doesNotThrow(() => createColorbar(meta(), fakeDoc()));
});

test("the colorbar survives missing endpoint labels", () => {
  assert.doesNotThrow(() => createColorbar(meta(), fakeDoc({ colorbar: fakeCanvas() })));
});

// --- wireSliceControls ------------------------------------------------------

function controlsRig(over = {}) {
  const sceneRoot = new THREE.Group();
  const view = createSliceView(meta(over), indexVolume(), sceneRoot);

  const slider = fakeElement("input");
  const label = fakeElement("span");
  const radios = { "axis-x": fakeElement("input"), "axis-y": fakeElement("input"), "axis-z": fakeElement("input") };
  radios["axis-z"].checked = true;

  const doc = fakeDoc({ "slice-idx": slider, "slice-label": label, ...radios });
  const controls = wireSliceControls(view, doc);

  return { view, controls, slider, label, radios };
}

test("controls open on the middle of the starting axis", () => {
  const { slider } = controlsRig();

  assert.equal(slider.max, "5"); // z extent 6 -> max index 5
  assert.equal(slider.value, "2"); // floor(5 / 2)
});

test("controls default to the checked radio's axis", () => {
  assert.equal(controlsRig().controls.getAxis(), "z");
});

test("the label is rendered at startup", () => {
  const { label } = controlsRig();

  assert.match(label.textContent, /^z = /);
});

test("moving the slider re-renders the slice and the label", () => {
  const { slider, label, view } = controlsRig();

  slider.value = "4";
  slider.fire("input");

  assert.match(label.textContent, /index 4/);
  assert.equal(view.texture.image.width, 4);
});

test("switching axis rebuilds the slider range", () => {
  const { radios, slider, controls } = controlsRig();

  radios["axis-x"].checked = true;
  radios["axis-x"].fire("change");

  assert.equal(controls.getAxis(), "x");
  assert.equal(slider.max, "3"); // x extent 4 -> max index 3
});

test("a stale index is clamped when the new axis is shorter", () => {
  // z has 6 samples, x only 4: index 5 must not survive the switch.
  const { radios, slider } = controlsRig();

  slider.value = "5";
  slider.fire("input");
  radios["axis-x"].checked = true;
  radios["axis-x"].fire("change");

  assert.equal(slider.value, "3");
  assert.ok(Number(slider.value) <= Number(slider.max));
});

test("an index within the new range is preserved", () => {
  const { radios, slider } = controlsRig();

  slider.value = "1";
  slider.fire("input");
  radios["axis-y"].checked = true;
  radios["axis-y"].fire("change");

  assert.equal(slider.value, "1");
});

test("an unchecked radio's change event is ignored", () => {
  const { radios, controls } = controlsRig();

  radios["axis-x"].checked = false;
  radios["axis-x"].fire("change");

  assert.equal(controls.getAxis(), "z");
});

test("setAxis is callable directly", () => {
  const { controls, slider } = controlsRig();

  controls.setAxis("y");

  assert.equal(controls.getAxis(), "y");
  assert.equal(slider.max, "4");
});

// --- buildIsoSurfaces -------------------------------------------------------

const SURFACES = [
  { level: -2000, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], n_tris: 1 },
  { level: -6000, positions: [0, 0, 1, 1, 0, 1, 0, 1, 1], indices: [0, 1, 2], n_tris: 1 },
];

test("one mesh per isosurface, added to the group", () => {
  const group = new THREE.Group();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.equal(meshes.length, 2);
  assert.equal(group.children.length, 2);
});

test("meshes are named with their level", () => {
  const group = new THREE.Group();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.equal(meshes[0].name, "iso -2000 V");
});

test("surface colour comes from the shared ramp position", () => {
  // A sheet's colour must match its place on the colorbar.
  const group = new THREE.Group();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  const [r, g, b] = rampRGB(rampPosition(-2000, -8000, 0));
  assert.equal(meshes[0].material.color.getHex(), new THREE.Color(`rgb(${r},${g},${b})`).getHex());
});

test("deeper levels get a different colour", () => {
  const group = new THREE.Group();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.notEqual(meshes[0].material.color.getHex(), meshes[1].material.color.getHex());
});

test("surfaces are translucent and double-sided", () => {
  const group = new THREE.Group();

  const [mesh] = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.3);
  assert.equal(mesh.material.side, THREE.DoubleSide);
});

test("geometry carries the positions and indices", () => {
  const group = new THREE.Group();

  const [mesh] = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.equal(mesh.geometry.getAttribute("position").count, 3);
  assert.deepEqual([...mesh.geometry.getIndex().array], [0, 1, 2]);
});

test("vertex normals are computed so the sheets are lit", () => {
  const group = new THREE.Group();

  const [mesh] = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.ok(mesh.geometry.getAttribute("normal"));
});

test("a checkbox per level toggles its mesh", () => {
  const group = new THREE.Group();
  const panel = fakeElement();
  const doc = fakeDoc();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, panel, doc);
  const box = doc.created.find((el) => el.type === "checkbox");
  box.checked = false;
  box.fire("change");

  assert.equal(meshes[0].visible, false);
});

test("checkboxes start checked", () => {
  const doc = fakeDoc();

  buildIsoSurfaces(meta({ isosurfaces: SURFACES }), new THREE.Group(), fakeElement(), doc);

  assert.ok(doc.created.filter((el) => el.type === "checkbox").every((el) => el.checked));
});

test("skipped levels are stated rather than dropped silently", () => {
  const panel = fakeElement();
  const doc = fakeDoc();

  buildIsoSurfaces(
    meta({ isosurfaces: SURFACES, skipped_levels: [-8000] }),
    new THREE.Group(),
    panel,
    doc,
  );

  const note = doc.created.find((el) => el.className === "iso-skipped");
  assert.ok(note, "no skipped-levels note was added");
  assert.match(note.textContent, /-8000 V/);
});

test("no note is added when nothing was skipped", () => {
  const doc = fakeDoc();

  buildIsoSurfaces(meta({ isosurfaces: SURFACES }), new THREE.Group(), fakeElement(), doc);

  assert.equal(doc.created.find((el) => el.className === "iso-skipped"), undefined);
});

test("a missing panel still builds the meshes", () => {
  const group = new THREE.Group();

  const meshes = buildIsoSurfaces(meta({ isosurfaces: SURFACES }), group, null, fakeDoc());

  assert.equal(meshes.length, 2);
});

test("absent isosurfaces are treated as none", () => {
  const bare = { shape: SHAPE, spacing: [1, 1, 1], vmin: -1, vmax: 0 };

  assert.deepEqual(buildIsoSurfaces(bare, new THREE.Group(), null, fakeDoc()), []);
});

// --- per-field payload names and units --------------------------------------

test("fetchPotential defaults to the drift payload name", async () => {
  const seen = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return String(url).endsWith(".json") ? okJson(meta()) : okBytes(indexVolume().buffer);
  };

  try {
    await fetchPotential();
    assert.ok(seen[0].endsWith("data/potential.json"), seen[0]);
  } finally {
    globalThis.fetch = prior;
  }
});

test("fetchPotential accepts a per-field payload name", async () => {
  // write_potential names non-drift payloads potential_<field>.json.
  const seen = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return String(url).endsWith(".json")
      ? okJson(meta({ bin: "potential_weight.bin", units: "dimensionless" }))
      : okBytes(indexVolume().buffer);
  };

  try {
    const { meta: got } = await fetchPotential("data", "potential_weight.json");
    assert.ok(seen[0].endsWith("data/potential_weight.json"), seen[0]);
    assert.ok(seen[1].endsWith("potential_weight.bin"), seen[1]);
    assert.equal(got.units, "dimensionless");
  } finally {
    globalThis.fetch = prior;
  }
});

test("a missing per-field payload names that file in the error", async () => {
  const stub = stubFetch({});
  try {
    await assert.rejects(
      () => fetchPotential("data", "potential_weight.json"),
      /potential_weight\.json: HTTP 404/,
    );
  } finally {
    stub.restore();
  }
});

test("the colorbar drops the volt unit for a dimensionless field", () => {
  const doc = fakeDoc({
    colorbar: fakeCanvas(),
    "colorbar-max": fakeElement(),
    "colorbar-min": fakeElement(),
  });

  createColorbar(meta({ units: "dimensionless", vmin: 0, vmax: 1 }), doc);

  assert.ok(!doc.elements["colorbar-max"].textContent.includes("V"));
  assert.equal(doc.elements["colorbar-max"].textContent, "1");
});

test("the colorbar keeps volts when units are absent", () => {
  // Phase 8 payloads have no units key and were always volts.
  const doc = fakeDoc({
    colorbar: fakeCanvas(),
    "colorbar-max": fakeElement(),
    "colorbar-min": fakeElement(),
  });
  const bare = { ...meta() };
  delete bare.units;

  createColorbar(bare, doc);

  assert.equal(doc.elements["colorbar-max"].textContent, "0 V");
  assert.equal(doc.elements["colorbar-min"].textContent, "-8000 V");
});

test("a dimensionless colorbar does not round its labels to integers", () => {
  // 0.05 must not print as "0".
  const doc = fakeDoc({
    colorbar: fakeCanvas(),
    "colorbar-max": fakeElement(),
    "colorbar-min": fakeElement(),
  });

  createColorbar(meta({ units: "dimensionless", vmin: 0.05, vmax: 0.95 }), doc);

  assert.equal(doc.elements["colorbar-min"].textContent, "0.05");
});
