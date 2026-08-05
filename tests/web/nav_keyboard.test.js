// Tests for web/nav.js — enableKeyboardShortcuts.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { enableKeyboardShortcuts } from "../../web/nav.js";

/** An event target that records listeners and can fire them. */
function fakeTarget() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
    fire(type, event) { for (const fn of handlers[type] ?? []) fn(event); },
    handlers,
  };
}

/** Install a document whose activeElement can be swapped per test. */
function fakeDocument(tagName = "BODY") {
  const prior = globalThis.document;
  const doc = { activeElement: { tagName } };
  globalThis.document = doc;
  return {
    doc,
    focus(tag) { doc.activeElement = tag === null ? null : { tagName: tag }; },
    restore() {
      if (prior === undefined) delete globalThis.document;
      else globalThis.document = prior;
    },
  };
}

/** Bind the shortcuts against stubs, recording every handler call. */
function rig({ tagName = "BODY" } = {}) {
  const doc = fakeDocument(tagName);
  const target = fakeTarget();
  const calls = { axisView: [], pivotUnderCursor: [], centerOnDomain: 0, resetView: 0 };

  enableKeyboardShortcuts(
    {
      axisView: (dir) => calls.axisView.push(dir),
      pivotUnderCursor: (x, y) => calls.pivotUnderCursor.push([x, y]),
      centerOnDomain: () => { calls.centerOnDomain += 1; },
      resetView: () => { calls.resetView += 1; },
    },
    target,
  );

  const key = (k, extra = {}) => target.fire("keydown", { key: k, ...extra });
  const move = (x, y) => target.fire("pointermove", { clientX: x, clientY: y });

  return { calls, key, move, doc, target };
}

const vec = (v) => [v.x, v.y, v.z];

// --- axis views -------------------------------------------------------------

test("keys 1-6 map to the six axis directions", () => {
  const { calls, key } = rig();
  try {
    for (const k of ["1", "2", "3", "4", "5", "6"]) key(k);

    assert.deepEqual(calls.axisView.map(vec), [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ]);
  } finally {
    globalThis.document = undefined;
  }
});

test("the axis key order matches the view cube's face order", () => {
  // The README promises 1..6 == +X, -X, +Y, -Y, +Z, -Z, which is also the
  // FACES/material order in viewcube.js. A mismatch sends 5 to the anode.
  const { calls, key } = rig();

  key("5");
  key("6");

  assert.deepEqual(vec(calls.axisView[0]), [0, 0, 1]); // +Z cathode
  assert.deepEqual(vec(calls.axisView[1]), [0, 0, -1]); // -Z anode
});

test("axis handlers receive unit THREE.Vector3 values", () => {
  const { calls, key } = rig();

  key("1");

  assert.ok(calls.axisView[0] instanceof THREE.Vector3);
  assert.equal(calls.axisView[0].length(), 1);
});

test("digits outside 1-6 are ignored", () => {
  const { calls, key } = rig();

  for (const k of ["0", "7", "8", "9"]) key(k);

  assert.equal(calls.axisView.length, 0);
});

test("an axis key does not also trigger the letter actions", () => {
  const { calls, key } = rig();

  key("1");

  assert.equal(calls.centerOnDomain, 0);
  assert.equal(calls.resetView, 0);
  assert.equal(calls.pivotUnderCursor.length, 0);
});

// --- letter shortcuts -------------------------------------------------------

test("C centers on the domain and R resets the view", () => {
  const { calls, key } = rig();

  key("c");
  key("r");

  assert.equal(calls.centerOnDomain, 1);
  assert.equal(calls.resetView, 1);
});

test("shortcuts are case-insensitive", () => {
  const { calls, key } = rig();

  key("C");
  key("R");

  assert.equal(calls.centerOnDomain, 1);
  assert.equal(calls.resetView, 1);
});

test("unmapped keys do nothing", () => {
  const { calls, key } = rig();

  for (const k of ["a", "z", "Escape", "ArrowLeft", " ", "Enter"]) key(k);

  assert.deepEqual(calls, {
    axisView: [], pivotUnderCursor: [], centerOnDomain: 0, resetView: 0,
  });
});

// --- F and the cursor position ---------------------------------------------

test("F acts on the last known cursor position", () => {
  const { calls, key, move } = rig();

  move(640, 360);
  key("f");

  assert.deepEqual(calls.pivotUnderCursor, [[640, 360]]);
});

test("F uses the most recent position, not the first", () => {
  const { calls, key, move } = rig();

  move(10, 20);
  move(300, 400);
  key("f");

  assert.deepEqual(calls.pivotUnderCursor, [[300, 400]]);
});

test("F before any pointer movement is a no-op", () => {
  // Guarding on `seen` matters: without it F would act on (0, 0), the top-left
  // corner, which is almost never what the user meant.
  const { calls, key } = rig();

  key("f");

  assert.equal(calls.pivotUnderCursor.length, 0);
});

test("F works after a pointer move to the origin", () => {
  // (0, 0) is a legitimate position once it has actually been observed.
  const { calls, key, move } = rig();

  move(0, 0);
  key("f");

  assert.deepEqual(calls.pivotUnderCursor, [[0, 0]]);
});

test("F is case-insensitive", () => {
  const { calls, key, move } = rig();

  move(5, 5);
  key("F");

  assert.equal(calls.pivotUnderCursor.length, 1);
});

// --- standing down for focused controls ------------------------------------

test("shortcuts stand down while a slider has focus", () => {
  // The README promises arrow keys still adjust a focused control; a slider
  // also responds to Home/End and digits, so nothing may be hijacked.
  const { calls, key, doc } = rig();
  doc.focus("INPUT");

  key("1");
  key("c");
  key("r");
  key("f");

  assert.deepEqual(calls, {
    axisView: [], pivotUnderCursor: [], centerOnDomain: 0, resetView: 0,
  });
});

test("BUTTON and SELECT also suppress the shortcuts", () => {
  for (const tag of ["BUTTON", "SELECT"]) {
    const { calls, key, doc } = rig();
    doc.focus(tag);

    key("c");

    assert.equal(calls.centerOnDomain, 0, tag);
  }
});

test("shortcuts resume once focus leaves the control", () => {
  const { calls, key, doc } = rig();

  doc.focus("INPUT");
  key("c");
  doc.focus("BODY");
  key("c");

  assert.equal(calls.centerOnDomain, 1);
});

test("a null activeElement does not break the guard", () => {
  const { calls, key, doc } = rig();
  doc.focus(null);

  key("c");

  assert.equal(calls.centerOnDomain, 1);
});

// --- modifier keys ----------------------------------------------------------

test("modifier combinations are left to the browser", () => {
  // Ctrl+R is reload, Cmd+1 switches tabs; hijacking them would be hostile.
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    const { calls, key } = rig();

    key("r", { [modifier]: true });
    key("1", { [modifier]: true });

    assert.equal(calls.resetView, 0, modifier);
    assert.equal(calls.axisView.length, 0, modifier);
  }
});

test("shift is not treated as a blocking modifier", () => {
  const { calls, key } = rig();

  key("C", { shiftKey: true });

  assert.equal(calls.centerOnDomain, 1);
});

// --- wiring -----------------------------------------------------------------

test("listeners are registered on the supplied target", () => {
  const { target } = rig();

  assert.ok(target.handlers.keydown?.length > 0);
  assert.ok(target.handlers.pointermove?.length > 0);
});

test("missing handlers are tolerated", () => {
  // Every call site is optional-chained, so a partial handler set is legal.
  const doc = fakeDocument();
  try {
    const target = fakeTarget();
    enableKeyboardShortcuts({}, target);

    target.fire("pointermove", { clientX: 1, clientY: 2 });
    for (const k of ["1", "f", "c", "r"]) {
      assert.doesNotThrow(() => target.fire("keydown", { key: k }));
    }
  } finally {
    doc.restore();
  }
});

test("repeated presses fire repeatedly", () => {
  const { calls, key } = rig();

  key("c");
  key("c");
  key("c");

  assert.equal(calls.centerOnDomain, 3);
});
