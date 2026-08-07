// Tests for web/current_view.js — the four induced-current panels (c6f8be4).
//
// The drawing is checked through a recording 2-D context rather than by
// eyeballing pixels: what matters is not how the curve looks but that all four
// panels used ONE vertical scale. The module's own comment says why -- the
// diagonal neighbour peaks ~50x below the central pixel, so autoscaling each
// panel would draw both as the same size wiggle and destroy the amplitude
// comparison the view exists for. That is the property with teeth here, and a
// per-panel autoscale would look perfectly fine on screen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PANELS,
  PATH_COLORS,
  createCurrentView,
  pathColor,
} from "../../web/current_view.js";
import { PIXEL_OFFSET, tracesForPath } from "../../web/current_build.js";

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
 * A payload where the four pixels have wildly different amplitudes, as the
 * real one does. Cell (i, j) is a constant run at `amplitude(i, j)`.
 */
function payload({ m = M, t = T } = {}) {
  const block = new Float32Array(m * m * t);
  const amp = (i, j) => (i >= PIXEL_OFFSET ? 0.02 : 1) * (j >= PIXEL_OFFSET ? 0.02 : 1);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < t; k++) {
        // Alternating sign so the traces are bipolar, like the real ones.
        block[(i * m + j) * t + k] = amp(i, j) * (k % 2 === 0 ? 1 : -1);
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

/** Only the path curves: the zero line and the cursor have their own colours. */
const curves = (doc, id) =>
  strokes(doc, id).filter(([, , , color]) => PATH_COLORS.includes(color));

/** The cursor is identified by its colour, not its geometry -- a sample at
 *  the shared peak also lands on y = 0. */
const CURSOR_COLOR = "#a05000";
const cursorOps = (doc, id) =>
  strokes(doc, id).filter(([, , , color]) => color === CURSOR_COLOR);

/** Drop everything recorded so far, so a test reads one draw in isolation. */
function reset(doc) {
  for (const panel of PANELS) doc.els[panel.id].ctx.ops.length = 0;
}

// --- construction ------------------------------------------------------------

test("a missing document is refused by name", () => {
  for (const bad of [undefined, null, {}, { getElementById: "nope" }]) {
    assert.throws(() => createCurrentView(payload(), bad), /createCurrentView needs a document/);
  }
});

test("wiring alone draws nothing", () => {
  // The caller drives the first draw once a selection exists; an empty
  // selection must not paint a misleading flat line unprompted.
  const doc = fakeDoc();

  createCurrentView(payload(), doc);

  assert.deepEqual(ops(doc, "current-central"), []);
});

test("missing canvases do not break the view", () => {
  // The panel is absent until the payload loads.
  const doc = { getElementById: () => null, createElement: fakeElement, createTextNode: (t) => ({ t }) };

  const view = createCurrentView(payload(), doc);

  assert.doesNotThrow(() => view.setSelection([{ i: 0, j: 0 }]));
});

test("the panels are addressed positionally, not by pad role", () => {
  // 8fa1ddb drops key and title from PANELS: panel n takes entry n of
  // tracesForPath's fixed order. Reintroducing a role name here is the
  // mislabelling of pochoir_viewer-154c coming back.
  assert.deepEqual(
    PANELS.map((p) => p.id),
    ["current-central", "current-neighbor-x", "current-neighbor-y", "current-diagonal"],
  );
  for (const panel of PANELS) {
    assert.equal("key" in panel, false, `${panel.id} still carries a role key`);
    assert.equal("title" in panel, false, `${panel.id} still carries a fixed title`);
  }
});

// --- the shared vertical scale ----------------------------------------------

test("all four panels draw against one shared scale", () => {
  // The property with teeth. With the central pixel 2500x the diagonal, a
  // per-panel autoscale would give both curves the same excursion; a shared
  // scale must leave the diagonal nearly flat.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 0, j: 0 }]);

  const excursion = (id) => {
    const ys = strokes(doc, id).map(([, , y]) => y);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(excursion("current-central") > 50, "the central curve is flat");
  assert.ok(
    excursion("current-diagonal") < excursion("current-central") / 100,
    "the diagonal was autoscaled up to match the central pixel",
  );
});

test("the shared peak spans every selected path, not just the first", () => {
  // Selecting a larger path must rescale the panels already drawn for a
  // smaller one, or the two curves cannot be compared.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 0, j: 0 }]);
  const alone = curves(doc, "current-central").map(([, , y]) => y);
  reset(doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);
  const together = curves(doc, "current-central")
    .filter(([, , , color]) => color === pathColor(0))
    .map(([, , y]) => y);

  assert.deepEqual(together, alone, "identical amplitudes were rescaled anyway");
});

test("an all-zero selection draws a flat line rather than NaN", () => {
  const data = payload();
  data.block.fill(0);
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([{ i: 0, j: 0 }]);

  for (const [, , y] of strokes(doc, "current-central")) {
    assert.ok(Number.isFinite(y), `y is ${y}`);
  }
});

// --- one curve per selected path --------------------------------------------

test("every panel draws one curve per selected path", () => {
  // "four selected paths put sixteen curves on screen".
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }, { i: 2, j: 2 }]);

  for (const panel of PANELS) {
    const drawn = new Set(curves(doc, panel.id).map(([, , , color]) => color));
    assert.equal(drawn.size, 3, `${panel.id} drew ${drawn.size} curves`);
  }
});

test("each curve has one point per tick", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  const curve = curves(doc, "current-central").filter(
    ([, , , color]) => color === pathColor(0),
  );
  assert.equal(curve.length, T);
});

test("a curve starts with moveTo and continues with lineTo", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  const curve = curves(doc, "current-central").filter(
    ([, , , color]) => color === pathColor(0),
  );
  assert.equal(curve[0][0], "moveTo");
  assert.ok(curve.slice(1).every(([op]) => op === "lineTo"));
});

test("selecting nothing clears the panels rather than leaving stale curves", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }]);

  reset(doc);
  view.setSelection([]);

  assert.deepEqual(curves(doc, "current-central"), [], "a path curve survived the deselection");
});

test("each panel is cleared before it is redrawn", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 0, j: 0 }]);
  view.setSelection([{ i: 1, j: 1 }]);

  assert.equal(ops(doc, "current-central").filter(([op]) => op === "clearRect").length, 2);
});

// --- colours -----------------------------------------------------------------

test("the nth path takes the nth colour", () => {
  for (let n = 0; n < PATH_COLORS.length; n++) {
    assert.equal(pathColor(n), PATH_COLORS[n]);
  }
});

test("the colour cycle repeats past the end of the list", () => {
  // The selector allows more paths than there are colours; the legend is the
  // authority, so repeating is intended rather than a bug.
  assert.equal(pathColor(PATH_COLORS.length), PATH_COLORS[0]);
  assert.equal(pathColor(PATH_COLORS.length + 2), PATH_COLORS[2]);
});

test("the colours are distinct from each other", () => {
  assert.equal(new Set(PATH_COLORS).size, PATH_COLORS.length);
});

test("the same path gets the same colour in all four panels", () => {
  // Cross-panel comparison depends on it.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }]);

  for (const panel of PANELS) {
    const colors = [...new Set(strokes(doc, panel.id).map(([, , , c]) => c))].filter((c) =>
      PATH_COLORS.includes(c),
    );
    assert.deepEqual(colors, [pathColor(0), pathColor(1)], panel.id);
  }
});

// --- the zero line and the labels -------------------------------------------

test("every panel draws a zero line at mid-height", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([]);

  for (const panel of PANELS) {
    const baseline = ops(doc, panel.id).find(
      ([op, , y]) => op === "moveTo" && y === 30,
    );
    assert.ok(baseline, `${panel.id} has no zero line`);
  }
});

const titleOf = (doc, id) =>
  ops(doc, id).filter(([op]) => op === "fillText").map(([, t]) => t)[0];

test("each panel is titled with the block index it draws", () => {
  // The four partners of (2, 3) are (2,3), (7,3), (2,8), (7,8) in order.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 2, j: 3 }]);

  assert.deepEqual(
    PANELS.map((p) => titleOf(doc, p.id)),
    ["[2, 3] (start)", "[7, 3]", "[2, 8]", "[7, 8]"],
  );
});

test("the start's own panel is marked without claiming it collects", () => {
  // "(start)" says which cell the electron is in; it must NOT say "central",
  // which would assert which pad picks up the charge -- the claim that was
  // wrong for three quarters of the domain.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 7, j: 3 }]);

  const titles = PANELS.map((p) => titleOf(doc, p.id));
  assert.equal(titles[0], "[7, 3] (start)");
  assert.equal(titles.filter((t) => t?.includes("(start)")).length, 1);
  for (const t of titles) {
    assert.equal(/central|neighbour|neighbor|diagonal/.test(t ?? ""), false, t);
  }
});

test("the title follows the quarter the start is in", () => {
  // Same panel, different quarter, different cell -- the titles have to move.
  const first = fakeDoc();
  const third = fakeDoc();
  createCurrentView(payload(), first).setSelection([{ i: 2, j: 3 }]);
  createCurrentView(payload(), third).setSelection([{ i: 7, j: 8 }]);

  assert.equal(titleOf(first, "current-central"), "[2, 3] (start)");
  assert.equal(titleOf(third, "current-central"), "[7, 8] (start)");
});

test("the time axis is labelled in physical units from the payload", () => {
  // Never in ticks: the number alone would not say what it means.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([]);

  const labels = ops(doc, "current-central").filter(([op]) => op === "fillText").map(([, t]) => t);
  assert.ok(labels.some((t) => t === "0–0.3 us"), `labels were ${labels.join(" | ")}`);
});

test("the axis label follows the payload's own time step", () => {
  const data = payload();
  data.meta.time_step_us = 1;
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([]);

  const labels = ops(doc, "current-central").filter(([op]) => op === "fillText").map(([, t]) => t);
  assert.ok(labels.some((t) => t === "0–3.0 us"), labels.join(" | "));
});

test("the unit comes from the payload rather than being hardcoded", () => {
  const data = payload();
  data.meta.time_units = "ns";
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([]);

  const labels = ops(doc, "current-central").filter(([op]) => op === "fillText").map(([, t]) => t);
  assert.ok(labels.some((t) => t.endsWith("ns")), labels.join(" | "));
});

test("a payload with no time_units falls back to us", () => {
  const data = payload();
  delete data.meta.time_units;
  const doc = fakeDoc();

  createCurrentView(data, doc).setSelection([]);

  const labels = ops(doc, "current-central").filter(([op]) => op === "fillText").map(([, t]) => t);
  assert.ok(labels.some((t) => t.endsWith("us")), labels.join(" | "));
});

// --- the time cursor ----------------------------------------------------------

test("the cursor draws a full-height line in every panel", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }]);

  view.setCursor(0);

  for (const panel of PANELS) {
    const line = cursorOps(doc, panel.id);
    assert.deepEqual(
      line.map(([op, , y]) => [op, y]),
      [["moveTo", 0], ["lineTo", 60]],
      `${panel.id} has no full-height cursor line`,
    );
  }
});

test("the cursor sits at the same x in all four panels", () => {
  // It marks one instant across the four pixels; a per-panel offset would
  // make the comparison lie.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }]);

  reset(doc);
  view.setCursor(2);

  const xs = PANELS.map((panel) => cursorOps(doc, panel.id)[0]?.[1]);
  assert.equal(new Set(xs).size, 1, `cursor x differed: ${xs.join(", ")}`);
  assert.ok(xs[0] > 0);
});

test("the cursor survives a selection change", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  view.setCursor(1);

  reset(doc);
  view.setSelection([{ i: 0, j: 0 }]);

  assert.ok(cursorOps(doc, "current-central").length > 0, "the cursor was dropped when the selection changed");
});

test("no cursor is drawn before one is set", () => {
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }]);

  assert.deepEqual(cursorOps(doc, "current-central"), []);
});

// --- the legend ---------------------------------------------------------------

test("the legend keys each colour to its start position", () => {
  // Nothing else on screen can say which curve is which path.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 0, j: 0 }, { i: 2, j: 3 }]);

  const legend = doc.els["current-legend"];
  assert.equal(legend.children.length, 2);
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

// --- the canvas backing store -------------------------------------------------

test("the backing store is matched to the CSS box", () => {
  // Otherwise the browser scales a stale bitmap and every line is blurred.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([]);

  const canvas = doc.els["current-central"];
  assert.equal(canvas.width, canvas.clientWidth);
  assert.equal(canvas.height, canvas.clientHeight);
});

// --- selection is copied, not aliased -----------------------------------------

test("the selection is copied so a caller's later mutation does not leak in", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);
  const selection = [{ i: 0, j: 0 }];

  view.setSelection(selection);
  selection.push({ i: 1, j: 1 });
  view.draw();

  const drawn = new Set(
    strokes(doc, "current-central").map(([, , , c]) => c).filter((c) => PATH_COLORS.includes(c)),
  );
  assert.equal(drawn.size, 1, "a post-hoc push to the caller's array was drawn");
});

test("a start anywhere in the block can now be selected", () => {
  // 94799a9 and fc45c69 opened every quarter; only off-block indices throw.
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  for (const [i, j] of [[7, 0], [0, 7], [9, 9], [5, 5]]) {
    assert.doesNotThrow(() => view.setSelection([{ i, j }]), `(${i}, ${j})`);
  }
  assert.throws(() => view.setSelection([{ i: 10, j: 0 }]), /outside the/);
});

// --- one panel, two quarters --------------------------------------------------
//
// Panel n draws entry n for EVERY selected path, and entry n is a different
// block cell depending on which quarter the start is in. So selecting two
// starts from different quarters of the same group overlays two different
// cells in one panel, under a title naming only the first. drawPanel's comment
// acknowledges the title limitation; these pin what actually happens, because
// the consequence is stronger than a title being approximate -- the two curves
// are different physical quantities on one axis.

test("panel 0 draws a different cell for each quarter's start", () => {
  // (2,3) and (7,3) are partners: entry 0 is (2,3) for the first and (7,3)
  // for the second. Both land in panel 0.
  const data = payload();

  const a = tracesForPath(data, 2, 3)[0].index.join(",");
  const b = tracesForPath(data, 7, 3)[0].index.join(",");

  assert.notEqual(a, b, "the two starts share entry 0, so there is nothing to overlay");
  assert.equal(a, "2,3");
  assert.equal(b, "7,3");
});

test("selecting both puts two different cells in the same panel", () => {
  const doc = fakeDoc();
  const view = createCurrentView(payload(), doc);

  view.setSelection([{ i: 2, j: 3 }, { i: 7, j: 3 }]);

  // Cell values are the a*100+b labels, so the two curves are identifiable.
  const drawn = new Set(
    curves(doc, "current-central")
      .filter(([op]) => op === "moveTo")
      .map(([, , y]) => y),
  );
  assert.equal(drawn.size, 2, "the two starts drew the same cell");
});

test("the title names only the first selected start", () => {
  // Acknowledged in drawPanel's comment. Pinned so it is a known limitation
  // rather than a surprise: the legend's per-path colours are what
  // disambiguate the second curve.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 2, j: 3 }, { i: 7, j: 3 }]);

  assert.equal(titleOf(doc, "current-central"), "[2, 3] (start)");
});

test("the legend still keys every selected start to its colour", () => {
  // The only thing that lets a reader attribute the second curve.
  const doc = fakeDoc();

  createCurrentView(payload(), doc).setSelection([{ i: 2, j: 3 }, { i: 7, j: 3 }]);

  assert.equal(doc.els["current-legend"].children.length, 2);
});

test("two starts in the same quarter share their panel cells", () => {
  // The benign case, for contrast: both entry-0 cells are in the first
  // quarter, so panel 0 compares like with like.
  const data = payload();

  assert.equal(tracesForPath(data, 1, 1)[0].index.join(","), "1,1");
  assert.equal(tracesForPath(data, 2, 2)[0].index.join(","), "2,2");
  for (const slot of [0, 1, 2, 3]) {
    const a = tracesForPath(data, 1, 1)[slot].index;
    const b = tracesForPath(data, 2, 2)[slot].index;
    assert.equal(a[0] < 5 === b[0] < 5, true, `slot ${slot} straddles the boundary`);
    assert.equal(a[1] < 5 === b[1] < 5, true, `slot ${slot} straddles the boundary`);
  }
});
