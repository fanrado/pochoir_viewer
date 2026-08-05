// Tests for web/viewcube.js — drag-to-orbit on the gizmo.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { createViewCube, enableViewCubePicking } from "../../web/viewcube.js";

const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

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

// viewcube.js registers pointerup/blur on the bare global `window`.
const windowHandlers = {};
globalThis.window = {
  addEventListener: (type, fn) => { (windowHandlers[type] ??= []).push(fn); },
};
const fireWindow = (type, event) => {
  for (const fn of windowHandlers[type] ?? []) fn(event);
};

// Some tests intentionally leave a drag in flight; a later window-level
// pointerup can then fire their endDrag -> goTo. Keep a no-op rAF installed so
// that is inert unless a test explicitly drives frames with fakeRaf().
globalThis.requestAnimationFrame = () => 0;

function fakeRaf() {
  const queue = [];
  const prior = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  return {
    pending: () => queue.length,
    tick(now) { for (const fn of queue.splice(0, queue.length)) fn(now); },
    runAll(ms = 400, frames = 8) {
      for (let i = 0; i <= frames && queue.length > 0; i++) this.tick((ms * i) / frames);
    },
    restore() {
      if (prior === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prior;
    },
  };
}

function fakeRenderer({ width = 1200, height = 800 } = {}) {
  const handlers = {};
  const capture = { captured: [], released: [], throwOnRelease: false };
  return {
    autoClear: true,
    capture,
    domElement: {
      clientWidth: width,
      clientHeight: height,
      addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
      setPointerCapture(id) { capture.captured.push(id); },
      releasePointerCapture(id) {
        if (capture.throwOnRelease) throw new Error("pointer already released");
        capture.released.push(id);
      },
    },
    fire(type, event) { for (const fn of handlers[type] ?? []) fn(event); },
    clearDepth() {}, setScissorTest() {}, setViewport() {},
    setScissor() {}, render() {},
  };
}

function rig({ width = 1200, height = 800 } = {}) {
  const doc = fakeDocument();
  let gizmo;
  let renderer;
  let mainCamera;
  try {
    renderer = fakeRenderer({ width, height });
    mainCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    mainCamera.position.set(0, 0, 60);
    gizmo = createViewCube(renderer, mainCamera);
  } finally {
    doc.restore();
  }

  let updates = 0;
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    enabled: true,
    update: () => { updates += 1; },
    get updateCount() { return updates; },
  };

  const box = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(4.4, 4.4, 16.01));
  const picking = enableViewCubePicking(
    gizmo, renderer, mainCamera, controls, () => box.clone(),
  );

  const rect = gizmo.getRect();
  const at = (dx = 0, dy = 0, pointerId = 1) => ({
    clientX: rect.left + rect.width / 2 + dx,
    clientY: rect.top + rect.height / 2 + dy,
    pointerId,
    preventDefault() {},
    stopPropagation() {},
  });

  return { gizmo, renderer, mainCamera, controls, picking, at };
}

// --- click vs drag ----------------------------------------------------------

test("a press with no movement is honoured as a click on release", () => {
  const raf = fakeRaf();
  try {
    const { renderer, mainCamera, at } = rig();
    const before = mainCamera.position.clone();

    renderer.fire("pointerdown", at());
    renderer.fire("pointerup", at());
    raf.runAll();

    assert.ok(!mainCamera.position.equals(before), "click did not navigate");
  } finally {
    raf.restore();
  }
});

test("movement under the threshold still counts as a click", () => {
  // 3 px of hand tremor must not turn a click into an orbit.
  const raf = fakeRaf();
  try {
    const { renderer, mainCamera, at } = rig();
    const before = mainCamera.position.clone();

    renderer.fire("pointerdown", at());
    renderer.fire("pointermove", at(2, 2)); // hypot ~2.83 < 4
    assert.ok(mainCamera.position.equals(before), "orbited below threshold");

    renderer.fire("pointerup", at(2, 2));
    raf.runAll();

    assert.ok(!mainCamera.position.equals(before), "click was swallowed");
  } finally {
    raf.restore();
  }
});

test("movement past the threshold orbits instead of navigating", () => {
  const raf = fakeRaf();
  try {
    const { renderer, mainCamera, at } = rig();
    const before = mainCamera.position.clone();

    renderer.fire("pointerdown", at());
    renderer.fire("pointermove", at(40, 0));
    const afterDrag = mainCamera.position.clone();

    assert.ok(!afterDrag.equals(before), "drag did not orbit");

    renderer.fire("pointerup", at(40, 0));
    raf.runAll();

    // No canonical-view glide was scheduled, so the position is unchanged.
    assert.ok(mainCamera.position.equals(afterDrag), "drag also navigated");
  } finally {
    raf.restore();
  }
});

test("isDragging reports the gesture state", () => {
  const { renderer, picking, at } = rig();

  assert.equal(picking.isDragging(), false);
  renderer.fire("pointerdown", at());
  assert.equal(picking.isDragging(), false, "press alone is not a drag");

  renderer.fire("pointermove", at(40, 0));
  assert.equal(picking.isDragging(), true);

  renderer.fire("pointerup", at(40, 0));
  assert.equal(picking.isDragging(), false);
});

test("a press outside the gizmo starts no drag", () => {
  const { renderer, mainCamera, picking } = rig();
  const before = mainCamera.position.clone();

  renderer.fire("pointerdown", { clientX: 5, clientY: 500, pointerId: 1, preventDefault() {}, stopPropagation() {} });
  renderer.fire("pointermove", { clientX: 200, clientY: 500, pointerId: 1 });

  assert.equal(picking.isDragging(), false);
  assert.ok(mainCamera.position.equals(before));
});

// --- orbit mechanics --------------------------------------------------------

test("dragging preserves camera distance from the target", () => {
  const { renderer, mainCamera, controls, at } = rig();
  const before = mainCamera.position.distanceTo(controls.target);

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(50, 30));

  assert.ok(close(mainCamera.position.distanceTo(controls.target), before, 1e-6));
});

test("dragging never moves the orbit target", () => {
  const { renderer, controls, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(50, 30));

  assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
});

test("horizontal and vertical drags rotate about different axes", () => {
  const horizontal = rig();
  horizontal.renderer.fire("pointerdown", horizontal.at());
  horizontal.renderer.fire("pointermove", horizontal.at(40, 0));

  const vertical = rig();
  vertical.renderer.fire("pointerdown", vertical.at());
  vertical.renderer.fire("pointermove", vertical.at(0, 40));

  assert.ok(
    !close(
      horizontal.mainCamera.position.distanceTo(vertical.mainCamera.position),
      0,
      1e-3,
    ),
  );
});

test("opposite horizontal drags are inverses of each other", () => {
  const { renderer, mainCamera, at } = rig();
  const before = mainCamera.position.clone();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(30, 0));
  renderer.fire("pointermove", at(0, 0)); // back to the start

  assert.ok(mainCamera.position.distanceTo(before) < 1e-6);
});

test("the pole is clamped so the view never flips", () => {
  // phi is clamped to (0, PI); without it a big vertical drag inverts the view.
  const { renderer, mainCamera, controls, at } = rig();

  renderer.fire("pointerdown", at());
  for (let i = 1; i <= 20; i++) renderer.fire("pointermove", at(0, -60 * i));

  const offset = mainCamera.position.clone().sub(controls.target);
  const phi = Math.acos(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1));
  assert.ok(phi > 0 && phi < Math.PI, `phi escaped to ${phi}`);
  assert.ok(Number.isFinite(mainCamera.position.x));
});

test("dragging keeps the camera aimed at the target", () => {
  const { renderer, mainCamera, controls, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(35, 25));

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCamera.quaternion);
  const toTarget = controls.target.clone().sub(mainCamera.position).normalize();
  assert.ok(close(forward.dot(toTarget), 1, 1e-5));
});

test("each drag frame calls controls.update", () => {
  const { renderer, controls, at } = rig();

  renderer.fire("pointerdown", at());
  const before = controls.updateCount;
  renderer.fire("pointermove", at(20, 0));
  renderer.fire("pointermove", at(40, 0));

  assert.equal(controls.updateCount, before + 2);
});

test("drag is incremental: two half drags equal one whole", () => {
  const oneStep = rig();
  oneStep.renderer.fire("pointerdown", oneStep.at());
  oneStep.renderer.fire("pointermove", oneStep.at(40, 0));

  const twoSteps = rig();
  twoSteps.renderer.fire("pointerdown", twoSteps.at());
  twoSteps.renderer.fire("pointermove", twoSteps.at(20, 0));
  twoSteps.renderer.fire("pointermove", twoSteps.at(40, 0));

  assert.ok(
    oneStep.mainCamera.position.distanceTo(twoSteps.mainCamera.position) < 1e-6,
  );
});

// --- OrbitControls muting ---------------------------------------------------

test("controls are disabled for the duration of the gesture", () => {
  // OrbitControls listens on the same element and registered first, so it must
  // be muted or a gizmo drag would orbit the camera twice.
  const { renderer, controls, at } = rig();

  renderer.fire("pointerdown", at());
  assert.equal(controls.enabled, false);

  renderer.fire("pointerup", at());
  assert.equal(controls.enabled, true);
});

test("controls are restored to their prior state, not forced on", () => {
  const { renderer, controls, at } = rig();
  controls.enabled = false; // already disabled by something else

  renderer.fire("pointerdown", at());
  renderer.fire("pointerup", at());

  assert.equal(controls.enabled, false);
});

test("controls are restored after a drag, not only after a click", () => {
  const { renderer, controls, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  renderer.fire("pointerup", at(40, 0));

  assert.equal(controls.enabled, true);
});

test("pointerdown claims the gesture from OrbitControls", () => {
  const { renderer, gizmo } = rig();
  const rect = gizmo.getRect();
  let prevented = 0;
  let stopped = 0;

  renderer.fire("pointerdown", {
    clientX: rect.left + 5,
    clientY: rect.top + 5,
    pointerId: 1,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  });

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

// --- pointer capture and stranded drags -------------------------------------

test("the pointer is captured on press and released on end", () => {
  const { renderer, at } = rig();

  renderer.fire("pointerdown", at(0, 0, 7));
  assert.deepEqual(renderer.capture.captured, [7]);

  renderer.fire("pointerup", at(0, 0, 7));
  assert.deepEqual(renderer.capture.released, [7]);
});

test("a release that throws does not strand the drag", () => {
  // releasePointerCapture throws if capture was already lost.
  const { renderer, controls, picking, at } = rig();
  renderer.capture.throwOnRelease = true;

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  renderer.fire("pointerup", at(40, 0));

  assert.equal(picking.isDragging(), false);
  assert.equal(controls.enabled, true);
});

test("pointercancel ends the drag", () => {
  const { renderer, controls, picking, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  renderer.fire("pointercancel", at(40, 0));

  assert.equal(picking.isDragging(), false);
  assert.equal(controls.enabled, true);
});

test("a pointerup outside the window ends the drag", () => {
  // The window-level listener is the safety net for releasing off-canvas.
  const { renderer, controls, picking, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  fireWindow("pointerup", at(40, 0));

  assert.equal(picking.isDragging(), false);
  assert.equal(controls.enabled, true);
});

test("losing window focus ends the drag", () => {
  const { renderer, controls, picking, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  fireWindow("blur", {});

  assert.equal(picking.isDragging(), false);
  assert.equal(controls.enabled, true);
});

test("a second pointer does not hijack an active drag", () => {
  const { renderer, mainCamera, at } = rig();

  renderer.fire("pointerdown", at(0, 0, 1));
  renderer.fire("pointermove", at(40, 0, 1));
  const afterFirst = mainCamera.position.clone();

  renderer.fire("pointermove", at(200, 200, 2)); // a different pointerId

  assert.ok(mainCamera.position.equals(afterFirst));
});

test("moves after the drag ends are ignored", () => {
  const { renderer, mainCamera, at } = rig();

  renderer.fire("pointerdown", at());
  renderer.fire("pointermove", at(40, 0));
  renderer.fire("pointerup", at(40, 0));
  const settled = mainCamera.position.clone();

  renderer.fire("pointermove", at(200, 0));

  assert.ok(mainCamera.position.equals(settled));
});

test("a stray pointerup with no drag in flight is harmless", () => {
  const { renderer, controls, at } = rig();

  renderer.fire("pointerup", at());
  fireWindow("blur", {});

  assert.equal(controls.enabled, true);
});
