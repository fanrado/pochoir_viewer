// Tests for web/nav.js — the orbit pivot marker.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { createPivot, updatePivot } from "../../web/nav.js";

/** A camera/controls pair standing in for the viewer's real ones. */
function rig({ fov = 50, distance = 100, target = [0, 0, 0], heightPx = 800 } = {}) {
  const camera = new THREE.PerspectiveCamera(fov, 1.5, 0.1, 2000);
  const controls = {
    target: new THREE.Vector3(...target),
    domElement: { clientHeight: heightPx },
  };
  camera.position.copy(controls.target).add(new THREE.Vector3(0, 0, distance));
  return { camera, controls };
}

/** World units per screen pixel at `distance`, the quantity the scale encodes. */
function worldPerPixel(fov, distance, heightPx) {
  return (distance * 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / heightPx;
}

const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- createPivot ------------------------------------------------------------

test("createPivot adds a named mesh to the scene", () => {
  const scene = new THREE.Scene();

  const pivot = createPivot(scene);

  assert.equal(pivot.name, "pivot");
  assert.ok(scene.children.includes(pivot));
});

test("pivot is parented to the scene, not to sceneRoot", () => {
  // sceneRoot carries the z-compression; parenting there would squash the
  // sphere into an ellipsoid.
  const scene = new THREE.Scene();
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);

  const pivot = createPivot(scene);

  assert.equal(pivot.parent, scene);
  assert.equal(sceneRoot.children.length, 0);
});

test("pivot geometry is a unit-radius sphere", () => {
  // updatePivot's scale factor is only meaningful if the radius is exactly 1.
  const pivot = createPivot(new THREE.Scene());

  assert.equal(pivot.geometry.parameters.radius, 1);
});

test("pivot ignores depth so it is never lost inside the boundary planes", () => {
  const pivot = createPivot(new THREE.Scene());

  assert.equal(pivot.material.depthTest, false);
  assert.ok(pivot.renderOrder > 0);
});

test("pivot material is unlit, so it reads the same from every angle", () => {
  const pivot = createPivot(new THREE.Scene());

  assert.ok(pivot.material instanceof THREE.MeshBasicMaterial);
  assert.equal(pivot.material.color.getHex(), 0xffcc00);
});

test("createPivot returns a distinct mesh on each call", () => {
  const scene = new THREE.Scene();

  const a = createPivot(scene);
  const b = createPivot(scene);

  assert.notEqual(a, b);
  assert.equal(scene.children.length, 2);
});

// --- updatePivot: position --------------------------------------------------

test("updatePivot parks the pivot on controls.target", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig({ target: [2.2, 2.2, 80.05] });

  updatePivot(pivot, camera, controls);

  assert.ok(pivot.position.equals(controls.target));
});

test("updatePivot follows the target when pan moves it", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig();

  updatePivot(pivot, camera, controls);
  controls.target.set(1, -2, 3);
  updatePivot(pivot, camera, controls);

  assert.deepEqual(pivot.position.toArray(), [1, -2, 3]);
});

test("updatePivot copies the target rather than aliasing it", () => {
  // Sharing the Vector3 would make a pivot move drag the orbit centre with it.
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig();

  updatePivot(pivot, camera, controls);
  pivot.position.set(9, 9, 9);

  assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
});

// --- updatePivot: constant apparent size ------------------------------------

test("scale equals the world size of one pixel times the pixel constant", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig({ fov: 50, distance: 100, heightPx: 800 });

  updatePivot(pivot, camera, controls);

  // PIVOT_PX is private; recover it and check it is the documented magnitude.
  const px = pivot.scale.x / worldPerPixel(50, 100, 800);
  assert.ok(close(px, Math.round(px), 1e-6));
  assert.ok(px > 0 && px < 50, `implausible pixel size ${px}`);
});

test("scale is uniform on all three axes", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig();

  updatePivot(pivot, camera, controls);

  assert.ok(close(pivot.scale.x, pivot.scale.y));
  assert.ok(close(pivot.scale.y, pivot.scale.z));
});

test("scale grows in proportion to camera distance", () => {
  // This is the whole point: apparent size stays fixed as you zoom.
  const pivot = createPivot(new THREE.Scene());

  const near = rig({ distance: 50 });
  updatePivot(pivot, near.camera, near.controls);
  const scaleNear = pivot.scale.x;

  const far = rig({ distance: 200 });
  updatePivot(pivot, far.camera, far.controls);
  const scaleFar = pivot.scale.x;

  assert.ok(close(scaleFar / scaleNear, 4, 1e-6));
});

test("apparent pixel size is invariant across zoom levels", () => {
  const pivot = createPivot(new THREE.Scene());

  const sizes = [10, 100, 1000].map((distance) => {
    const { camera, controls } = rig({ distance });
    updatePivot(pivot, camera, controls);
    return pivot.scale.x / worldPerPixel(50, distance, 800);
  });

  assert.ok(close(sizes[0], sizes[1], 1e-6));
  assert.ok(close(sizes[1], sizes[2], 1e-6));
});

test("scale shrinks as the viewport gets taller in pixels", () => {
  const pivot = createPivot(new THREE.Scene());

  const short = rig({ heightPx: 400 });
  updatePivot(pivot, short.camera, short.controls);
  const scaleShort = pivot.scale.x;

  const tall = rig({ heightPx: 1600 });
  updatePivot(pivot, tall.camera, tall.controls);
  const scaleTall = pivot.scale.x;

  assert.ok(close(scaleShort / scaleTall, 4, 1e-6));
});

test("scale tracks the camera field of view", () => {
  const pivot = createPivot(new THREE.Scene());

  const narrow = rig({ fov: 25 });
  updatePivot(pivot, narrow.camera, narrow.controls);
  const scaleNarrow = pivot.scale.x;

  const wide = rig({ fov: 50 });
  updatePivot(pivot, wide.camera, wide.controls);
  const scaleWide = pivot.scale.x;

  const expected =
    Math.tan(THREE.MathUtils.degToRad(50) / 2) / Math.tan(THREE.MathUtils.degToRad(25) / 2);
  assert.ok(close(scaleWide / scaleNarrow, expected, 1e-6));
});

test("scale is measured from the target, not from the world origin", () => {
  const pivot = createPivot(new THREE.Scene());

  const atOrigin = rig({ distance: 100, target: [0, 0, 0] });
  updatePivot(pivot, atOrigin.camera, atOrigin.controls);
  const scaleOrigin = pivot.scale.x;

  const offset = rig({ distance: 100, target: [500, 500, 500] });
  updatePivot(pivot, offset.camera, offset.controls);

  assert.ok(close(pivot.scale.x, scaleOrigin, 1e-6));
});

// --- updatePivot: degenerate inputs -----------------------------------------

test("a camera sitting on the target collapses the pivot rather than exploding", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig({ distance: 0 });

  updatePivot(pivot, camera, controls);

  assert.equal(pivot.scale.x, 0);
});

test("updatePivot is idempotent for a fixed rig", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig();

  updatePivot(pivot, camera, controls);
  const first = pivot.scale.x;
  updatePivot(pivot, camera, controls);

  assert.equal(pivot.scale.x, first);
});

test("a zero-height canvas falls back to the window height", () => {
  // clientHeight is 0 before layout; dividing by it would give a NaN scale.
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig({ heightPx: 800 });
  controls.domElement = { clientHeight: 0 };

  const priorWindow = globalThis.window;
  globalThis.window = { innerHeight: 800 };
  try {
    updatePivot(pivot, camera, controls);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }

  assert.ok(Number.isFinite(pivot.scale.x));
  assert.ok(close(pivot.scale.x, worldPerPixel(50, 100, 800) * 6, 1e-6));
});

test("a missing domElement falls back to the window height", () => {
  const pivot = createPivot(new THREE.Scene());
  const { camera, controls } = rig();
  delete controls.domElement;

  const priorWindow = globalThis.window;
  globalThis.window = { innerHeight: 800 };
  try {
    updatePivot(pivot, camera, controls);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }

  assert.ok(Number.isFinite(pivot.scale.x));
});
