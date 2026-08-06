// The document guard in web/potential_view.js.
//
// createColorbar and wireSliceControls both reach straight for
// doc.getElementById. Called with no document they used to raise a bare
// "cannot read properties of undefined", which named neither entry point.
// Both must now throw a TypeError that says which function was misused.
//
// This file installs NO globalThis.document, so the default parameter
// (`doc = globalThis.document`) resolves to undefined — node runs each test
// file in its own process, so sibling stubs cannot leak in here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createColorbar, wireSliceControls } from "../../web/potential_view.js";

const meta = {
  shape: [4, 5, 6],
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: -8000,
  vmax: 0,
};

const fakeView = () => ({ meta, updateSlice() {} });

// --- the guard fires --------------------------------------------------------

test("createColorbar names itself when no document is available", () => {
  assert.throws(() => createColorbar(meta), (err) => {
    assert.ok(err instanceof TypeError, `expected TypeError, got ${err?.name}`);
    assert.match(err.message, /createColorbar/);
    assert.match(err.message, /document/);
    return true;
  });
});

test("wireSliceControls names itself when no document is available", () => {
  assert.throws(() => wireSliceControls(fakeView()), (err) => {
    assert.ok(err instanceof TypeError, `expected TypeError, got ${err?.name}`);
    assert.match(err.message, /wireSliceControls/);
    assert.match(err.message, /document/);
    return true;
  });
});

// Each entry point must name *itself*, not the other one — that is the whole
// point of passing the caller's name through to the guard.
test("the two guards do not borrow each other's name", () => {
  const colorbar = assertThrown(() => createColorbar(meta));
  const controls = assertThrown(() => wireSliceControls(fakeView()));
  assert.doesNotMatch(colorbar.message, /wireSliceControls/);
  assert.doesNotMatch(controls.message, /createColorbar/);
});

// --- what counts as "no document" -------------------------------------------

for (const [name, doc] of [
  ["undefined", undefined],
  ["null", null],
  ["an object with no getElementById", {}],
  ["an object whose getElementById is not callable", { getElementById: "nope" }],
]) {
  test(`createColorbar rejects ${name}`, () => {
    const err = assertThrown(() => createColorbar(meta, doc));
    assert.ok(err instanceof TypeError);
    assert.match(err.message, /createColorbar/);
  });

  test(`wireSliceControls rejects ${name}`, () => {
    const err = assertThrown(() => wireSliceControls(fakeView(), doc));
    assert.ok(err instanceof TypeError);
    assert.match(err.message, /wireSliceControls/);
  });
}

// --- the guard lets real documents through ----------------------------------

test("createColorbar passes the guard on a document with no colorbar canvas", () => {
  // getElementById returning null is a legitimate document, not a missing one:
  // createColorbar already tolerates the canvas being absent.
  assert.doesNotThrow(() => createColorbar(meta, { getElementById: () => null }));
});

test("wireSliceControls passes the guard on a minimal document", () => {
  const el = () => ({ checked: false, value: "0", max: "0", textContent: "", addEventListener() {} });
  const nodes = {
    "slice-idx": el(),
    "slice-label": el(),
    "axis-x": el(),
    "axis-y": el(),
    "axis-z": el(),
  };
  const doc = { getElementById: (id) => nodes[id] ?? null };
  const controls = wireSliceControls(fakeView(), doc);
  assert.equal(controls.getAxis(), "z");
});

function assertThrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail("expected a throw, got none");
}
