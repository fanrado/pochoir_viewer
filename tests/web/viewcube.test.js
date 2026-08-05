// Tests for web/viewcube.js — the orientation gizmo.
//
// The module touches document.createElement("canvas") and a 2d context only
// inside createViewCube, so a recording stub installed before the call is
// enough; no jsdom and no native canvas build.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { createViewCube } from "../../web/viewcube.js";

/** A 2d context that records what was drawn on it. */
function fakeContext() {
  const calls = { fillText: [], fonts: [], fillRect: [], strokeRect: [] };
  return {
    calls,
    set font(v) { calls.fonts.push(v); },
    get font() { return calls.fonts.at(-1); },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "",
    textBaseline: "",
    fillRect: (...a) => calls.fillRect.push(a),
    strokeRect: (...a) => calls.strokeRect.push(a),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
  };
}

/** Install a minimal document; returns {restore, contexts, canvases}. */
function fakeDocument() {
  const contexts = [];
  const canvases = [];
  const prior = globalThis.document;

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const ctx = fakeContext();
      contexts.push(ctx);
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      canvases.push(canvas);
      return canvas;
    },
  };

  return {
    contexts,
    canvases,
    restore() {
      if (prior === undefined) delete globalThis.document;
      else globalThis.document = prior;
    },
  };
}

/** A renderer stub recording the GL state calls the gizmo pass makes. */
function fakeRenderer({ width = 1200, height = 800 } = {}) {
  const log = [];
  return {
    autoClear: true,
    domElement: { clientWidth: width, clientHeight: height },
    log,
    clearDepth: () => log.push(["clearDepth"]),
    setScissorTest: (v) => log.push(["setScissorTest", v]),
    setViewport: (...a) => log.push(["setViewport", ...a]),
    setScissor: (...a) => log.push(["setScissor", ...a]),
    render: () => log.push(["render"]),
  };
}

function build(opts) {
  const doc = fakeDocument();
  try {
    const renderer = fakeRenderer(opts);
    const mainCamera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
    const cube = createViewCube(renderer, mainCamera);
    return { cube, renderer, mainCamera, doc };
  } finally {
    doc.restore();
  }
}

const SIZE_PX = 96;
const INSET_PX = 12;
const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// --- construction -----------------------------------------------------------

test("createViewCube turns off autoClear for the second pass", () => {
  const { renderer } = build();

  assert.equal(renderer.autoClear, false);
});

test("the gizmo keeps its own scene and an orthographic camera", () => {
  // Orthographic and separate, so main-scene z-compression cannot distort it.
  const { cube } = build();

  assert.ok(cube.scene instanceof THREE.Scene);
  assert.ok(cube.camera instanceof THREE.OrthographicCamera);
  assert.ok(cube.scene.children.includes(cube.cube));
});

test("the gizmo camera looks at the origin from +z", () => {
  const { cube } = build();

  assert.deepEqual(cube.camera.position.toArray(), [0, 0, 3]);
});

test("the cube is a unit box with one material per face", () => {
  const { cube } = build();

  assert.equal(cube.cube.geometry.parameters.width, 1);
  assert.equal(cube.materials.length, 6);
  assert.equal(cube.cube.material.length, 6);
});

test("pickables covers 6 faces, 12 edges and 8 corners", () => {
  const { cube } = build();

  assert.equal(cube.pickables.length, 26);
});

test("pick helpers are invisible and parented to the cube", () => {
  // They must not draw, and must inherit the cube's mirrored orientation.
  const { cube } = build();

  for (const helper of cube.pickables) {
    assert.equal(helper.material.visible, false);
    assert.equal(helper.parent, cube.cube);
  }
});

test("each pick helper carries a unit direction", () => {
  const { cube } = build();

  for (const helper of cube.pickables) {
    assert.ok(close(helper.userData.dir.length(), 1), "not normalized");
  }
});

test("face helpers map to their material index, edges and corners to -1", () => {
  const { cube } = build();

  const faces = cube.pickables.filter((h) => h.userData.faceIndex >= 0);
  assert.equal(faces.length, 6);
  assert.deepEqual(
    faces.map((h) => h.userData.faceIndex).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5],
  );
});

test("the +Z face helper points at the cathode face material", () => {
  // faceIndexFor must agree with the FACES/material ordering, or a face click
  // highlights the wrong label.
  const { cube } = build();

  const plusZ = cube.pickables.find(
    (h) => close(h.userData.dir.z, 1) && close(h.userData.dir.x, 0) && close(h.userData.dir.y, 0),
  );
  assert.equal(plusZ.userData.faceIndex, 4);

  const minusZ = cube.pickables.find(
    (h) => close(h.userData.dir.z, -1) && close(h.userData.dir.x, 0) && close(h.userData.dir.y, 0),
  );
  assert.equal(minusZ.userData.faceIndex, 5);
});

test("the cube centre is not pickable", () => {
  const { cube } = build();

  for (const helper of cube.pickables) {
    assert.ok(helper.position.length() > 0);
  }
});

test("all 26 directions are distinct", () => {
  const { cube } = build();

  const keys = cube.pickables.map((h) => {
    const d = h.userData.dir;
    return `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}`;
  });
  assert.equal(new Set(keys).size, 26);
});

// --- face labels ------------------------------------------------------------

test("labels are drawn in BoxGeometry material order: +X -X +Y -Y +Z -Z", () => {
  // A mismatch here silently mislabels the domain's orientation.
  const doc = fakeDocument();
  try {
    createViewCube(fakeRenderer(), new THREE.PerspectiveCamera());
    const labels = doc.contexts.map((c) => c.calls.fillText[0].text);

    assert.deepEqual(labels, ["+X", "-X", "+Y", "-Y", "+Z cathode", "-Z anode"]);
  } finally {
    doc.restore();
  }
});

test("+z is the cathode and -z the anode", () => {
  // Matches the exporter: the full-plane cathode sits at the maximum z index.
  const doc = fakeDocument();
  try {
    createViewCube(fakeRenderer(), new THREE.PerspectiveCamera());
    const labels = doc.contexts.map((c) => c.calls.fillText[0].text);

    assert.match(labels[4], /cathode/);
    assert.match(labels[5], /anode/);
  } finally {
    doc.restore();
  }
});

test("one 128px canvas is created per face", () => {
  const doc = fakeDocument();
  try {
    createViewCube(fakeRenderer(), new THREE.PerspectiveCamera());

    assert.equal(doc.canvases.length, 6);
    for (const canvas of doc.canvases) {
      assert.equal(canvas.width, 128);
      assert.equal(canvas.height, 128);
    }
  } finally {
    doc.restore();
  }
});

test("long labels get the smaller font so they fit the same face", () => {
  const doc = fakeDocument();
  try {
    createViewCube(fakeRenderer(), new THREE.PerspectiveCamera());

    const fontOf = (i) => doc.contexts[i].calls.fonts.at(-1);
    assert.match(fontOf(0), /^34px/); // "+X"
    assert.match(fontOf(4), /^18px/); // "+Z cathode"
    assert.match(fontOf(5), /^18px/); // "-Z anode"
  } finally {
    doc.restore();
  }
});

test("labels are centred on the face", () => {
  const doc = fakeDocument();
  try {
    createViewCube(fakeRenderer(), new THREE.PerspectiveCamera());

    for (const ctx of doc.contexts) {
      assert.deepEqual(
        [ctx.calls.fillText[0].x, ctx.calls.fillText[0].y],
        [64, 64],
      );
      assert.equal(ctx.textAlign, "center");
      assert.equal(ctx.textBaseline, "middle");
    }
  } finally {
    doc.restore();
  }
});

test("every face gets its own texture", () => {
  const { cube } = build();

  const maps = cube.materials.map((m) => m.map);
  assert.equal(new Set(maps).size, 6);
  for (const map of maps) assert.ok(map instanceof THREE.CanvasTexture);
});

// --- placement --------------------------------------------------------------

test("the CSS rect sits inset from the top-right corner", () => {
  const { cube } = build({ width: 1200, height: 800 });

  const rect = cube.getRect();
  assert.equal(rect.left, 1200 - SIZE_PX - INSET_PX);
  assert.equal(rect.top, INSET_PX);
  assert.equal(rect.width, SIZE_PX);
  assert.equal(rect.height, SIZE_PX);
});

test("the GL viewport origin is measured from the bottom, not the top", () => {
  // CSS y grows downward, GL y upward; conflating them puts the gizmo in the
  // wrong corner on any non-square canvas.
  const { cube } = build({ width: 1200, height: 800 });

  const rect = cube.getRect();
  assert.equal(rect.y, 800 - SIZE_PX - INSET_PX);
  assert.notEqual(rect.y, rect.top);
});

test("the GL x matches the CSS left", () => {
  const { cube } = build({ width: 1000, height: 600 });

  const rect = cube.getRect();
  assert.equal(rect.x, rect.left);
});

test("onResize recomputes the rect for the new canvas size", () => {
  const doc = fakeDocument();
  try {
    const renderer = fakeRenderer({ width: 1200, height: 800 });
    const cube = createViewCube(renderer, new THREE.PerspectiveCamera());

    renderer.domElement.clientWidth = 640;
    renderer.domElement.clientHeight = 480;
    cube.onResize();

    const rect = cube.getRect();
    assert.equal(rect.left, 640 - SIZE_PX - INSET_PX);
    assert.equal(rect.y, 480 - SIZE_PX - INSET_PX);
  } finally {
    doc.restore();
  }
});

test("getRect reflects the latest resize, not a stale snapshot", () => {
  const doc = fakeDocument();
  try {
    const renderer = fakeRenderer({ width: 1200, height: 800 });
    const cube = createViewCube(renderer, new THREE.PerspectiveCamera());
    const before = cube.getRect();

    renderer.domElement.clientWidth = 300;
    cube.onResize();

    assert.notEqual(cube.getRect().left, before.left);
  } finally {
    doc.restore();
  }
});

// --- render pass ------------------------------------------------------------

test("render scissors the gizmo to its corner and restores full viewport", () => {
  const { cube, renderer } = build({ width: 1200, height: 800 });
  renderer.log.length = 0;

  cube.render();

  const names = renderer.log.map((c) => c[0]);
  assert.deepEqual(names, [
    "clearDepth",
    "setScissorTest",
    "setViewport",
    "setScissor",
    "render",
    "setScissorTest",
    "setViewport",
  ]);
  assert.deepEqual(renderer.log[1], ["setScissorTest", true]);
  assert.deepEqual(renderer.log[5], ["setScissorTest", false]);
});

test("the gizmo viewport is the rect, and the restored one is the full canvas", () => {
  const { cube, renderer } = build({ width: 1200, height: 800 });
  renderer.log.length = 0;

  cube.render();

  const rect = cube.getRect();
  assert.deepEqual(renderer.log[2], ["setViewport", rect.x, rect.y, SIZE_PX, SIZE_PX]);
  assert.deepEqual(renderer.log[3], ["setScissor", rect.x, rect.y, SIZE_PX, SIZE_PX]);
  assert.deepEqual(renderer.log.at(-1), ["setViewport", 0, 0, 1200, 800]);
});

test("render clears depth so the gizmo is never occluded by the scene", () => {
  const { cube, renderer } = build();
  renderer.log.length = 0;

  cube.render();

  assert.equal(renderer.log[0][0], "clearDepth");
});

test("the cube mirrors the main camera's orientation", () => {
  const { cube, mainCamera } = build();
  mainCamera.position.set(30, 40, 50);
  mainCamera.lookAt(0, 0, 0);
  mainCamera.updateMatrixWorld(true);

  cube.render();

  const expected = mainCamera.getWorldQuaternion(new THREE.Quaternion()).invert();
  assert.ok(close(Math.abs(cube.cube.quaternion.dot(expected)), 1, 1e-6));
});

test("the cube re-mirrors on every render, tracking camera motion", () => {
  const { cube, mainCamera } = build();

  mainCamera.position.set(0, 0, 100);
  mainCamera.lookAt(0, 0, 0);
  mainCamera.updateMatrixWorld(true);
  cube.render();
  const first = cube.cube.quaternion.clone();

  mainCamera.position.set(100, 0, 0);
  mainCamera.lookAt(0, 0, 0);
  mainCamera.updateMatrixWorld(true);
  cube.render();

  assert.ok(Math.abs(first.dot(cube.cube.quaternion)) < 0.999);
});

test("render leaves the main camera untouched", () => {
  const { cube, mainCamera } = build();
  mainCamera.position.set(7, 8, 9);
  mainCamera.updateMatrixWorld(true);
  const before = mainCamera.position.clone();
  const quaternionBefore = mainCamera.quaternion.clone();

  cube.render();

  assert.ok(mainCamera.position.equals(before));
  assert.ok(close(Math.abs(mainCamera.quaternion.dot(quaternionBefore)), 1));
});

test("render is safe to call repeatedly", () => {
  const { cube, renderer } = build();

  cube.render();
  renderer.log.length = 0;
  cube.render();

  assert.equal(renderer.log.filter((c) => c[0] === "render").length, 1);
  assert.deepEqual(renderer.log.at(-1)[0], "setViewport");
});
