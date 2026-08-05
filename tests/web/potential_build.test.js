// Tests for web/potential_build.js — slice extraction, colormap, plane params.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractSlice,
  sliceLabel,
  slicePlaneParams,
  valuesToRGBA,
} from "../../web/potential_build.js";

/** A volume whose every voxel encodes its own (i, j, k), so a transpose shows. */
function indexVolume(shape) {
  const [ni, nj, nk] = shape;
  const volume = new Float32Array(ni * nj * nk);
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      for (let k = 0; k < nk; k++) {
        volume[(i * nj + j) * nk + k] = i * 100 + j * 10 + k;
      }
    }
  }
  return volume;
}

const meta = (over = {}) => ({
  shape: [4, 5, 6],
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  ...over,
});

const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- extractSlice: dimensions ----------------------------------------------

test("a z slice spans (i, j)", () => {
  const shape = [4, 5, 6];

  const slice = extractSlice(indexVolume(shape), shape, "z", 2);

  assert.equal(slice.width, 4);
  assert.equal(slice.height, 5);
  assert.equal(slice.values.length, 20);
});

test("an x slice spans (j, k)", () => {
  const shape = [4, 5, 6];

  const slice = extractSlice(indexVolume(shape), shape, "x", 1);

  assert.equal(slice.width, 5);
  assert.equal(slice.height, 6);
  assert.equal(slice.values.length, 30);
});

test("a y slice spans (i, k)", () => {
  const shape = [4, 5, 6];

  const slice = extractSlice(indexVolume(shape), shape, "y", 3);

  assert.equal(slice.width, 4);
  assert.equal(slice.height, 6);
  assert.equal(slice.values.length, 24);
});

test("slices are Float32Array", () => {
  const shape = [4, 5, 6];

  assert.ok(extractSlice(indexVolume(shape), shape, "z", 0).values instanceof Float32Array);
});

// --- extractSlice: the indexing contract ------------------------------------

test("a z slice reads value(i, j, index) in row-major (i, j)", () => {
  // The whole point: a transpose here yields a plausible but wrong image.
  const shape = [4, 5, 6];
  const { values, height } = extractSlice(indexVolume(shape), shape, "z", 2);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      assert.equal(values[i * height + j], i * 100 + j * 10 + 2, `(${i},${j})`);
    }
  }
});

test("an x slice reads value(index, j, k) in row-major (j, k)", () => {
  const shape = [4, 5, 6];
  const { values, height } = extractSlice(indexVolume(shape), shape, "x", 1);

  for (let j = 0; j < 5; j++) {
    for (let k = 0; k < 6; k++) {
      assert.equal(values[j * height + k], 100 + j * 10 + k, `(${j},${k})`);
    }
  }
});

test("a y slice reads value(i, index, k) in row-major (i, k)", () => {
  const shape = [4, 5, 6];
  const { values, height } = extractSlice(indexVolume(shape), shape, "y", 3);

  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 6; k++) {
      assert.equal(values[i * height + k], i * 100 + 30 + k, `(${i},${k})`);
    }
  }
});

test("each axis picks a different plane", () => {
  const shape = [4, 5, 6];
  const volume = indexVolume(shape);

  const a = extractSlice(volume, shape, "z", 0).values[0];
  const b = extractSlice(volume, shape, "z", 5).values[0];

  assert.equal(a, 0);
  assert.equal(b, 5);
});

test("a non-cubic volume is not silently transposed", () => {
  // Equal dimensions would let an axis mix-up pass unnoticed.
  const shape = [2, 3, 7];
  const { width, height } = extractSlice(indexVolume(shape), shape, "x", 0);

  assert.deepEqual([width, height], [3, 7]);
});

test("the first and last index of every axis are readable", () => {
  const shape = [4, 5, 6];
  const volume = indexVolume(shape);

  for (const [axis, last] of [["x", 3], ["y", 4], ["z", 5]]) {
    assert.doesNotThrow(() => extractSlice(volume, shape, axis, 0), axis);
    assert.doesNotThrow(() => extractSlice(volume, shape, axis, last), axis);
  }
});

// --- extractSlice: rejected input -------------------------------------------

test("an unknown axis is rejected", () => {
  const shape = [4, 5, 6];

  assert.throws(() => extractSlice(indexVolume(shape), shape, "w", 0), /unknown axis/);
});

test("an out-of-range index is rejected per axis", () => {
  const shape = [4, 5, 6];
  const volume = indexVolume(shape);

  assert.throws(() => extractSlice(volume, shape, "x", 4), /out of range/);
  assert.throws(() => extractSlice(volume, shape, "y", 5), /out of range/);
  assert.throws(() => extractSlice(volume, shape, "z", 6), /out of range/);
});

test("a negative index is rejected", () => {
  const shape = [4, 5, 6];

  assert.throws(() => extractSlice(indexVolume(shape), shape, "z", -1), /out of range/);
});

test("a fractional index is rejected", () => {
  // A slider mid-drag can yield 2.5; silently flooring it would misreport the mm.
  const shape = [4, 5, 6];

  assert.throws(() => extractSlice(indexVolume(shape), shape, "z", 2.5), /out of range/);
});

test("the range message names the valid bounds", () => {
  const shape = [4, 5, 6];

  assert.throws(() => extractSlice(indexVolume(shape), shape, "z", 99), /0\.\.5/);
});

// --- valuesToRGBA -----------------------------------------------------------

const rgbaAt = (rgba, n) => [rgba[n * 4], rgba[n * 4 + 1], rgba[n * 4 + 2], rgba[n * 4 + 3]];

test("output is 4 bytes per value", () => {
  const rgba = valuesToRGBA(new Float32Array([0, 1, 2]), 0, 2);

  assert.ok(rgba instanceof Uint8Array);
  assert.equal(rgba.length, 12);
});

test("alpha is always opaque", () => {
  const rgba = valuesToRGBA(new Float32Array([-5, 0, 3, 99]), 0, 3);

  for (let n = 0; n < 4; n++) assert.equal(rgbaAt(rgba, n)[3], 255);
});

test("vmin maps to the dark blue endpoint", () => {
  const rgba = valuesToRGBA(new Float32Array([-8000]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0).slice(0, 3), [12, 24, 92]);
});

test("vmax maps to the yellow endpoint", () => {
  const rgba = valuesToRGBA(new Float32Array([0]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0).slice(0, 3), [252, 240, 76]);
});

test("the midpoint maps to the cyan stop", () => {
  const rgba = valuesToRGBA(new Float32Array([-4000]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0).slice(0, 3), [42, 196, 208]);
});

test("values below vmin clamp rather than wrapping", () => {
  const rgba = valuesToRGBA(new Float32Array([-99999]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0).slice(0, 3), [12, 24, 92]);
});

test("values above vmax clamp rather than wrapping", () => {
  const rgba = valuesToRGBA(new Float32Array([99999]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0).slice(0, 3), [252, 240, 76]);
});

test("a zero span does not divide by zero", () => {
  // A constant slice: every voxel identical, vmin == vmax.
  const rgba = valuesToRGBA(new Float32Array([5, 5, 5]), 5, 5);

  for (let n = 0; n < 3; n++) {
    assert.ok(rgbaAt(rgba, n).every(Number.isFinite));
    assert.deepEqual(rgbaAt(rgba, n).slice(0, 3), [12, 24, 92]);
  }
});

test("lightness rises monotonically across the ramp", () => {
  // The stated reason for this ramp: the eye must read the gradient's direction,
  // and it must survive greyscale printing.
  const steps = 32;
  const values = Float32Array.from({ length: steps }, (_, n) => n / (steps - 1));
  const rgba = valuesToRGBA(values, 0, 1);

  let previous = -1;
  for (let n = 0; n < steps; n++) {
    const [r, g, b] = rgbaAt(rgba, n);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.ok(luma > previous, `luma fell at step ${n}`);
    previous = luma;
  }
});

test("the ramp is continuous across the cyan stop", () => {
  const rgba = valuesToRGBA(new Float32Array([0.499, 0.5, 0.501]), 0, 1);

  for (let channel = 0; channel < 3; channel++) {
    const before = rgbaAt(rgba, 0)[channel];
    const at = rgbaAt(rgba, 1)[channel];
    const after = rgbaAt(rgba, 2)[channel];
    assert.ok(Math.abs(at - before) < 5, `channel ${channel} jumps before the stop`);
    assert.ok(Math.abs(after - at) < 5, `channel ${channel} jumps after the stop`);
  }
});

test("colour is a function of value alone, not of position", () => {
  const rgba = valuesToRGBA(new Float32Array([-4000, 0, -4000]), -8000, 0);

  assert.deepEqual(rgbaAt(rgba, 0), rgbaAt(rgba, 2));
});

test("an empty slice yields an empty buffer", () => {
  assert.equal(valuesToRGBA(new Float32Array(0), 0, 1).length, 0);
});

test("an inverted range still clamps to the endpoints", () => {
  // vmin > vmax gives a negative span; nothing may produce NaN bytes.
  const rgba = valuesToRGBA(new Float32Array([-5, 0, 5]), 5, -5);

  for (let n = 0; n < 3; n++) {
    assert.ok(rgbaAt(rgba, n).every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  }
});

// --- slicePlaneParams -------------------------------------------------------

test("a z plane spans x by y and faces +z unrotated", () => {
  const params = slicePlaneParams("z", 0, meta());

  // Spans are n * spacing (each node owns a cell), matching boundary.py and
  // Grid.extent_mm, so a 44-node axis at 0.1 mm is exactly 4.4 mm.
  assert.ok(close(params.width, 0.4)); // 4 * 0.1
  assert.ok(close(params.height, 0.5)); // 5 * 0.1
  assert.deepEqual(params.rotation, [0, 0, 0]);
});

test("a z slice matches the cathode quad exactly", () => {
  // boundary_groups emits the cathode as [0, 0, 4.4, 4.4]; an (n-1)*spacing
  // span would leave the slice a half-voxel short of it.
  const params = slicePlaneParams("z", 0, {
    shape: [44, 44, 1601], spacing: [0.1, 0.1, 0.1], origin: [0, 0, 0], zstride: 1,
  });

  assert.ok(close(params.width, 4.4, 1e-9));
  assert.ok(close(params.height, 4.4, 1e-9));
  assert.ok(close(params.center[0], 2.2, 1e-9));
});

test("an x plane spans y by z, matching extractSlice's (j, k) order", () => {
  // The texture is built from extractSlice, which yields (j, k) as
  // (width, height). A plane sized spanZ by spanY draws it transposed.
  const params = slicePlaneParams("x", 0, meta());

  assert.ok(close(params.width, 0.5)); // spanY = 5 * 0.1
  assert.ok(close(params.height, 0.6)); // spanZ = 6 * 0.1
});

test("a y plane spans x by z, matching extractSlice's (i, k) order", () => {
  const params = slicePlaneParams("y", 0, meta());

  assert.ok(close(params.width, 0.4)); // spanX = 4 * 0.1
  assert.ok(close(params.height, 0.6)); // spanZ = 6 * 0.1
  assert.deepEqual(params.rotation, [Math.PI / 2, 0, 0]);
});

test("the plane centre moves along its own axis only", () => {
  const first = slicePlaneParams("z", 0, meta());
  const last = slicePlaneParams("z", 5, meta());

  assert.deepEqual(first.center.slice(0, 2), last.center.slice(0, 2));
  assert.ok(last.center[2] > first.center[2]);
});

test("the centre sits at the volume midpoint on the other two axes", () => {
  const params = slicePlaneParams("z", 3, meta());

  assert.ok(close(params.center[0], 0.2)); // spanX / 2
  assert.ok(close(params.center[1], 0.25)); // spanY / 2
});

test("the slice position honours the grid spacing", () => {
  const params = slicePlaneParams("z", 4, meta({ spacing: [0.1, 0.1, 0.5] }));

  assert.ok(close(params.center[2], 2.0)); // 4 * 0.5
});

test("z position and span both carry the zstride", () => {
  // The volume holds every zstride-th sample, so index 4 is 4*zstride nodes in.
  const strided = slicePlaneParams("z", 4, meta({ zstride: 4 }));
  const plain = slicePlaneParams("z", 4, meta({ zstride: 1 }));

  assert.ok(close(strided.center[2], plain.center[2] * 4));
});

test("an x plane's HEIGHT grows with the zstride", () => {
  // z is the plane's vertical axis now, so the stride stretches height, not
  // width; width is spanY and must be untouched.
  const strided = slicePlaneParams("x", 0, meta({ zstride: 4 }));

  assert.ok(close(strided.height, 2.4)); // spanZ = 6 * 4 * 0.1
  assert.ok(close(strided.width, 0.5)); // spanY, unchanged
});

test("the origin offsets every centre component", () => {
  const params = slicePlaneParams("z", 0, meta({ origin: [1, 2, 3] }));

  assert.ok(close(params.center[0], 1.2));
  assert.ok(close(params.center[1], 2.25));
  assert.ok(close(params.center[2], 3.0));
});

test("a missing origin defaults to the world origin", () => {
  const bare = { shape: [4, 5, 6], spacing: [0.1, 0.1, 0.1] };

  const params = slicePlaneParams("z", 0, bare);

  assert.ok(close(params.center[2], 0));
});

test("a missing zstride defaults to 1", () => {
  const bare = { shape: [4, 5, 6], spacing: [0.1, 0.1, 0.1], origin: [0, 0, 0] };

  assert.deepEqual(slicePlaneParams("z", 4, bare), slicePlaneParams("z", 4, meta()));
});

test("slicePlaneParams validates its index too", () => {
  assert.throws(() => slicePlaneParams("z", 6, meta()), /out of range/);
  assert.throws(() => slicePlaneParams("w", 0, meta()), /unknown axis/);
});

// --- sliceLabel -------------------------------------------------------------

test("the label names the axis, the mm position and the index", () => {
  assert.equal(sliceLabel("z", 3, meta()), "z = 0.30 mm (index 3)");
});

test("the label reports two decimals", () => {
  assert.match(sliceLabel("x", 1, meta()), /x = 0\.10 mm/);
});

test("the label reports TRUE mm, carrying the zstride", () => {
  // With stride 4, index 3 is node 12 -> 1.20 mm, not 0.30.
  assert.equal(sliceLabel("z", 3, meta({ zstride: 4 })), "z = 1.20 mm (index 3)");
});

test("the label honours the origin", () => {
  assert.equal(sliceLabel("z", 0, meta({ origin: [0, 0, 10] })), "z = 10.00 mm (index 0)");
});

test("the label agrees with the plane centre", () => {
  const params = slicePlaneParams("z", 4, meta({ zstride: 2 }));
  const label = sliceLabel("z", 4, meta({ zstride: 2 }));

  assert.ok(label.includes(params.center[2].toFixed(2)));
});

test("sliceLabel validates its index", () => {
  assert.throws(() => sliceLabel("z", 99, meta()), /out of range/);
});

// --- the rotation actually maps texture UV to the intended world axes -------
//
// These are the tests that would have caught the transposed x slice fixed in
// 278190b. The earlier versions asserted the Euler triple itself, which merely
// re-encoded whatever the implementation did; an Euler triple is not readable
// by inspection. What matters is where U and V *land*, so derive it from the
// rotation matrix instead.

import * as THREE from "three";

/** World directions of the plane's texture U, texture V, and its normal. */
function planeAxes(axis, metaObj = meta()) {
  const { rotation } = slicePlaneParams(axis, 0, metaObj);
  const euler = new THREE.Euler(...rotation, "XYZ");
  // `+ 0` normalises -0 to 0 so deepEqual comparisons read cleanly.
  const dir = (v) => v.applyEuler(euler).round().toArray().map((c) => c + 0);
  return {
    u: dir(new THREE.Vector3(1, 0, 0)),
    v: dir(new THREE.Vector3(0, 1, 0)),
    normal: dir(new THREE.Vector3(0, 0, 1)),
  };
}

test("a z plane maps U to +x and V to +y, normal along z", () => {
  // extractSlice("z") yields (i, j) = (x, y).
  const { u, v, normal } = planeAxes("z");

  assert.deepEqual(u, [1, 0, 0]);
  assert.deepEqual(v, [0, 1, 0]);
  assert.deepEqual(normal.map(Math.abs), [0, 0, 1]);
});

test("an x plane maps U to +y and V to +z, normal along x", () => {
  // extractSlice("x") yields (j, k) = (y, z). The pre-278190b rotation
  // [0, PI/2, 0] sent U to -z instead, drawing the cathode band along the
  // 4.4 mm transverse edge rather than at the cathode plane.
  const { u, v, normal } = planeAxes("x");

  assert.deepEqual(u, [0, 1, 0]);
  assert.deepEqual(v, [0, 0, 1]);
  assert.deepEqual(normal.map(Math.abs), [1, 0, 0]);
});

test("a y plane maps U to +x and V to +z, normal along y", () => {
  // extractSlice("y") yields (i, k) = (x, z).
  const { u, v, normal } = planeAxes("y");

  assert.deepEqual(u, [1, 0, 0]);
  assert.deepEqual(v, [0, 0, 1]);
  assert.deepEqual(normal.map(Math.abs), [0, 1, 0]);
});

test("every plane's normal is its own axis", () => {
  for (const [axis, expected] of [["x", [1, 0, 0]], ["y", [0, 1, 0]], ["z", [0, 0, 1]]]) {
    assert.deepEqual(planeAxes(axis).normal.map(Math.abs), expected, axis);
  }
});

test("U and V stay perpendicular for every axis", () => {
  for (const axis of ["x", "y", "z"]) {
    const { u, v } = planeAxes(axis);
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    assert.equal(dot, 0, axis);
  }
});

test("the plane's U/V spans match the slice its texture comes from", () => {
  // The invariant behind the bug: width must measure the axis U lands on, and
  // height the axis V lands on. Checked against extractSlice's own dimensions.
  const shape = [4, 5, 6];
  const spacing = [0.1, 0.1, 0.1];
  const metaObj = { shape, spacing, origin: [0, 0, 0], zstride: 1 };
  const axisOf = (dir) => dir.findIndex((c) => c !== 0);

  for (const axis of ["x", "y", "z"]) {
    const slice = extractSlice(indexVolume(shape), shape, axis, 0);
    const { u, v } = planeAxes(axis, metaObj);
    const params = slicePlaneParams(axis, 0, metaObj);

    assert.ok(
      close(params.width, slice.width * spacing[axisOf(u)]),
      `${axis}: width does not span the U axis`,
    );
    assert.ok(
      close(params.height, slice.height * spacing[axisOf(v)]),
      `${axis}: height does not span the V axis`,
    );
  }
});
