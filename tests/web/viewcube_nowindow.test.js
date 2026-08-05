// web/viewcube.js must import and initialise with no `window` at all.
//
// This file deliberately installs NO window stub — node runs each test file in
// its own process, so the stubs in the sibling viewcube tests cannot leak here.
// Without the globalThis.window?. guards this whole file throws.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { createViewCube, enableViewCubePicking } from "../../web/viewcube.js";

function fakeDocument() {
  const prior = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {}, strokeRect() {}, fillText() {},
        set font(_v) {}, get font() { return ""; },
      }),
    }),
  };
  return {
    restore() {
      if (prior === undefined) delete globalThis.document;
      else globalThis.document = prior;
    },
  };
}

function fakeRenderer() {
  const handlers = {};
  return {
    autoClear: true,
    domElement: {
      clientWidth: 1200,
      clientHeight: 800,
      addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
      setPointerCapture() {},
      releasePointerCapture() {},
    },
    handlers,
    fire(type, event) { for (const fn of handlers[type] ?? []) fn(event); },
    clearDepth() {}, setScissorTest() {}, setViewport() {},
    setScissor() {}, render() {},
  };
}

function build() {
  const doc = fakeDocument();
  let gizmo;
  let renderer;
  let camera;
  try {
    renderer = fakeRenderer();
    camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
    camera.position.set(0, 0, 60);
    gizmo = createViewCube(renderer, camera);
  } finally {
    doc.restore();
  }

  const controls = {
    target: new THREE.Vector3(),
    enabled: true,
    update() {},
  };
  const box = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(4.4, 4.4, 16.01));
  const picking = enableViewCubePicking(
    gizmo, renderer, camera, controls, () => box.clone(),
  );

  return { gizmo, renderer, camera, controls, picking };
}

test("there really is no window in this process", () => {
  // Guards the premise: if a stub ever leaks in, the tests below prove nothing.
  assert.equal(globalThis.window, undefined);
});

test("enableViewCubePicking initialises without a window", () => {
  assert.doesNotThrow(() => build());
});

test("the canvas-level listeners are still registered without a window", () => {
  const { renderer } = build();

  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    assert.ok(renderer.handlers[type]?.length > 0, `missing ${type}`);
  }
});

test("dragging works without the window-level safety net", () => {
  const { renderer, camera, gizmo, picking } = build();
  const rect = gizmo.getRect();
  const at = (dx, dy) => ({
    clientX: rect.left + rect.width / 2 + dx,
    clientY: rect.top + rect.height / 2 + dy,
    pointerId: 1,
    preventDefault() {},
    stopPropagation() {},
  });
  const before = camera.position.clone();

  renderer.fire("pointerdown", at(0, 0));
  renderer.fire("pointermove", at(40, 0));

  assert.equal(picking.isDragging(), true);
  assert.ok(!camera.position.equals(before));

  renderer.fire("pointerup", at(40, 0));
  assert.equal(picking.isDragging(), false);
});
