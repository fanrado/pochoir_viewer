// Tests for the per-axis stride applied browser-side.
//
// The bug this fixes: only z carried its stride, so with the weighting field's
// transverse stride of (2, 2, 1) every x and y position read at half its true
// value — the slice plane covered a quarter of the domain, the hover readout
// reported the wrong millimetres, and both disagreed with the boundary geometry
// drawn from the Python side, which has applied per-axis strides since 5c977c1.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  metaStride,
  sliceLabel,
  slicePlaneParams,
} from "../../web/potential_build.js";
import { voxelReading } from "../../web/potential_view.js";

const SHAPE = [22, 22, 300];

const meta = (over = {}) => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  ...over,
});

/** The real weighting export: stride (2, 2, 1) with a z crop. */
const weightMeta = (over = {}) => meta({ stride: [2, 2, 1], zstride: 1, ...over });

const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- metaStride -------------------------------------------------------------

test("a 3-tuple stride is returned as-is", () => {
  assert.deepEqual(metaStride(meta({ stride: [2, 3, 4] })), [2, 3, 4]);
});

test("a legacy zstride-only payload maps to z alone", () => {
  // Phase 8 payloads carry no stride key; they strided z only, so that is what
  // the fallback must reproduce.
  assert.deepEqual(metaStride(meta({ zstride: 4 })), [1, 1, 4]);
});

test("a payload with neither key is unstrided", () => {
  assert.deepEqual(metaStride(meta()), [1, 1, 1]);
});

test("an explicit stride wins over a stale zstride", () => {
  // write_potential emits both: zstride mirrors stride[2] for the wire format.
  assert.deepEqual(metaStride(meta({ stride: [2, 2, 1], zstride: 1 })), [2, 2, 1]);
});

test("zstride 1 is honoured rather than treated as absent", () => {
  assert.deepEqual(metaStride(meta({ zstride: 1 })), [1, 1, 1]);
});

// --- slice plane spans ------------------------------------------------------

test("a transverse stride still spans the full domain", () => {
  // 22 kept samples of a 44-node axis at 0.1 mm is still 4.4 mm of domain.
  const params = slicePlaneParams("z", 0, weightMeta());

  assert.ok(close(params.width, 4.4));
  assert.ok(close(params.height, 4.4));
});

test("without the fix the plane would cover a quarter of the area", () => {
  // Pins the size of the defect: unstrided spans give 2.2 x 2.2 mm.
  const wrong = slicePlaneParams("z", 0, meta());
  const right = slicePlaneParams("z", 0, weightMeta());

  assert.ok(close(wrong.width, 2.2));
  assert.ok(close(right.width / wrong.width, 2));
});

test("each axis span uses its own stride", () => {
  const params = slicePlaneParams("z", 0, meta({ stride: [2, 4, 1] }));

  assert.ok(close(params.width, 22 * 2 * 0.1));
  assert.ok(close(params.height, 22 * 4 * 0.1));
});

test("an x plane's spans carry the y and z strides", () => {
  const params = slicePlaneParams("x", 0, meta({ stride: [2, 4, 8] }));

  assert.ok(close(params.width, 22 * 4 * 0.1)); // spanY
  assert.ok(close(params.height, 300 * 8 * 0.1)); // spanZ
});

test("the plane centre sits at half the strided span", () => {
  const params = slicePlaneParams("z", 0, weightMeta());

  assert.ok(close(params.center[0], 2.2));
  assert.ok(close(params.center[1], 2.2));
});

test("an unstrided payload is unchanged by the fix", () => {
  const params = slicePlaneParams("z", 0, meta());

  assert.ok(close(params.width, 2.2));
  assert.ok(close(params.center[0], 1.1));
});

// --- slice positions along each axis ----------------------------------------

test("an x slice index steps by stride[0] * spacing[0]", () => {
  const a = slicePlaneParams("x", 0, weightMeta());
  const b = slicePlaneParams("x", 1, weightMeta());

  assert.ok(close(b.center[0] - a.center[0], 0.2), "expected a 2 * 0.1 mm step");
});

test("a y slice index steps by stride[1] * spacing[1]", () => {
  const a = slicePlaneParams("y", 0, weightMeta());
  const b = slicePlaneParams("y", 1, weightMeta());

  assert.ok(close(b.center[1] - a.center[1], 0.2));
});

test("a z slice index steps by stride[2] * spacing[2]", () => {
  const m = meta({ stride: [1, 1, 4] });
  const a = slicePlaneParams("z", 0, m);
  const b = slicePlaneParams("z", 1, m);

  assert.ok(close(b.center[2] - a.center[2], 0.4));
});

test("slice positions honour the origin as well as the stride", () => {
  const params = slicePlaneParams("x", 3, weightMeta({ origin: [10, 0, 0] }));

  assert.ok(close(params.center[0], 10 + 3 * 2 * 0.1));
});

// --- the label reports true millimetres -------------------------------------

test("the label reports strided millimetres on x", () => {
  // Index 5 of a stride-2 axis is node 10, i.e. 1.00 mm, not 0.50.
  assert.equal(sliceLabel("x", 5, weightMeta()), "x = 1.00 mm (index 5)");
});

test("the label reports strided millimetres on y", () => {
  assert.equal(sliceLabel("y", 5, weightMeta()), "y = 1.00 mm (index 5)");
});

test("the label still reports strided millimetres on z", () => {
  assert.equal(sliceLabel("z", 3, meta({ zstride: 4 })), "z = 1.20 mm (index 3)");
});

test("the label agrees with the plane centre on every axis", () => {
  const m = meta({ stride: [2, 4, 8] });

  for (const [axis, component] of [["x", 0], ["y", 1], ["z", 2]]) {
    const params = slicePlaneParams(axis, 2, m);
    assert.ok(
      sliceLabel(axis, 2, m).includes(params.center[component].toFixed(2)),
      `${axis}: ${sliceLabel(axis, 2, m)} vs ${params.center[component]}`,
    );
  }
});

// --- the hover readout ------------------------------------------------------

function volume(shape = SHAPE) {
  return new Float32Array(shape[0] * shape[1] * shape[2]);
}

test("voxelReading applies every axis's stride", () => {
  const reading = voxelReading(volume(), weightMeta(), 5, 7, 9);

  assert.ok(close(reading.mm[0], 5 * 2 * 0.1));
  assert.ok(close(reading.mm[1], 7 * 2 * 0.1));
  assert.ok(close(reading.mm[2], 9 * 1 * 0.1));
});

test("the readout agrees with the slice plane for the same index", () => {
  // The readout and the geometry must not disagree; that was the visible
  // symptom, a hover reporting half the position of the plane it was on.
  const m = weightMeta();
  const params = slicePlaneParams("x", 6, m);
  const reading = voxelReading(volume(), m, 6, 0, 0);

  assert.ok(close(reading.mm[0], params.center[0]));
});

test("a legacy zstride payload still reads correctly", () => {
  const reading = voxelReading(volume(), meta({ zstride: 4 }), 1, 2, 3);

  assert.ok(close(reading.mm[0], 0.1));
  assert.ok(close(reading.mm[1], 0.2));
  assert.ok(close(reading.mm[2], 3 * 4 * 0.1));
});

test("the readout honours the origin", () => {
  const reading = voxelReading(volume(), weightMeta({ origin: [1, 2, 3] }), 1, 1, 1);

  assert.ok(close(reading.mm[0], 1 + 0.2));
  assert.ok(close(reading.mm[1], 2 + 0.2));
  assert.ok(close(reading.mm[2], 3 + 0.1));
});

// --- the contour nudge scales with the voxel --------------------------------

/** A volume spanning -8000..0 so the default 1000 V levels actually cross it. */
function driftVolume(n = 4) {
  const vol = new Float32Array(n * n * n);
  const span = 3 * (n - 1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        vol[(i * n + j) * n + k] = -8000 + (8000 * (i + j + k)) / span;
      }
  return vol;
}

test("the nudge is a fraction of a strided voxel, not of the spacing", async () => {
  // On a strided axis a voxel is stride * spacing, so the offset must grow with
  // it or the lines sink into the texture on a coarsely strided export.
  const { createContourView } = await import("../../web/potential_view.js");
  const doc = { getElementById: () => null, createElement: () => ({ append() {}, addEventListener() {}, style: {} }) };

  const base = {
    shape: [4, 4, 4], spacing: [0.1, 0.1, 0.1], origin: [0, 0, 0],
    vmin: -8000, vmax: 0, units: "V",
  };
  const vol = driftVolume();
  const sceneRoot = new THREE.Group();

  const plain = createContourView(base, vol, sceneRoot, doc);
  plain.update("x", 1);
  const plainOffset = offsetOf(plain, base, "x", 1, 0);

  const strided = { ...base, stride: [4, 1, 1] };
  const root2 = new THREE.Group();
  const view2 = createContourView(strided, vol, root2, doc);
  view2.update("x", 1);
  const stridedOffset = offsetOf(view2, strided, "x", 1, 0);

  assert.ok(plainOffset > 0 && stridedOffset > 0, "no contour geometry to measure");
  assert.ok(close(stridedOffset / plainOffset, 4, 1e-3), `${stridedOffset} vs ${plainOffset}`);
});

function offsetOf(view, m, axis, index, component) {
  const plane = slicePlaneParams(axis, index, m);
  for (const child of view.group.children) {
    const attr = child.geometry.getAttribute("position");
    if (!attr || attr.count === 0) continue;
    child.updateMatrixWorld(true);
    const v = new THREE.Vector3(attr.getX(0), attr.getY(0), attr.getZ(0)).applyMatrix4(
      child.matrixWorld,
    );
    return v.toArray()[component] - plane.center[component];
  }
  return 0;
}
