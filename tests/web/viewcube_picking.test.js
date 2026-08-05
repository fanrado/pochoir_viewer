// Tests for web/viewcube.js — fitDistance and enableViewCubePicking.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  createViewCube,
  enableViewCubePicking,
  fitDistance,
} from "../../web/viewcube.js";

const SIZE_PX = 96;
const INSET_PX = 12;
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

/** A renderer stub whose domElement records event listeners. */
function fakeRenderer({ width = 1200, height = 800 } = {}) {
  const handlers = {};
  const captureLog = { captured: [], released: [] };
  return {
    autoClear: true,
    domElement: {
      clientWidth: width,
      clientHeight: height,
      addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
      setPointerCapture(id) { captureLog.captured.push(id); },
      releasePointerCapture(id) { captureLog.released.push(id); },
    },
    handlers,
    fire(type, event) { for (const fn of handlers[type] ?? []) fn(event); },
    captureLog,
    clearDepth() {}, setScissorTest() {}, setViewport() {},
    setScissor() {}, render() {},
  };
}

/**
 * viewcube.js registers pointerup/blur on the bare global `window`, so one
 * must exist for the whole file. Handlers accumulate across rigs, which is
 * harmless: each endDrag closure returns early when its own drag is null.
 */
const windowHandlers = {};
globalThis.window = {
  addEventListener: (type, fn) => { (windowHandlers[type] ??= []).push(fn); },
};
const fireWindow = (type, event) => {
  for (const fn of windowHandlers[type] ?? []) fn(event);
};

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

/** The reference domain, compressed in z the way sceneRoot compresses it. */
function domainBox(zScale = 0.1) {
  return new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(4.4, 4.4, 160.1 * zScale),
  );
}

function rig({ width = 1200, height = 800, zScale = 0.1, target = [2.2, 2.2, 8] } = {}) {
  const doc = fakeDocument();
  let gizmo;
  let renderer;
  try {
    renderer = fakeRenderer({ width, height });
    var mainCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    mainCamera.position.set(50, 50, 50);
    gizmo = createViewCube(renderer, mainCamera);
  } finally {
    doc.restore();
  }

  let updates = 0;
  const controls = {
    target: new THREE.Vector3(...target),
    enabled: true,
    update: () => { updates += 1; },
    get updateCount() { return updates; },
  };

  const box = domainBox(zScale);
  const picking = enableViewCubePicking(
    gizmo, renderer, mainCamera, controls, () => box.clone(),
  );

  /** A full click: press and release without moving. */
  const click = (event) => {
    renderer.fire("pointerdown", { pointerId: 1, preventDefault() {}, stopPropagation() {}, ...event });
    renderer.fire("pointerup", { pointerId: 1, ...event });
  };

  return { gizmo, renderer, mainCamera, controls, picking, box, click };
}

/** A pointer event at the centre of the gizmo rect. */
function centreEvent(gizmo) {
  const rect = gizmo.getRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    pointerId: 1,
    preventDefault() {},
    stopPropagation() {},
  };
}

// --- fitDistance ------------------------------------------------------------

test("fitDistance grows with the extent it must frame", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const small = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const large = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(10, 10, 10));

  const dir = new THREE.Vector3(0, 0, 1);
  assert.ok(fitDistance(large, dir, camera) > fitDistance(small, dir, camera));
});

test("fitDistance scales linearly with box size", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const dir = new THREE.Vector3(0, 0, 1);

  const one = fitDistance(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)), dir, camera);
  const three = fitDistance(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(3, 3, 3)), dir, camera);

  assert.ok(close(three / one, 3, 1e-6));
});

test("a +Z view of the needle is much closer than a +X view", () => {
  // Down the drift axis the pad plane is 4.4 x 4.4; from the side the slab is
  // 4.4 x 16.0. The side view must back off further.
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const box = domainBox(0.1);

  const alongZ = fitDistance(box, new THREE.Vector3(0, 0, 1), camera);
  const alongX = fitDistance(box, new THREE.Vector3(1, 0, 0), camera);

  assert.ok(alongX > alongZ, `${alongX} should exceed ${alongZ}`);
});

test("fitDistance responds to the z compression in force", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const dir = new THREE.Vector3(1, 0, 0);

  const compressed = fitDistance(domainBox(0.1), dir, camera);
  const trueScale = fitDistance(domainBox(1), dir, camera);

  assert.ok(trueScale > compressed * 5, "true scale needs a far longer pull-back");
});

test("fitDistance widens as the field of view narrows", () => {
  const box = domainBox(0.1);
  const dir = new THREE.Vector3(0, 0, 1);

  const wide = fitDistance(box, dir, new THREE.PerspectiveCamera(60, 1.5, 0.1, 2000));
  const narrow = fitDistance(box, dir, new THREE.PerspectiveCamera(20, 1.5, 0.1, 2000));

  assert.ok(narrow > wide);
});

test("fitDistance accounts for aspect ratio on a wide viewport", () => {
  const box = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(10, 1, 1));
  const dir = new THREE.Vector3(0, 0, 1);

  const wide = fitDistance(box, dir, new THREE.PerspectiveCamera(50, 3.0, 0.1, 2000));
  const square = fitDistance(box, dir, new THREE.PerspectiveCamera(50, 1.0, 0.1, 2000));

  assert.ok(square > wide, "a narrow viewport must back off further");
});

test("fitDistance includes a margin beyond an exact fit", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.0, 0.1, 2000);
  const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));

  const withMargin = fitDistance(box, new THREE.Vector3(0, 0, 1), camera);
  const exact = fitDistance(box, new THREE.Vector3(0, 0, 1), camera, 1.0);

  assert.ok(withMargin > exact);
  assert.ok(close(withMargin / exact, 1.06, 1e-9));
});

test("fitDistance is positive for every cube direction", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const box = domainBox(0.1);

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const dir = new THREE.Vector3(x, y, z).normalize();
        const d = fitDistance(box, dir, camera);
        assert.ok(Number.isFinite(d) && d > 0, `dir ${x},${y},${z} gave ${d}`);
      }
    }
  }
});

test("fitDistance handles the degenerate +Z up-vector case", () => {
  // dir parallel to the default up would make the cross product zero.
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const box = domainBox(0.1);

  for (const dir of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
    const d = fitDistance(box, dir, camera);
    assert.ok(Number.isFinite(d) && d > 0);
  }
});

test("fitDistance is independent of where the box sits", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  const dir = new THREE.Vector3(0, 0, 1);
  const atOrigin = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
  const shifted = new THREE.Box3(new THREE.Vector3(100, 100, 100), new THREE.Vector3(102, 102, 102));

  assert.ok(close(fitDistance(shifted, dir, camera), fitDistance(atOrigin, dir, camera), 1e-9));
});

// --- pointer mapping --------------------------------------------------------

test("clicks outside the gizmo rect are ignored", () => {
  const { click, mainCamera } = rig();
  const before = mainCamera.position.clone();

  click({ clientX: 10, clientY: 400 }); // main canvas

  assert.ok(mainCamera.position.equals(before));
});

test("insideRect accepts the corner inset region and rejects the rest", () => {
  const { picking, gizmo } = rig({ width: 1200, height: 800 });
  const rect = gizmo.getRect();

  assert.ok(picking.insideRect({ clientX: rect.left + 1, clientY: rect.top + 1 }));
  assert.ok(picking.insideRect(centreEvent(gizmo)));
  assert.ok(!picking.insideRect({ clientX: rect.left - 1, clientY: rect.top + 1 }));
  assert.ok(!picking.insideRect({ clientX: rect.left + 1, clientY: rect.top + rect.height + 1 }));
});

test("insideRect uses CSS top, not the GL viewport y", () => {
  // The rect carries both; picking against y would put the hot zone at the
  // bottom of the screen.
  const { picking, gizmo } = rig({ width: 1200, height: 800 });
  const rect = gizmo.getRect();

  assert.ok(picking.insideRect({ clientX: rect.x + 5, clientY: INSET_PX + 5 }));
  assert.ok(!picking.insideRect({ clientX: rect.x + 5, clientY: rect.y + 5 }));
});

test("a click at the gizmo centre hits a pickable and moves the camera", () => {
  const raf = fakeRaf();
  try {
    const { click, mainCamera, gizmo } = rig();
    const before = mainCamera.position.clone();

    click(centreEvent(gizmo));
    raf.runAll();

    assert.ok(!mainCamera.position.equals(before), "camera did not move");
  } finally {
    raf.restore();
  }
});

test("the gizmo rect follows a resize, and picking follows with it", () => {
  const { picking, gizmo, renderer } = rig({ width: 1200, height: 800 });
  const oldCentre = centreEvent(gizmo);

  renderer.domElement.clientWidth = 600;
  gizmo.onResize();

  assert.ok(!picking.insideRect(oldCentre), "stale hot zone still active");
  assert.ok(picking.insideRect(centreEvent(gizmo)));
});

// --- highlight --------------------------------------------------------------

test("hovering a face tints its material and leaves the others alone", () => {
  const { renderer, gizmo } = rig();

  renderer.fire("pointermove", centreEvent(gizmo));

  const tinted = gizmo.materials.filter((m) => m.color.getHex() !== 0xffffff);
  assert.ok(tinted.length <= 1, "more than one face highlighted");
});

test("leaving the gizmo clears any highlight", () => {
  const { renderer, gizmo } = rig();

  renderer.fire("pointermove", centreEvent(gizmo));
  renderer.fire("pointerleave", {});

  for (const material of gizmo.materials) {
    assert.equal(material.color.getHex(), 0xffffff);
  }
});

test("moving onto the main canvas clears the highlight", () => {
  const { renderer, gizmo } = rig();

  renderer.fire("pointermove", centreEvent(gizmo));
  renderer.fire("pointermove", { clientX: 5, clientY: 500 });

  for (const material of gizmo.materials) {
    assert.equal(material.color.getHex(), 0xffffff);
  }
});

// --- goTo -------------------------------------------------------------------

test("goTo leaves the orbit target where it was", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls } = rig({ target: [2.2, 2.2, 8] });

    picking.goTo(new THREE.Vector3(0, 0, 1));
    raf.runAll();

    assert.deepEqual(controls.target.toArray(), [2.2, 2.2, 8]);
  } finally {
    raf.restore();
  }
});

test("goTo lands the camera on the requested axis through the target", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls, mainCamera } = rig({ target: [2.2, 2.2, 8] });

    picking.goTo(new THREE.Vector3(0, 0, 1));
    raf.runAll();

    const offset = mainCamera.position.clone().sub(controls.target);
    assert.ok(close(offset.x, 0, 1e-4));
    assert.ok(close(offset.y, 0, 1e-4));
    assert.ok(offset.z > 0);
  } finally {
    raf.restore();
  }
});

test("goTo puts the camera at the fitted distance", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls, mainCamera, box } = rig();
    const dir = new THREE.Vector3(1, 0, 0);

    picking.goTo(dir);
    raf.runAll();

    const expected = fitDistance(box, dir, mainCamera);
    assert.ok(close(mainCamera.position.distanceTo(controls.target), expected, 1e-3));
  } finally {
    raf.restore();
  }
});

test("goTo aims the camera back at the target", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls, mainCamera } = rig();

    picking.goTo(new THREE.Vector3(1, 1, 1).normalize());
    raf.runAll();

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCamera.quaternion);
    const toTarget = controls.target.clone().sub(mainCamera.position).normalize();
    assert.ok(close(forward.dot(toTarget), 1, 1e-4));
  } finally {
    raf.restore();
  }
});

test("goTo animates rather than teleporting", () => {
  const raf = fakeRaf();
  try {
    const { picking, mainCamera } = rig();
    const before = mainCamera.position.clone();

    picking.goTo(new THREE.Vector3(0, 0, 1));

    assert.ok(mainCamera.position.equals(before), "moved before the first frame");
    assert.ok(raf.pending() > 0);
  } finally {
    raf.restore();
  }
});

test("goTo drives controls.update every frame and stops when done", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls } = rig();

    picking.goTo(new THREE.Vector3(0, 0, 1), 400);
    raf.tick(0);
    const afterFirst = controls.updateCount;
    raf.tick(400);

    assert.equal(afterFirst, 1);
    assert.ok(controls.updateCount > afterFirst);
    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test("goTo with ms=0 completes on the first frame", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls, mainCamera, box } = rig();
    const dir = new THREE.Vector3(0, 1, 0);

    picking.goTo(dir, 0);
    raf.tick(0);

    const expected = fitDistance(box, dir, mainCamera);
    assert.ok(close(mainCamera.position.distanceTo(controls.target), expected, 1e-3));
    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test("a large first timestamp does not skip the animation", () => {
  const raf = fakeRaf();
  try {
    const { picking, mainCamera } = rig();
    const before = mainCamera.position.clone();

    picking.goTo(new THREE.Vector3(0, 0, 1), 400);
    raf.tick(90_000);

    assert.ok(mainCamera.position.distanceTo(before) < 1e-6, "jumped on frame one");
    assert.ok(raf.pending() > 0);
  } finally {
    raf.restore();
  }
});

test("opposite faces land on opposite sides of the target", () => {
  const raf = fakeRaf();
  try {
    const { picking, controls, mainCamera } = rig();

    picking.goTo(new THREE.Vector3(0, 0, 1));
    raf.runAll();
    const plus = mainCamera.position.clone().sub(controls.target);

    picking.goTo(new THREE.Vector3(0, 0, -1));
    raf.runAll();
    const minus = mainCamera.position.clone().sub(controls.target);

    assert.ok(close(plus.clone().normalize().dot(minus.clone().normalize()), -1, 1e-4));
  } finally {
    raf.restore();
  }
});

test("goTo re-reads the box each time, so it tracks the current z scale", () => {
  const raf = fakeRaf();
  try {
    const doc = fakeDocument();
    let gizmo;
    let renderer;
    try {
      renderer = fakeRenderer();
      var camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
      gizmo = createViewCube(renderer, camera);
    } finally {
      doc.restore();
    }
    const controls = { target: new THREE.Vector3(), update() {} };

    let zScale = 0.1;
    const picking = enableViewCubePicking(
      gizmo, renderer, camera, controls, () => domainBox(zScale),
    );

    const dir = new THREE.Vector3(1, 0, 0);
    picking.goTo(dir, 0);
    raf.tick(0);
    const compressed = camera.position.distanceTo(controls.target);

    zScale = 1; // user clicks "x1 (true scale)"
    picking.goTo(dir, 0);
    raf.tick(0);
    const trueScale = camera.position.distanceTo(controls.target);

    assert.ok(trueScale > compressed * 5, "did not re-read the scaled box");
  } finally {
    raf.restore();
  }
});
