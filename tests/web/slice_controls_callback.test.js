// Tests for the onRender callback added to wireSliceControls.
//
// It is how the contour overlay stays in step with the slice plane: every
// render of the plane must also drive the contours, or the two drift apart.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { createSliceView, wireSliceControls } from "../../web/potential_view.js";

const SHAPE = [4, 5, 6];

function volume() {
  const [ni, nj, nk] = SHAPE;
  const out = new Float32Array(ni * nj * nk);
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++)
      for (let k = 0; k < nk; k++) out[(i * nj + j) * nk + k] = i + j + k;
  return out;
}

const meta = () => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: 0,
  vmax: 12,
  units: "V",
});

function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    checked: false,
    value: "0",
    max: "0",
    handlers: {},
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
    append() {},
  };
}

function rig({ withCallback = true } = {}) {
  const sceneRoot = new THREE.Group();
  const view = createSliceView(meta(), volume(), sceneRoot);

  const slider = fakeElement("input");
  const label = fakeElement("span");
  const radios = {
    "axis-x": fakeElement("input"),
    "axis-y": fakeElement("input"),
    "axis-z": fakeElement("input"),
  };
  radios["axis-z"].checked = true;

  const doc = {
    getElementById: (id) => ({ "slice-idx": slider, "slice-label": label, ...radios }[id] ?? null),
  };

  const calls = [];
  const controls = wireSliceControls(
    view,
    doc,
    withCallback ? (axis, index) => calls.push([axis, index]) : null,
  );

  return { view, controls, slider, radios, calls };
}

// --- the callback fires with the rendered slice -----------------------------

test("the callback fires once during initial wiring", () => {
  const { calls } = rig();

  assert.equal(calls.length, 1);
});

test("the initial call reports the starting axis and index", () => {
  // Controls open on the middle of the z axis: extent 6 -> max 5 -> index 2.
  const { calls } = rig();

  assert.deepEqual(calls[0], ["z", 2]);
});

test("moving the slider fires the callback with the new index", () => {
  const { slider, calls } = rig();

  slider.value = "4";
  slider.fire("input");

  assert.deepEqual(calls.at(-1), ["z", 4]);
});

test("every slider move fires exactly once", () => {
  const { slider, calls } = rig();
  const before = calls.length;

  for (const value of ["1", "2", "3"]) {
    slider.value = value;
    slider.fire("input");
  }

  assert.equal(calls.length, before + 3);
});

test("switching axis fires the callback with the new axis", () => {
  const { radios, calls } = rig();

  radios["axis-x"].checked = true;
  radios["axis-x"].fire("change");

  assert.equal(calls.at(-1)[0], "x");
});

test("the callback sees the CLAMPED index after an axis switch", () => {
  // z has 6 samples, x only 4. If the callback were handed the pre-clamp
  // index, the contours would be built for a slice the plane is not showing.
  const { slider, radios, calls } = rig();

  slider.value = "5";
  slider.fire("input");
  radios["axis-x"].checked = true;
  radios["axis-x"].fire("change");

  assert.deepEqual(calls.at(-1), ["x", 3]);
  assert.equal(calls.at(-1)[1], Number(slider.value));
});

test("setAxis called directly also fires the callback", () => {
  const { controls, calls } = rig();
  const before = calls.length;

  controls.setAxis("y");

  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1)[0], "y");
});

test("controls.render fires the callback", () => {
  const { controls, calls } = rig();

  controls.render(1);

  assert.deepEqual(calls.at(-1), ["z", 1]);
});

test("an unchecked radio change fires nothing", () => {
  const { radios, calls } = rig();
  const before = calls.length;

  radios["axis-x"].checked = false;
  radios["axis-x"].fire("change");

  assert.equal(calls.length, before);
});

// --- the callback and the plane stay in step --------------------------------

test("the callback's axis and index match what the plane just rendered", () => {
  // This is the whole point: contours are rebuilt from these two values, so a
  // mismatch would draw lines for a different slice than the texture shows.
  const { view, controls, calls } = rig();

  for (const [axis, index] of [["z", 4], ["x", 1], ["y", 3]]) {
    controls.setAxis(axis);
    controls.render(index);
    const [gotAxis, gotIndex] = calls.at(-1);
    const plane = view.updateSlice(gotAxis, gotIndex);
    assert.equal(gotAxis, axis);
    assert.equal(gotIndex, index);
    assert.ok(plane.width > 0);
  }
});

test("the callback fires after the plane is updated, not before", () => {
  // Contours read the plane's transform, so it must already be current.
  const sceneRoot = new THREE.Group();
  const view = createSliceView(meta(), volume(), sceneRoot);
  const seen = [];

  const slider = fakeElement("input");
  const radios = { "axis-z": fakeElement("input") };
  radios["axis-z"].checked = true;
  const doc = {
    getElementById: (id) => ({ "slice-idx": slider, ...radios }[id] ?? null),
  };

  wireSliceControls(view, doc, () => seen.push(view.mesh.position.z));

  assert.ok(seen.length > 0);
  assert.ok(seen[0] > 0, "plane position was not set before the callback ran");
});

// --- absence of a callback --------------------------------------------------

test("omitting the callback is supported", () => {
  assert.doesNotThrow(() => rig({ withCallback: false }));
});

test("the controls behave identically without a callback", () => {
  const withCb = rig();
  const without = rig({ withCallback: false });

  withCb.slider.value = "4";
  withCb.slider.fire("input");
  without.slider.value = "4";
  without.slider.fire("input");

  assert.equal(withCb.controls.getAxis(), without.controls.getAxis());
  assert.equal(withCb.slider.max, without.slider.max);
});

test("a callback that throws is not swallowed", () => {
  // A broken contour rebuild should surface, not fail silently mid-drag.
  const sceneRoot = new THREE.Group();
  const view = createSliceView(meta(), volume(), sceneRoot);
  const slider = fakeElement("input");
  const radios = { "axis-z": fakeElement("input") };
  radios["axis-z"].checked = true;
  const doc = {
    getElementById: (id) => ({ "slice-idx": slider, ...radios }[id] ?? null),
  };

  assert.throws(() =>
    wireSliceControls(view, doc, () => {
      throw new Error("contour rebuild failed");
    }),
  );
});
