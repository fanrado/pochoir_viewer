// Tests for the contour overlay in web/potential_view.js.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  WEIGHT_CONTOUR_LEVELS,
  createContourView,
  createSliceView,
  defaultContourLevels,
} from "../../web/potential_view.js";
import { slicePlaneParams } from "../../web/potential_build.js";

const SHAPE = [5, 6, 7];

/**
 * A DIAGONAL ramp, varying along all three axes.
 *
 * A z-only ramp would make every z-slice constant, so no level is ever crossed
 * and the geometry assertions below would pass vacuously on an empty scene.
 */
function rampVolume(shape = SHAPE, vmin = -8000, vmax = 0) {
  const [ni, nj, nk] = shape;
  const volume = new Float32Array(ni * nj * nk);
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++)
      for (let k = 0; k < nk; k++) {
        const t = (i / (ni - 1) + j / (nj - 1) + k / (nk - 1)) / 3;
        volume[(i * nj + j) * nk + k] = vmin + (vmax - vmin) * t;
      }
  return volume;
}

const meta = (over = {}) => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: -8000,
  vmax: 0,
  units: "V",
  ...over,
});

function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    className: "",
    type: "",
    checked: false,
    style: {},
    children: [],
    handlers: {},
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
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

const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

/**
 * World-space vertices of a LineSegments.
 *
 * The geometry is PLANE-LOCAL and centred on the origin; the object's own
 * position and rotation place it. Reading the raw attribute would report every
 * contour sitting at z = 0.
 */
function worldVerts(lines) {
  const attr = lines.geometry.getAttribute("position");
  if (!attr || attr.count === 0) return [];
  lines.updateMatrixWorld(true);
  const out = [];
  for (let n = 0; n < attr.count; n++) {
    out.push(
      new THREE.Vector3(attr.getX(n), attr.getY(n), attr.getZ(n)).applyMatrix4(
        lines.matrixWorld,
      ),
    );
  }
  return out;
}

// --- defaultContourLevels ---------------------------------------------------

test("volt levels step through the data range", () => {
  const levels = defaultContourLevels(meta(), 1000);

  assert.deepEqual(levels, [-7000, -6000, -5000, -4000, -3000, -2000, -1000]);
});

test("volt levels exclude both endpoints", () => {
  // A level at vmin or vmax has no interior contour to draw.
  const levels = defaultContourLevels(meta(), 1000);

  assert.ok(!levels.includes(-8000));
  assert.ok(!levels.includes(0));
});

test("the step is configurable", () => {
  const levels = defaultContourLevels(meta(), 4000);

  assert.deepEqual(levels, [-4000]);
});

test("a range narrower than one step yields no levels", () => {
  assert.deepEqual(defaultContourLevels(meta({ vmin: -10, vmax: -5 }), 1000), []);
});

test("levels snap to multiples of the step, not to vmin", () => {
  // vmin -8500 with step 1000 must start at -8000, not -7500.
  const levels = defaultContourLevels(meta({ vmin: -8500 }), 1000);

  assert.equal(levels[0], -8000);
  for (const level of levels) assert.equal(Math.abs(level % 1000), 0);
});

test("levels are strictly inside the range", () => {
  const levels = defaultContourLevels(meta({ vmin: -8000, vmax: 0 }), 1000);

  for (const level of levels) {
    assert.ok(level > -8000 && level < 0, `${level} is not interior`);
  }
});

test("a positive range works too", () => {
  const levels = defaultContourLevels(meta({ vmin: 0, vmax: 3000 }), 1000);

  assert.deepEqual(levels, [1000, 2000]);
});

test("a dimensionless field uses the weighting levels", () => {
  const levels = defaultContourLevels(meta({ units: "dimensionless", vmin: 0, vmax: 1 }));

  assert.deepEqual(levels, WEIGHT_CONTOUR_LEVELS);
});

test("the weighting levels are returned as a copy", () => {
  // A caller mutating the result must not corrupt the shared constant.
  const levels = defaultContourLevels(meta({ units: "dimensionless" }));
  levels.push(999);

  assert.ok(!WEIGHT_CONTOUR_LEVELS.includes(999));
});

test("the weighting contour levels are dimensionless fractions", () => {
  assert.ok(WEIGHT_CONTOUR_LEVELS.every((v) => v > 0 && v < 1));
  assert.deepEqual([...WEIGHT_CONTOUR_LEVELS], [...WEIGHT_CONTOUR_LEVELS].sort((a, b) => b - a));
});

// --- createContourView: construction ----------------------------------------

function rig(over = {}, elements = undefined) {
  const sceneRoot = new THREE.Group();
  const m = meta(over);
  const doc = fakeDoc(
    elements ?? { "contour-levels": fakeElement(), "contour-legend": fakeElement() },
  );
  const view = createContourView(m, rampVolume(SHAPE, m.vmin, m.vmax), sceneRoot, doc);
  return { view, sceneRoot, doc, meta: m };
}

test("the contour group joins sceneRoot and starts hidden", () => {
  const { view, sceneRoot } = rig();

  assert.ok(sceneRoot.children.includes(view.group));
  assert.equal(view.group.name, "contourGroup");
  assert.equal(view.group.visible, false);
});

test("all levels share ONE LineSegments with per-vertex colours", () => {
  // UPDATED for 77e24c4: the per-level-mesh design became a single buffer, so
  // the levels slider can reach thousands of levels without thousands of draw
  // calls. Colour now rides on the vertices rather than on the material.
  const { view } = rig();

  assert.equal(view.group.children.length, 1);
  const [lines] = view.group.children;
  assert.ok(lines instanceof THREE.LineSegments);
  assert.equal(lines.material.vertexColors, true);
});

test("the shared line object is named for what it is", () => {
  const { view } = rig();

  assert.equal(view.group.children[0].name, "contourLines");
});

test("the level list is still reported", () => {
  const { view } = rig();

  assert.deepEqual(view.levels(), defaultContourLevels(meta(), 1000));
});

test("levels() returns a copy", () => {
  const { view } = rig();
  view.levels().push(-999);

  assert.ok(!view.levels().includes(-999));
});

test("the checkbox labels carry the level and unit", () => {
  // UPDATED for 77e24c4: names moved from per-level meshes onto the panel rows.
  const { doc } = rig();

  const texts = doc.created.flatMap((el) => el.children ?? []).filter((c) => typeof c === "string");
  assert.ok(texts.some((t) => t.includes("-4000") && t.includes("V")), texts.join("|"));
});

test("a dimensionless field drops the volt suffix", () => {
  const { doc } = rig({ units: "dimensionless", vmin: 0, vmax: 1 });

  const texts = doc.created.flatMap((el) => el.children ?? []).filter((c) => typeof c === "string");
  assert.ok(texts.length > 0);
  for (const t of texts) assert.ok(!t.includes(" V"), t);
});

test("line colour comes from the shared ramp, now per vertex", () => {
  // A contour must still match the colour band it traces; the mechanism moved
  // from one material per level to a colour attribute on the shared buffer.
  const { view } = rig();
  view.update("z", 3);

  const colour = view.group.children[0].geometry.getAttribute("color");
  assert.ok(colour, "no colour attribute");
  assert.equal(colour.itemSize, 3);
  const seen = new Set();
  for (let n = 0; n < colour.count; n++) {
    seen.add([colour.getX(n), colour.getY(n), colour.getZ(n)].join(","));
  }
  assert.ok(seen.size > 1, "every vertex is the same colour");
});

test("a checkbox per level while the count is small", () => {
  const { view, doc } = rig();

  const boxes = doc.created.filter((el) => el.type === "checkbox");
  assert.equal(boxes.length, view.levels().length);
});

test("checkboxes start checked", () => {
  const { doc } = rig();

  assert.ok(doc.created.filter((el) => el.type === "checkbox").every((el) => el.checked));
});

test("unchecking a contributing level drops its segments from the buffer", () => {
  // UPDATED for 77e24c4: with one shared buffer a disabled level is omitted at
  // rebuild rather than having its own mesh hidden. Not every level crosses a
  // given slice, so disable them one at a time until one that does is found —
  // asserting on an arbitrary checkbox would pass or fail by luck.
  const { view, doc } = rig();
  const count = () =>
    view.group.children[0].geometry.getAttribute("position")?.count ?? 0;

  view.update("z", 3);
  const before = count();
  assert.ok(before > 0, "no contour geometry to start from");

  let dropped = false;
  for (const box of doc.created.filter((el) => el.type === "checkbox")) {
    const previous = count();
    box.checked = false;
    box.fire("change");
    view.update("z", 3);
    if (count() < previous) {
      dropped = true;
      break;
    }
  }
  assert.ok(dropped, "no level ever reduced the buffer");
});

test("the view survives a missing panel and legend", () => {
  // The contour controls are hidden until a potential loads.
  const sceneRoot = new THREE.Group();

  assert.doesNotThrow(() =>
    createContourView(meta(), rampVolume(), sceneRoot, fakeDoc()),
  );
});

// --- createContourView: geometry -------------------------------------------

test("update fills geometry for a slice that crosses the levels", () => {
  const { view } = rig();

  view.update("z", 3);

  const filled = view.group.children.filter(
    (c) => (c.geometry.getAttribute("position")?.count ?? 0) > 0,
  );
  assert.ok(filled.length > 0, "no contour geometry was built");
});

test("positions are triples", () => {
  const { view } = rig();

  view.update("x", 2);

  for (const child of view.group.children) {
    const attr = child.geometry.getAttribute("position");
    if (attr) assert.equal(attr.itemSize, 3);
  }
});

test("contours land on their slice plane, within the nudge", () => {
  // They must trace the plane they describe, not float somewhere else.
  const { view, meta: m } = rig();
  const axis = "z";
  const index = 4;

  view.update(axis, index);
  const plane = slicePlaneParams(axis, index, m);

  for (const child of view.group.children) {
    for (const v of worldVerts(child)) {
      assert.ok(
        Math.abs(v.z - plane.center[2]) < 0.05,
        `contour z ${v.z} is far from plane z ${plane.center[2]}`,
      );
    }
  }
});

test("the nudge offsets along the plane normal, not into it", () => {
  const { view, meta: m } = rig();

  view.update("z", 4);
  const plane = slicePlaneParams("z", 4, m);

  let offset = null;
  for (const child of view.group.children) {
    const verts = worldVerts(child);
    if (verts.length === 0) continue;
    offset = verts[0].z - plane.center[2];
    break;
  }
  assert.ok(offset !== null, "no contour geometry to measure");
  assert.ok(offset > 0, "contours are not nudged clear of the texture");
  assert.ok(offset < 0.1 * m.spacing[2] || offset < 0.05, "nudge is too large");
});

test("contours stay within the plane's footprint", () => {
  const { view, meta: m } = rig();

  view.update("z", 3);
  const plane = slicePlaneParams("z", 3, m);
  const halfW = plane.width / 2;
  const halfH = plane.height / 2;

  for (const child of view.group.children) {
    for (const v of worldVerts(child)) {
      assert.ok(Math.abs(v.x - plane.center[0]) <= halfW + 1e-4, `x ${v.x}`);
      assert.ok(Math.abs(v.y - plane.center[1]) <= halfH + 1e-4, `y ${v.y}`);
    }
  }
});

test("update on each axis places contours on that axis's plane", () => {
  const { view, meta: m } = rig();

  for (const [axis, component] of [["x", 0], ["y", 1], ["z", 2]]) {
    view.update(axis, 2);
    const plane = slicePlaneParams(axis, 2, m);
    for (const child of view.group.children) {
      const verts = worldVerts(child);
      if (verts.length === 0) continue;
      const v = verts[0].toArray()[component];
      assert.ok(
        Math.abs(v - plane.center[component]) < 0.05,
        `${axis}: ${v} vs ${plane.center[component]}`,
      );
    }
  }
});

test("disabling every level empties the buffer", () => {
  const { view, doc } = rig();

  for (const box of doc.created.filter((el) => el.type === "checkbox")) {
    box.checked = false;
    box.fire("change");
  }
  view.update("z", 3);

  const attr = view.group.children[0].geometry.getAttribute("position");
  assert.ok(!attr || attr.count === 0);
});

test("repeated updates do not accumulate objects", () => {
  const { view } = rig();
  const before = view.group.children.length;

  view.update("z", 2);
  view.update("z", 3);
  view.update("x", 1);

  assert.equal(view.group.children.length, before);
});

test("update is safe on a slice with no crossings", () => {
  // A constant volume: no level is crossed anywhere.
  const sceneRoot = new THREE.Group();
  const flat = new Float32Array(5 * 6 * 7).fill(-4000);
  const view = createContourView(meta(), flat, sceneRoot, fakeDoc());

  assert.doesNotThrow(() => view.update("z", 3));
  for (const child of view.group.children) {
    const attr = child.geometry.getAttribute("position");
    assert.ok(!attr || attr.count === 0);
  }
});

test("update rejects an out-of-range index", () => {
  const { view } = rig();

  assert.throws(() => view.update("z", 99), /out of range/);
});

test("every emitted coordinate is finite", () => {
  const { view } = rig();

  for (const axis of ["x", "y", "z"]) {
    view.update(axis, 1);
    for (const child of view.group.children) {
      const attr = child.geometry.getAttribute("position");
      if (!attr) continue;
      for (let n = 0; n < attr.count * 3; n++) {
        assert.ok(Number.isFinite(attr.array[n]));
      }
    }
  }
});

// --- absent units default to volts (the Phase 8 wire format) ----------------

test("a meta with no units is treated as volts", () => {
  // The Phase 8 drift payload has no units key and was always volts; reading
  // it as dimensionless would silently switch to the weighting level list.
  const bare = { shape: SHAPE, spacing: [0.1, 0.1, 0.1], origin: [0, 0, 0], vmin: -8000, vmax: 0 };

  const levels = defaultContourLevels(bare, 1000);

  assert.deepEqual(levels, [-7000, -6000, -5000, -4000, -3000, -2000, -1000]);
  assert.notDeepEqual(levels, WEIGHT_CONTOUR_LEVELS);
});

test("a unitless meta keeps the volt suffix on the panel labels", () => {
  const bare = { shape: SHAPE, spacing: [0.1, 0.1, 0.1], origin: [0, 0, 0], vmin: -8000, vmax: 0, zstride: 1 };
  const doc = fakeDoc({ "contour-levels": fakeElement() });

  createContourView(bare, rampVolume(), new THREE.Group(), doc);

  const texts = doc.created.flatMap((el) => el.children ?? []).filter((c) => typeof c === "string");
  assert.ok(texts.length > 0);
  assert.ok(texts.some((t) => t.includes(" V")), texts.join("|"));
});
