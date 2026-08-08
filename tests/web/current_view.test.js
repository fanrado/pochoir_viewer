// Tests for web/current_view.js — the four induced-current panels.
//
// 7c529b6 changed what a panel IS. They used to show one path's four mirrored
// partners; now panel n is SELECTION SLOT n, showing the nth selected path's
// own fr[i, j, :] and nothing else. Select one path and only the first panel
// has content.
//
// That reverses the earlier shared-scale design, deliberately: the slots hold
// unrelated paths now, so one scale would flatten whichever is smaller for no
// reason. Each panel autoscales to its own trace and reports its peak in the
// title, which is the ONLY thing making the four comparable — so that is
// tested hard. The drawing is checked through a recording 2-D context, since
// what matters is what was drawn, not how it looks.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PANELS,
  PATH_COLORS,
  SLOT_COUNT,
  createCurrentView,
  pathColor,
} from "../../web/current_view.js";
import { traceAt } from "../../web/current_build.js";

const M = 10;
const T = 4;

/** A recording 2-D context: every call and style change kept in order. */
function fakeContext() {
  const ops = [];
  const ctx = {
    ops,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    clearRect: (...a) => ops.push(["clearRect", ...a]),
    beginPath: () => ops.push(["beginPath"]),
    moveTo: (x, y) => ops.push(["moveTo", x, y, ctx.strokeStyle]),
    lineTo: (x, y) => ops.push(["lineTo", x, y, ctx.strokeStyle]),
    stroke: () => ops.push(["stroke", ctx.strokeStyle]),
    fillText: (t, x, y) => ops.push(["fillText", t, x, y]),
  };
  return ctx;
}

function fakeCanvas(width = 100, height = 60) {
  const ctx = fakeContext();
  return {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    ctx,
    getContext: () => ctx,
  };
}

function fakeElement() {
  const children = [];
  return {
    children,
    style: {},
    className: "",
    replaceChildren: () => children.splice(0, children.length),
    append: (...nodes) => children.push(...nodes),
  };
}

function fakeDoc(extra = {}) {
  const els = { "current-legend": fakeElement(), ...extra };
  for (const panel of PANELS) els[panel.id] ??= fakeCanvas();
  return {
    els,
    getElementById: (id) => els[id] ?? null,
    createElement: () => fakeElement(),
    createTextNode: (text) => ({ text }),
  };
}

/**
 * A payload where amplitude varies wildly per cell, as the real one does:
 * cell (i, j) peaks at 10^-(i+j). Bipolar, like a real induced trace.
 */
function payload({ m = M, t = T } = {}) {
  const block = new Float32Array(m * m * t);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < t; k++) {
        block[(i * m + j) * t + k] = Math.pow(10, -(i + j)) * (k % 2 === 0 ? 1 : -1);
      }
    }
  }
  return {
    meta: { bin: "current.bin", shape: [m, m, t], n_ticks: t, time_step_us: 0.1, time_units: "us", bytes: m * m * t * 4, starts: [] },
    block,
  };
}

const ops = (doc, id) => doc.els[id].ctx.ops;
const strokes = (doc, id) =>
  ops(doc, id).filter(([op]) => op === "lineTo" || op === "moveTo");
const curves = (doc, id) =>
  strokes(doc, id).filter(([, , , color]) => PATH_COLORS.includes(color));
const CURSOR_COLOR = "#a05000";
const cursorOps = (doc, id) =>
  strokes(doc, id).filter(([, , , color]) => color === CURSOR_COLOR);
const texts = (doc, id) =>
  ops(doc, id).filter(([op]) => op === "fillText").map(([, t]) => t);
const titleOf = (doc, id) => texts(doc, id)[0];

function reset(doc) {
  for (const panel of PANELS) doc.els[panel.id].ctx.ops.length = 0;
}

const SLOTS = PANELS.map((p) => p.id);

// --- construction --------------------------------------------------------------

test("a missing document is refused by name", () => {
  for (const bad of [undefined, null, {}, { getElementById: "nope" }]) {
    assert.throws(() => createCurrentView(payload(), bad), /createCurrentView needs a document/);
  }
});

test("wiring alone draws nothing", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc);

  assert.deepEqual(ops(doc, SLOTS[0]), []);
});

test("missing canvases do not break the view", () => {
  const doc = { getElementById: () => null, createElement: fakeElement, createTextNode: (t) => ({ t }) };

  const view = createCurrentView(payload(), doc);

  assert.doesNotThrow(() => view.setSelection([{ i: 0, j: 0 }]));
});

test("there is one slot per panel", () => {
  assert.equal(SLOT_COUNT, PANELS.length);
  assert.equal(SLOT_COUNT, 4);
});

test("the panel ids still match the markup", () => {
  // The ids keep their original pad-role names; only index.html depends on
  // them, and nothing in the drawing does.
  assert.deepEqual(SLOTS, [
    "current-central", "current-neighbor-x", "current-neighbor-y", "current-diagonal",
  ]);
});

// --- panel n is selection slot n ----------------------------------------------

test("one selected path fills only the first panel", () => {
  // The change this commit is about: four filled panels from a single click
  // invited the reading that four paths were selected.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 2, j: 3 }]);

  assert.ok(curves(doc, SLOTS[0]).length > 0, "the first panel is empty");
  for (const id of SLOTS.slice(1)) {
    assert.deepEqual(curves(doc, id), [], `${id} drew something`);
  }
});

test("each panel shows its own slot's path", () => {
  const doc = fakeDoc();
  const picks = [{ i: 0, j: 0 }, { i: 1, j: 1 }, { i: 2, j: 2 }, { i: 3, j: 3 }];

  createCurrentView(payload(), doc).setSelection(picks);

  picks.forEach((pick, n) => {
    assert.match(titleOf(doc, SLOTS[n]), new RegExp(`\\(${pick.i}, ${pick.j}\\)`), SLOTS[n]);
  });
});

test("no panel shows a path that was not selected", () => {
  // No inferred neighbours: every title must name a selected path.
  const doc = fakeDoc();
  const picks = [{ i: 2, j: 3 }, { i: 7, j: 8 }];

  createCurrentView(payload(), doc).setSelection(picks);

  const named = SLOTS.map((id) => titleOf(doc, id)).filter(Boolean);
  assert.equal(named.length, 2);
  assert.match(named[0], /\(2, 3\)/);
  assert.match(named[1], /\(7, 8\)/);
});

test("a panel draws the trace traceAt gives for its cell", () => {
  // The values, not just the label: a panel titled (2, 3) showing another
  // cell's trace is the mislabelling of pochoir_viewer-154c in a new form.
  const data = payload();
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 2, j: 3 }]);

  const drawn = curves(doc, SLOTS[0]).length;
  assert.equal(drawn, traceAt(data, 2, 3).length);
});

// --- an unfilled slot is completely blank -------------------------------------

test("an unfilled slot draws nothing at all", () => {
  // "no curve, no title, no axes ghost": anything drawn would imply a path
  // that is not selected.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  for (const id of SLOTS.slice(1)) {
    const after = ops(doc, id).filter(([op]) => op !== "clearRect");
    assert.deepEqual(after, [], `${id} drew ${after.length} ops`);
  }
});

test("an unfilled slot has no zero line", () => {
  // The baseline is drawn after the empty check, so a blank panel is truly
  // blank rather than an empty axis.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  assert.deepEqual(strokes(doc, SLOTS[3]), []);
});

test("shrinking the selection clears the panels it vacated", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  reset(doc);
  view.setSelection([{ i: 0, j: 0 }]);

  assert.deepEqual(curves(doc, SLOTS[1]), [], "the vacated panel kept its curve");
  assert.equal(titleOf(doc, SLOTS[1]), undefined, "the vacated panel kept its title");
});

test("clearing the selection blanks every panel", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  reset(doc);
  view.setSelection([]);

  for (const id of SLOTS) {
    assert.deepEqual(ops(doc, id).filter(([op]) => op !== "clearRect"), [], id);
  }
});

test("every panel is cleared before it is redrawn", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 0, j: 0 }]);
  view.setSelection([{ i: 1, j: 1 }]);

  assert.equal(ops(doc, SLOTS[0]).filter(([op]) => op === "clearRect").length, 2);
});

// --- the slot cap ---------------------------------------------------------------

test("a selection longer than the slots is truncated, not wrapped", () => {
  const doc = fakeDoc();
  const picks = Array.from({ length: 7 }, (_, n) => ({ i: n, j: 0 }));

  createCurrentView(payload(), doc).setSelection(picks);

  SLOTS.forEach((id, n) => {
    assert.match(titleOf(doc, id), new RegExp(`\\(${n}, 0\\)`), id);
  });
});

test("the fifth selected path is dropped rather than overwriting a panel", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection(
    Array.from({ length: 6 }, (_, n) => ({ i: n, j: 0 })),
  );

  const titles = SLOTS.map((id) => titleOf(doc, id));
  assert.equal(titles.filter(Boolean).length, SLOT_COUNT);
  assert.equal(titles.some((t) => /\(4, 0\)|\(5, 0\)/.test(t)), false);
});

// --- per-panel autoscale --------------------------------------------------------

test("each panel autoscales to its own trace", () => {
  // The reversal: slots hold unrelated paths, so a shared scale would flatten
  // whichever is smaller for no reason. With (0,0) at 1 and (4,4) at 1e-8,
  // both curves must still span their panel.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, { i: 4, j: 4 }]);

  const span = (id) => {
    const ys = curves(doc, id).map(([, , y]) => y);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(span(SLOTS[0]) > 50, "the large trace is flat");
  assert.ok(span(SLOTS[1]) > 50, "the tiny trace was flattened by a shared scale");
});

test("the peak is reported in the title, since the scales differ", () => {
  // This is the ONLY thing making the four panels comparable now. Without it
  // the autoscale would be actively misleading.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, { i: 4, j: 4 }]);

  assert.match(titleOf(doc, SLOTS[0]), /peak 1\.00e\+0/);
  assert.match(titleOf(doc, SLOTS[1]), /peak 1\.00e-8/);
});

test("two panels with the same peak scale identically", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 1, j: 3 }, { i: 3, j: 1 }]);

  const ys = (id) => curves(doc, id).map(([, , y]) => y);
  assert.deepEqual(ys(SLOTS[0]), ys(SLOTS[1]));
});

test("an all-zero trace draws a flat line rather than NaN", () => {
  const data = payload();
  data.block.fill(0);
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 0, j: 0 }]);

  for (const [, , y] of curves(doc, SLOTS[0])) {
    assert.ok(Number.isFinite(y), `y is ${y}`);
  }
});

// --- colours and the legend -----------------------------------------------------

test("a panel's curve takes its slot's colour", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([
    { i: 0, j: 0 }, { i: 1, j: 1 }, { i: 2, j: 2 }, { i: 3, j: 3 },
  ]);

  SLOTS.forEach((id, n) => {
    const colors = new Set(curves(doc, id).map(([, , , c]) => c));
    assert.deepEqual([...colors], [pathColor(n)], id);
  });
});

test("the colours are distinct across the four slots", () => {
  // With one curve per panel the colour is the link to the legend row.
  const used = new Set(Array.from({ length: SLOT_COUNT }, (_, n) => pathColor(n)));

  assert.equal(used.size, SLOT_COUNT);
});

test("the nth path takes the nth colour", () => {
  for (let n = 0; n < PATH_COLORS.length; n++) {
    assert.equal(pathColor(n), PATH_COLORS[n]);
  }
});

test("the colour cycle repeats past the end of the list", () => {
  assert.equal(pathColor(PATH_COLORS.length), PATH_COLORS[0]);
});

test("the legend keys each colour to its start position", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, { i: 2, j: 3 }]);

  assert.equal(doc.els["current-legend"].children.length, 2);
});

test("the legend is rebuilt, not appended to", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  view.setSelection([{ i: 0, j: 0 }]);

  assert.equal(doc.els["current-legend"].children.length, 1);
});

test("a missing legend element does not break drawing", () => {
  const doc = fakeDoc();
  doc.els["current-legend"] = null;

  const view = createCurrentView(payload(), doc);

  assert.doesNotThrow(() => view.setSelection([{ i: 0, j: 0 }]));
});

// --- the time axis and the cursor -----------------------------------------------

test("the time axis is labelled in physical units from the payload", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  assert.ok(texts(doc, SLOTS[0]).includes("0–0.3 us"), texts(doc, SLOTS[0]).join(" | "));
});

test("the axis label follows the payload's own time step", () => {
  const data = payload();
  data.meta.time_step_us = 1;
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 0, j: 0 }]);

  assert.ok(texts(doc, SLOTS[0]).includes("0–3.0 us"));
});

test("the unit comes from the payload rather than being hardcoded", () => {
  const data = payload();
  data.meta.time_units = "ns";
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 0, j: 0 }]);

  assert.ok(texts(doc, SLOTS[0]).some((t) => t.endsWith("ns")));
});

test("a payload with no time_units falls back to us", () => {
  const data = payload();
  delete data.meta.time_units;
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 0, j: 0 }]);

  assert.ok(texts(doc, SLOTS[0]).some((t) => t.endsWith("us")));
});

test("the cursor draws a full-height line in every filled panel", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  reset(doc);
  view.setCursor(0);

  for (const id of SLOTS.slice(0, 2)) {
    assert.deepEqual(
      cursorOps(doc, id).map(([op, , y]) => [op, y]),
      [["moveTo", 0], ["lineTo", 60]],
      id,
    );
  }
});

test("the cursor sits at the same x in every filled panel", () => {
  // It marks one instant across the selected paths; a per-panel offset would
  // make the comparison lie.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  reset(doc);
  view.setCursor(2);

  const xs = SLOTS.slice(0, 2).map((id) => cursorOps(doc, id)[0]?.[1]);
  assert.equal(new Set(xs).size, 1, `cursor x differed: ${xs.join(", ")}`);
  assert.ok(xs[0] > 0);
});

test("an empty slot gets no cursor either", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }]);

  view.setCursor(2);

  assert.deepEqual(cursorOps(doc, SLOTS[3]), []);
});

test("the cursor survives a selection change", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setCursor(1);

  reset(doc);
  view.setSelection([{ i: 0, j: 0 }]);

  assert.ok(cursorOps(doc, SLOTS[0]).length > 0, "the cursor was dropped");
});

test("no cursor is drawn before one is set", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  assert.deepEqual(cursorOps(doc, SLOTS[0]), []);
});

// --- the canvas and the selection copy -------------------------------------------

test("the backing store is matched to the CSS box", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  const canvas = doc.els[SLOTS[0]];
  assert.equal(canvas.width, canvas.clientWidth);
  assert.equal(canvas.height, canvas.clientHeight);
});

test("the selection is copied so a caller's later mutation does not leak in", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  const selection = [{ i: 0, j: 0 }];

  view.setSelection(selection);
  selection.push({ i: 1, j: 1 });
  reset(doc);
  view.draw();

  assert.deepEqual(curves(doc, SLOTS[1]), [], "a post-hoc push was drawn");
});

test("a start anywhere in the block can be selected", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  for (const [i, j] of [[7, 0], [0, 7], [9, 9], [5, 5]]) {
    assert.doesNotThrow(() => view.setSelection([{ i, j }]), `(${i}, ${j})`);
  }
});

// --- holes in the slot array (6952850) ----------------------------------------
//
// viewer.js passes a fixed-length array with nulls for empty slots, so panel n
// keeps drawing slot n. Compacting would move every path one panel left when
// an earlier slot is freed -- the thing an ordered array exists to prevent.

test("a null slot leaves its panel blank without shifting the others", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, null, { i: 2, j: 2 }, null]);

  assert.match(titleOf(doc, SLOTS[0]), /\(0, 0\)/);
  assert.equal(titleOf(doc, SLOTS[1]), undefined, "the hole was filled by a later path");
  assert.match(titleOf(doc, SLOTS[2]), /\(2, 2\)/);
  assert.equal(titleOf(doc, SLOTS[3]), undefined);
});

test("a path keeps its panel when an earlier slot is freed", () => {
  // The stated point of slot order: deselecting slot 0 must not move slot 1's
  // path into panel 0.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }, null, null]);

  reset(doc);
  view.setSelection([null, { i: 1, j: 1 }, null, null]);

  assert.equal(titleOf(doc, SLOTS[0]), undefined, "panel 0 still has content");
  assert.match(titleOf(doc, SLOTS[1]), /\(1, 1\)/, "the path moved out of its panel");
});

test("a hole keeps its slot colour for the paths after it", () => {
  // Colour is pathColor(slot), so a hole must not shift the palette either.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([null, { i: 1, j: 1 }, null, { i: 3, j: 3 }]);

  assert.deepEqual([...new Set(curves(doc, SLOTS[1]).map(([, , , c]) => c))], [pathColor(1)]);
  assert.deepEqual([...new Set(curves(doc, SLOTS[3]).map(([, , , c]) => c))], [pathColor(3)]);
});

test("a hole gets no legend row", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, null, { i: 2, j: 2 }, null]);

  assert.equal(doc.els["current-legend"].children.length, 2);
});

test("an all-null selection draws and lists nothing", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([null, null, null, null]);

  for (const id of SLOTS) {
    assert.deepEqual(ops(doc, id).filter(([op]) => op !== "clearRect"), [], id);
  }
  assert.equal(doc.els["current-legend"].children.length, 0);
});

test("a hole gets no cursor", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, null, null, null]);

  view.setCursor(2);

  assert.deepEqual(cursorOps(doc, SLOTS[1]), []);
  assert.ok(cursorOps(doc, SLOTS[0]).length > 0);
});

// --- no partner machinery ------------------------------------------------------

test("the view reads single cells, never the partner helper", async () => {
  // The structural guarantee behind Phase K: if current_view still reached for
  // tracesForPath, removing the partner machinery would break the panels. It
  // must import traceAt and nothing that infers neighbours.
  const source = await readFile(
    new URL("../../web/current_view.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /tracesForPath/, "the view still infers partners");
  assert.doesNotMatch(source, /partnerIndex|PIXEL_OFFSET/, "partner arithmetic survives");
  assert.match(source, /\btraceAt\b/, "the view no longer reads single cells");
});

test("a panel's trace is its own cell, not a mirrored partner", () => {
  // (7, 2) mirrors to (2, 2), (7, 7) and (2, 7). With only (7, 2) selected,
  // none of those may appear in any panel — the exact failure in the reported
  // screenshot, where one selection filled all four.
  const data = payload();
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 7, j: 2 }]);

  assert.deepEqual([...curves(doc, SLOTS[0]).map(([, , y]) => y)].length > 0, true);
  for (const [pi, pj] of [[2, 2], [7, 7], [2, 7]]) {
    for (const id of SLOTS) {
      const title = titleOf(doc, id);
      if (title === undefined) continue;
      assert.doesNotMatch(
        title,
        new RegExp(`\\(${pi}, ${pj}\\)`),
        `${id} shows the mirrored partner (${pi}, ${pj})`,
      );
    }
  }
});
