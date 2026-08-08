// Behavioural tests for the four-slot path selection (pochoir_viewer-t7zq).
//
// viewer.js cannot be imported under node — top-level-await fetch, WebGL at
// module scope — and the sibling viewer_current_wiring.test.js therefore checks
// this area by reading source text. Source greps cannot tell you the rules
// actually HOLD: they would pass just as happily against a handler whose
// branches were subtly wrong.
//
// So this file EXECUTES the shipped code. It lifts the real slotOf/freeSlot
// declarations and the real click-handler body out of web/viewer.js and runs
// them, rather than restating them — a copy of the logic would only ever test
// itself. If the handler's shape changes enough that the extraction fails, the
// first test here says so instead of silently passing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const source = readFileSync(join(WEB_DIR, "viewer.js"), "utf8");

/** Source text of a top-level `function name(...) { ... }`, braces matched. */
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `viewer.js no longer defines ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced braces in ${name}`);
}

/** Body of the `cell.addEventListener("click", ...)` callback. */
function clickHandlerSource() {
  const start = source.indexOf('cell.addEventListener("click", () => {');
  assert.ok(start > 0, "the cell click handler is gone or was reshaped");
  const open = source.indexOf("{", source.indexOf("() =>", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  assert.fail("unbalanced braces in the click handler");
}

/**
 * A live selector built from the real source.
 *
 * `applyPathSelection` is stubbed so a click's success or failure can be
 * driven; everything deciding WHICH slot is touched is the shipped code.
 */
function selector({ slots = 4, applySucceeds = () => true } = {}) {
  const selectedSlots = new Array(slots).fill(null);
  const pressed = new Map();
  const warnings = [];

  const factory = new Function(
    "selectedSlots",
    "SELECTION_SLOTS",
    "applyPathSelection",
    "console",
    `
    ${functionSource("slotOf")}
    ${functionSource("freeSlot")}
    return function click(i, j, cell) {
      ${clickHandlerSource()}
    };
    `,
  );

  const click = factory(
    selectedSlots,
    slots,
    applySucceeds,
    { warn: (...a) => warnings.push(a.join(" ")) },
  );

  return {
    selectedSlots,
    pressed,
    warnings,
    click(i, j) {
      const key = `${i},${j}`;
      const cell = {
        setAttribute: (_name, value) => pressed.set(key, value === "true"),
      };
      click(i, j, cell);
    },
  };
}

// --- the extraction itself -----------------------------------------------------

test("the shipped selector source can still be executed", () => {
  // Guards the rest of the file: if viewer.js is reshaped so the handler or the
  // helpers cannot be lifted out, every test below would otherwise vanish.
  const s = selector();

  s.click(0, 0);

  assert.deepEqual(s.selectedSlots, ["0,0", null, null, null]);
});

// --- filling the slots ---------------------------------------------------------

test("four selections fill slots 0-3 in click order", () => {
  const s = selector();

  s.click(9, 9);
  s.click(0, 0);
  s.click(3, 2);
  s.click(5, 7);

  assert.deepEqual(s.selectedSlots, ["9,9", "0,0", "3,2", "5,7"]);
});

test("each accepted selection presses its own cell", () => {
  const s = selector();

  s.click(0, 0);
  s.click(1, 1);

  assert.equal(s.pressed.get("0,0"), true);
  assert.equal(s.pressed.get("1,1"), true);
});

// --- the fifth click -----------------------------------------------------------

test("a fifth click changes nothing at all", () => {
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [3, 3]]) s.click(i, j);
  const before = [...s.selectedSlots];

  s.click(4, 4);

  assert.deepEqual(s.selectedSlots, before, "a slot was written");
  assert.equal(s.pressed.has("4,4"), false, "aria-pressed was touched");
});

test("the refusal says what to do about it", () => {
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [3, 3]]) s.click(i, j);

  s.click(4, 4);

  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /deselect/);
});

test("a full selection still accepts a DESELECT", () => {
  // The cap must refuse new paths, not freeze the selector.
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [3, 3]]) s.click(i, j);

  s.click(2, 2);

  assert.deepEqual(s.selectedSlots, ["0,0", "1,1", null, "3,3"]);
  assert.equal(s.pressed.get("2,2"), false);
});

// --- freeing and reusing slots -------------------------------------------------

test("deselecting frees its own slot in place", () => {
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2]]) s.click(i, j);

  s.click(1, 1);

  assert.deepEqual(s.selectedSlots, ["0,0", null, "2,2", null]);
});

test("the next selection reuses the freed index rather than appending", () => {
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2]]) s.click(i, j);
  s.click(1, 1);

  s.click(8, 8);

  assert.deepEqual(s.selectedSlots, ["0,0", "8,8", "2,2", null]);
});

test("the paths either side keep their panels when a slot is freed", () => {
  // This is why the structure is an ordered array and not a Set: slot index is
  // panel index, so compacting would move unrelated paths to other panels.
  const s = selector();
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [3, 3]]) s.click(i, j);

  s.click(1, 1);
  s.click(6, 6);

  assert.equal(s.selectedSlots[0], "0,0");
  assert.equal(s.selectedSlots[2], "2,2");
  assert.equal(s.selectedSlots[3], "3,3");
});

test("deselect then reselect can land the same cell in a different slot", () => {
  const s = selector();
  s.click(0, 0);
  s.click(1, 1);
  assert.equal(s.selectedSlots.indexOf("0,0"), 0);

  s.click(0, 0); // frees slot 0
  s.click(7, 7); // takes the freed slot 0
  s.click(0, 0); // reselected — slot 0 is gone, so it lands further along

  assert.equal(s.selectedSlots.indexOf("0,0"), 2);
  assert.deepEqual(s.selectedSlots, ["7,7", "1,1", "0,0", null]);
});

// --- rollback ------------------------------------------------------------------

test("a failed apply leaves the slot and the button as they were", () => {
  const s = selector({ applySucceeds: () => false });

  s.click(4, 4);

  assert.deepEqual(s.selectedSlots, [null, null, null, null]);
  assert.equal(s.pressed.get("4,4"), false);
});

test("a failed deselect puts the path back in its own slot", () => {
  let succeed = true;
  const s = selector({ applySucceeds: () => succeed });
  s.click(0, 0);
  s.click(1, 1);

  succeed = false;
  s.click(0, 0);

  assert.deepEqual(s.selectedSlots, ["0,0", "1,1", null, null]);
  assert.equal(s.pressed.get("0,0"), true);
});

// --- the slot count itself -----------------------------------------------------

test("the cap follows SELECTION_SLOTS rather than a literal four", () => {
  const s = selector({ slots: 2 });

  s.click(0, 0);
  s.click(1, 1);
  s.click(2, 2);

  assert.deepEqual(s.selectedSlots, ["0,0", "1,1"]);
});

test("SELECTION_SLOTS matches the number of panels the markup provides", () => {
  const declared = source.match(/const SELECTION_SLOTS = (\d+)/);
  assert.ok(declared, "SELECTION_SLOTS is gone");
  assert.equal(Number(declared[1]), 4);
});
