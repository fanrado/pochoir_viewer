// Tests for enableKeyboardShortcuts' event-target requirement.
//
// This file installs NO globalThis.window, so the parameter default resolves to
// undefined. Node runs each test file in its own process, so the stub in
// nav_keyboard.test.js cannot leak in.
import assert from "node:assert/strict";
import { test } from "node:test";

import { enableKeyboardShortcuts } from "../../web/nav.js";

test("there really is no window in this process", () => {
  // Guards the premise: a leaked stub would make everything below vacuous.
  assert.equal(globalThis.window, undefined);
});

test("importing nav.js without a window does not throw", () => {
  // The module must load under node; only calling without a target is an error.
  assert.equal(typeof enableKeyboardShortcuts, "function");
});

test("omitting the target outside a browser is a TypeError", () => {
  assert.throws(() => enableKeyboardShortcuts({}), TypeError);
});

test("the error explains that a target must be passed", () => {
  assert.throws(() => enableKeyboardShortcuts({}), /pass one explicitly/);
});

test("it fails loudly rather than binding to nothing", () => {
  // Silently ignoring a missing target would look like it worked while no
  // shortcut ever fired — the failure mode the docstring calls out.
  let threw = false;
  try {
    enableKeyboardShortcuts({ resetView: () => {} });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test("an explicit target works with no global window", () => {
  const handlers = {};
  const target = {
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
  };
  let reset = 0;

  enableKeyboardShortcuts({ resetView: () => { reset += 1; } }, target);
  for (const fn of handlers.keydown) fn({ key: "r" });

  assert.equal(reset, 1);
});

test("a target without addEventListener is rejected", () => {
  assert.throws(() => enableKeyboardShortcuts({}, {}), TypeError);
});

test("null and false targets are rejected", () => {
  for (const target of [null, false, 0, ""]) {
    assert.throws(() => enableKeyboardShortcuts({}, target), TypeError);
  }
});

test("shortcuts still work when there is no document to inspect", () => {
  // The focus guard reads globalThis.document?.activeElement; with no document
  // at all it must fall through rather than swallow every key.
  const handlers = {};
  const target = {
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
  };
  const seen = [];

  enableKeyboardShortcuts(
    { centerOnDomain: () => seen.push("c"), axisView: (d) => seen.push(d.z) },
    target,
  );
  for (const fn of handlers.keydown) {
    fn({ key: "c" });
    fn({ key: "5" });
  }

  assert.deepEqual(seen, ["c", 1]);
});
