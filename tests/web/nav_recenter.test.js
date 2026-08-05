// Tests for web/nav.js — pivot readout in true mm, and the recenter glide.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { recenterOn, updatePivotReadout } from "../../web/nav.js";

/** A controls/camera pair plus a sceneRoot carrying the z compression. */
function rig({ target = [0, 0, 0], cameraAt = [0, 0, 100], zScale = 1 } = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  camera.position.set(...cameraAt);

  let updates = 0;
  const controls = {
    target: new THREE.Vector3(...target),
    domElement: { clientHeight: 800 },
    update: () => { updates += 1; },
    get updateCount() { return updates; },
  };

  const sceneRoot = new THREE.Group();
  sceneRoot.scale.z = zScale;

  return { camera, controls, sceneRoot };
}

/**
 * Drive requestAnimationFrame deterministically.
 *
 * Returns { flush } which runs queued frames at explicit timestamps, so the
 * glide can be stepped without real time passing.
 */
function fakeRaf() {
  const queue = [];
  const prior = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };

  return {
    pending: () => queue.length,
    /** Run every currently-queued callback at `now` (ms). */
    tick(now) {
      const due = queue.splice(0, queue.length);
      for (const fn of due) fn(now);
      return due.length;
    },
    restore() {
      if (prior === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prior;
    },
  };
}

/** Run a glide to completion, returning the timestamps used. */
function runGlide(raf, { start = 0, ms = 300, frames = 6 } = {}) {
  const stamps = [];
  for (let i = 0; i <= frames && raf.pending() > 0; i++) {
    const now = start + (ms * i) / frames;
    stamps.push(now);
    raf.tick(now);
  }
  return stamps;
}

const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// --- updatePivotReadout -----------------------------------------------------

test("readout divides z back out of compressed scene space", () => {
  // The cathode at true z=160.1 sits at scene z=16.01 when compressed x10.
  const { controls, sceneRoot } = rig({ target: [2.2, 2.2, 16.01], zScale: 0.1 });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /160\.10/);
  assert.doesNotMatch(element.textContent, /16\.01/);
});

test("readout leaves z alone at true scale", () => {
  const { controls, sceneRoot } = rig({ target: [1, 2, 160.1], zScale: 1 });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /160\.10/);
});

test("readout never scales x or y", () => {
  // Only z is compressed; scaling x/y would misreport transverse position.
  const { controls, sceneRoot } = rig({ target: [1.25, 3.75, 5], zScale: 0.1 });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /1\.25/);
  assert.match(element.textContent, /3\.75/);
});

test("readout reports two decimals and the mm unit", () => {
  const { controls, sceneRoot } = rig({ target: [0, 0, 0] });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /pivot \(0\.00, 0\.00, 0\.00\) mm/);
});

test("readout states how to move the pivot", () => {
  const { controls, sceneRoot } = rig();
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /double-click/i);
});

test("readout handles negative coordinates", () => {
  const { controls, sceneRoot } = rig({ target: [-1.5, -2.5, -3], zScale: 0.5 });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.match(element.textContent, /-1\.50/);
  assert.match(element.textContent, /-6\.00/); // -3 / 0.5
});

test("readout is a pure write: it does not move the target", () => {
  const { controls, sceneRoot } = rig({ target: [1, 2, 3], zScale: 0.1 });
  const element = { textContent: "" };

  updatePivotReadout(element, controls, sceneRoot);

  assert.deepEqual(controls.target.toArray(), [1, 2, 3]);
});

// --- recenterOn: the view-preserving invariant ------------------------------

test("recenterOn lands the target exactly on the requested point", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(5, -3, 20), camera, controls);
    runGlide(raf);

    assert.ok(close(controls.target.x, 5));
    assert.ok(close(controls.target.y, -3));
    assert.ok(close(controls.target.z, 20));
  } finally {
    raf.restore();
  }
});

test("recenterOn preserves the camera-to-target offset on every frame", () => {
  // This is the promise in the docstring: only the pivot moves, not the view.
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig({ cameraAt: [10, 20, 100] });
    const before = camera.position.clone().sub(controls.target);

    recenterOn(new THREE.Vector3(4, 4, 80), camera, controls);

    let frames = 0;
    while (raf.pending() > 0 && frames < 20) {
      raf.tick((300 * frames) / 6);
      frames += 1;
      const offset = camera.position.clone().sub(controls.target);
      assert.ok(close(offset.x, before.x, 1e-4), `frame ${frames} x`);
      assert.ok(close(offset.y, before.y, 1e-4), `frame ${frames} y`);
      assert.ok(close(offset.z, before.z, 1e-4), `frame ${frames} z`);
    }
    assert.ok(frames > 1, "glide should span multiple frames");
  } finally {
    raf.restore();
  }
});

test("recenterOn preserves camera distance and view direction", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig({ cameraAt: [0, 0, 100] });
    const distanceBefore = camera.position.distanceTo(controls.target);
    const directionBefore = camera.position.clone().sub(controls.target).normalize();

    recenterOn(new THREE.Vector3(2, 2, 50), camera, controls);
    runGlide(raf);

    const distanceAfter = camera.position.distanceTo(controls.target);
    const directionAfter = camera.position.clone().sub(controls.target).normalize();

    assert.ok(close(distanceAfter, distanceBefore, 1e-4));
    assert.ok(close(directionAfter.dot(directionBefore), 1, 1e-6));
  } finally {
    raf.restore();
  }
});

test("the camera translates by exactly the target's delta", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig({ cameraAt: [1, 2, 100] });
    const cameraBefore = camera.position.clone();
    const targetBefore = controls.target.clone();

    recenterOn(new THREE.Vector3(7, 8, 9), camera, controls);
    runGlide(raf);

    const cameraDelta = camera.position.clone().sub(cameraBefore);
    const targetDelta = controls.target.clone().sub(targetBefore);

    assert.ok(close(cameraDelta.x, targetDelta.x, 1e-4));
    assert.ok(close(cameraDelta.y, targetDelta.y, 1e-4));
    assert.ok(close(cameraDelta.z, targetDelta.z, 1e-4));
  } finally {
    raf.restore();
  }
});

// --- recenterOn: animation mechanics ----------------------------------------

test("recenterOn schedules a frame rather than moving immediately", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();

    recenterOn(new THREE.Vector3(9, 9, 9), camera, controls);

    assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
    assert.equal(raf.pending(), 1);
  } finally {
    raf.restore();
  }
});

test("the first frame establishes the clock, so t=0 does not jump", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(100, 0, 0), camera, controls);

    raf.tick(50_000); // a large absolute timestamp must not finish the glide

    assert.ok(controls.target.x < 1, `jumped to ${controls.target.x}`);
    assert.ok(raf.pending() > 0);
  } finally {
    raf.restore();
  }
});

test("the glide stops scheduling once it completes", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(1, 1, 1), camera, controls, 300);

    raf.tick(0);
    raf.tick(300);

    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test("a past-the-end timestamp clamps instead of overshooting", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(10, 0, 0), camera, controls, 300);

    raf.tick(0);
    raf.tick(10_000);

    assert.ok(close(controls.target.x, 10));
    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test("ms=0 completes on the first frame without dividing by zero", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(3, 4, 5), camera, controls, 0);

    raf.tick(0);

    assert.deepEqual(controls.target.toArray(), [3, 4, 5]);
    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test("the glide is monotonic and eases out", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(100, 0, 0), camera, controls, 300);

    const samples = [];
    raf.tick(0);
    samples.push(controls.target.x);
    for (const now of [75, 150, 225, 300]) {
      raf.tick(now);
      samples.push(controls.target.x);
    }

    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], `not monotonic at ${i}`);
    }
    // Ease-out: past the halfway point in distance by the halfway point in time.
    assert.ok(samples[2] > 50, `halfway progress was ${samples[2]}`);
    assert.ok(close(samples.at(-1), 100));
  } finally {
    raf.restore();
  }
});

test("recenterOn drives controls.update on every frame", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    recenterOn(new THREE.Vector3(1, 1, 1), camera, controls, 300);

    raf.tick(0);
    const afterFirst = controls.updateCount;
    raf.tick(150);

    assert.equal(afterFirst, 1);
    assert.ok(controls.updateCount > afterFirst);
  } finally {
    raf.restore();
  }
});

test("recenterOn does not retain the caller's point vector", () => {
  // It clones; mutating the argument afterwards must not redirect the glide.
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig();
    const point = new THREE.Vector3(5, 5, 5);

    recenterOn(point, camera, controls, 300);
    point.set(999, 999, 999);
    runGlide(raf);

    assert.ok(close(controls.target.x, 5));
  } finally {
    raf.restore();
  }
});

test("a recenter to the current target is a no-op glide", () => {
  const raf = fakeRaf();
  try {
    const { camera, controls } = rig({ target: [1, 2, 3], cameraAt: [1, 2, 103] });
    const cameraBefore = camera.position.clone();

    recenterOn(new THREE.Vector3(1, 2, 3), camera, controls, 300);
    runGlide(raf);

    assert.deepEqual(controls.target.toArray(), [1, 2, 3]);
    assert.ok(close(camera.position.distanceTo(cameraBefore), 0));
  } finally {
    raf.restore();
  }
});
