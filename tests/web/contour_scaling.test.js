// Tests for per-slice contour level scaling (02bcae3).
//
// contour_view.test.js covers the contour overlay's geometry and panel;
// contour_build.test.js covers segment extraction. This file covers only the
// scaling mode: sliceRange, the log-floor change, the per-field default, and
// what setScaling does and deliberately does NOT touch.
//
// The commit's headline number is checked rather than trusted: "on a low-max
// slice only a handful of global log levels land inside the slice, and per-slice
// puts all of them inside". That is asserted as a count here, so a regression in
// the floor arithmetic shows up as the levels leaving the data again.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  CONTOUR_SCALINGS,
  contourLevels,
  createContourView,
  sliceRange,
} from "../../web/potential_view.js";
import { extractSlice } from "../../web/potential_build.js";

const SHAPE = [5, 6, 7];

/** A diagonal ramp, so every slice axis actually crosses levels. */
function rampVolume(shape, vmin, vmax) {
  const [ni, nj, nk] = shape;
  const volume = new Float32Array(ni * nj * nk);
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++)
      for (let k = 0; k < nk; k++) {
        const t = (i / (ni - 1) + j / (nj - 1) + k / (nk - 1)) / 3;
        volume[(i * nj + j) * nk + k] = vmin + (vmax - vmin) * t;
      }
  return volume;
}

/**
 * A weighting-shaped volume: the slice maximum decays steeply along z, so
 * different z-slices span wildly different ranges. This is the situation the
 * commit exists for; a uniform ramp would hide it.
 */
function weightVolume(shape = SHAPE) {
  const [ni, nj, nk] = shape;
  const volume = new Float32Array(ni * nj * nk);
  for (let k = 0; k < nk; k++) {
    // Slice k spans roughly [0.4, 1.0] * scale, decaying by ~10x per slice.
    const scale = Math.pow(10, -k);
    for (let i = 0; i < ni; i++)
      for (let j = 0; j < nj; j++) {
        const t = (i / (ni - 1) + j / (nj - 1)) / 2;
        volume[(i * nj + j) * nk + k] = scale * (0.4 + 0.6 * t);
      }
  }
  return volume;
}

const driftMeta = (over = {}) => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: -8000,
  vmax: 0,
  units: "V",
  ...over,
});

const weightMeta = (over = {}) => ({
  shape: SHAPE,
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  zstride: 1,
  vmin: 0,
  vmax: 1,
  units: "",
  ...over,
});

// The production code calls setAttribute unconditionally on a found button
// (`button?.setAttribute`), so a stub without it would throw rather than fail.
function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    className: "",
    type: "",
    checked: false,
    style: {},
    children: [],
    handlers: {},
    attrs: {},
    classes: new Set(),
    classList: {
      toggle(name, on) {
        if (on) this.owner.classes.add(name);
        else this.owner.classes.delete(name);
      },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
    append(...kids) { this.children.push(...kids); },
    // rebuildCheckboxes clears the panel with `replaceChildren?.()`. A stub
    // without it is silently skipped by the optional call, and every rebuild
    // would appear to APPEND — so a mode switch would look like it left the old
    // checkboxes in place. The real DOM has this method; the stub must too.
    replaceChildren(...kids) { this.children = [...kids]; },
  };
}

function makeElement(tag) {
  const el = fakeElement(tag);
  el.classList.owner = el;
  return el;
}

function fakeDoc(elements = {}) {
  const created = [];
  return {
    elements,
    created,
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => { const el = makeElement(tag); created.push(el); return el; },
  };
}

/** A contour view with the scaling buttons present. */
function rig(m, volume) {
  const elements = {
    "contour-levels": makeElement(),
    "contour-legend": makeElement(),
    "layer-contours": makeElement("button"),
    "scaling-global": makeElement("button"),
    "scaling-slice": makeElement("button"),
  };
  const doc = fakeDoc(elements);
  const sceneRoot = new THREE.Group();
  const view = createContourView(m, volume, sceneRoot, doc);
  return { view, doc, elements, sceneRoot, meta: m };
}

// --- sliceRange -------------------------------------------------------------

test("sliceRange reports the min and max of a varying slice", () => {
  assert.deepEqual(sliceRange([3, 1, 4, 1, 5]), { vmin: 1, vmax: 5 });
});

test("sliceRange returns null for a flat slice, rather than a zero span", () => {
  // A zero span would divide by zero in the ramp; callers fall back to global.
  assert.equal(sliceRange([2, 2, 2, 2]), null);
});

test("sliceRange returns null for a single-value slice", () => {
  assert.equal(sliceRange([7]), null);
});

test("sliceRange returns null for an empty slice", () => {
  // Infinity/-Infinity must not survive as a usable range.
  assert.equal(sliceRange([]), null);
});

test("sliceRange handles the signed drift potential", () => {
  assert.deepEqual(sliceRange([-9500, -100, -5000]), { vmin: -9500, vmax: -100 });
});

test("sliceRange reads a Float32Array, which is what extractSlice returns", () => {
  const slice = extractSlice(rampVolume(SHAPE, -8000, 0), SHAPE, "z", 3);
  const range = sliceRange(slice.values);

  assert.ok(range);
  assert.ok(range.vmin < range.vmax);
  // It must agree with a plain scan of the same buffer.
  assert.equal(range.vmin, Math.min(...slice.values));
  assert.equal(range.vmax, Math.max(...slice.values));
});

// --- the log floor now honours a positive vmin ------------------------------

test("a global range (vmin 0) still uses the decades window as its floor", () => {
  // The commit states global placement is UNCHANGED. max(0, vmax*10^-d) is the
  // window, so this must match the pre-change arithmetic exactly.
  const levels = contourLevels({ vmin: 0, vmax: 1 }, 5, { scale: "log", decades: 8 });

  const floor = 1 * Math.pow(10, -8);
  const expected = [];
  for (let k = 1; k <= 5; k++) {
    expected.push(Math.pow(10, Math.log10(floor) + ((0 - Math.log10(floor)) * k) / 6));
  }
  assert.deepEqual(levels, expected);
});

test("a narrow positive range uses its own vmin as the floor", () => {
  const range = { vmin: 3.7e-4, vmax: 5.2e-4 };
  const levels = contourLevels(range, 200, { scale: "log", decades: 8 });

  // Every level strictly inside the slice's own range: the whole point.
  for (const level of levels) {
    assert.ok(level > range.vmin, `${level} <= vmin ${range.vmin}`);
    assert.ok(level < range.vmax, `${level} >= vmax ${range.vmax}`);
  }
});

test("the floor takes whichever of vmin and the decades window is higher", () => {
  // vmin below the window: the window wins, so levels start at the window.
  const wide = contourLevels({ vmin: 1e-30, vmax: 1 }, 3, { scale: "log", decades: 8 });
  assert.ok(wide[0] > 1e-9, `${wide[0]} fell below the 8-decade window`);

  // vmin above the window: vmin wins.
  const narrow = contourLevels({ vmin: 0.5, vmax: 1 }, 3, { scale: "log", decades: 8 });
  assert.ok(narrow[0] > 0.5, `${narrow[0]} fell below vmin`);
});

test("log levels stay sorted ascending regardless of which floor wins", () => {
  for (const range of [{ vmin: 0, vmax: 1 }, { vmin: 3.7e-4, vmax: 5.2e-4 }]) {
    const levels = contourLevels(range, 20, { scale: "log", decades: 8 });
    const sorted = [...levels].sort((a, b) => a - b);
    assert.deepEqual(levels, sorted, JSON.stringify(range));
  }
});

// --- the headline claim, as a count -----------------------------------------

/** How many of `levels` fall strictly inside `range`. */
function inside(levels, range) {
  return levels.filter((v) => v > range.vmin && v < range.vmax).length;
}

test("per-slice puts every level inside a low-max slice where global puts almost none", () => {
  // The commit's z=150 case, reproduced with the payload-wide range against a
  // slice whose max is ~1900x lower.
  const payload = { vmin: 0, vmax: 0.954 };
  const slice = { vmin: 3.7e-4, vmax: 5.2e-4 };
  const count = 200;
  const opts = { scale: "log", decades: 8 };

  const global = contourLevels(payload, count, opts);
  const perSlice = contourLevels(slice, count, opts);

  assert.ok(
    inside(global, slice) < count / 10,
    `global already covers the slice (${inside(global, slice)}/${count})`,
  );
  assert.equal(inside(perSlice, slice), count);
});

test("the same holds for linear levels, where global lands entirely outside", () => {
  const payload = { vmin: 0, vmax: 0.954 };
  const slice = { vmin: 3.7e-4, vmax: 5.2e-4 };
  const opts = { scale: "linear", decades: 8 };

  assert.equal(inside(contourLevels(payload, 200, opts), slice), 0);
  assert.equal(inside(contourLevels(slice, 200, opts), slice), 200);
});

test("per-slice re-places the SAME number of levels, not a different count", () => {
  for (const scale of ["linear", "log"]) {
    const n = 37;
    const levels = contourLevels({ vmin: 3.7e-4, vmax: 5.2e-4 }, n, { scale, decades: 8 });
    assert.equal(levels.length, n, scale);
  }
});

// --- the mode list ----------------------------------------------------------

test("there are exactly two scaling modes, named for the panel buttons", () => {
  assert.deepEqual([...CONTOUR_SCALINGS], ["global", "slice"]);
});

// --- the per-field default --------------------------------------------------

test("the signed drift potential defaults to global scaling", () => {
  // Near-linear -9500..0 gains nothing from renormalising.
  const { view } = rig(driftMeta(), rampVolume(SHAPE, -8000, 0));

  assert.equal(view.scaling(), "global");
});

test("the weighting field defaults to per-slice scaling", () => {
  const { view } = rig(weightMeta(), weightVolume());

  assert.equal(view.scaling(), "slice");
});

test("the default keys on the sign of vmin, the same test that disables log", () => {
  // A positive-vmin potential is treated as unsigned, so it gets per-slice.
  assert.equal(rig(driftMeta({ vmin: -1e-9 }), rampVolume(SHAPE, -1e-9, 0)).view.scaling(), "global");
  assert.equal(rig(weightMeta({ vmin: 0 }), weightVolume()).view.scaling(), "slice");
});

// --- setScaling -------------------------------------------------------------

test("setScaling switches modes", () => {
  const { view } = rig(weightMeta(), weightVolume());

  view.setScaling("global");
  assert.equal(view.scaling(), "global");
  view.setScaling("slice");
  assert.equal(view.scaling(), "slice");
});

test("setScaling ignores an unknown mode and leaves the current one in force", () => {
  const { view } = rig(weightMeta(), weightVolume());
  const before = view.scaling();

  assert.equal(view.setScaling("per-pixel"), 0);
  assert.equal(view.scaling(), before);
});

test("setScaling returns 0 before any slice has been drawn", () => {
  // Nothing to recount until update() has run once.
  const { view } = rig(weightMeta(), weightVolume());

  assert.equal(view.setScaling("global"), 0);
});

test("setScaling redraws the current slice and returns its segment count", () => {
  const { view } = rig(weightMeta(), weightVolume());
  view.update("z", 2);

  const count = view.setScaling("global");
  assert.ok(Number.isInteger(count) && count >= 0, `${count}`);
});

test("switching to per-slice draws segments on a slice global scaling left blank", () => {
  // The user-visible payoff. Slice k=4 has a max ~1e-4 while the payload spans
  // 0..1, so global levels miss it entirely.
  const { view } = rig(weightMeta(), weightVolume());

  view.setScaling("global");
  const globalCount = view.update("z", 4);
  const sliceCount = view.setScaling("slice");

  assert.equal(globalCount, 0, "global unexpectedly covered the low-max slice");
  assert.ok(sliceCount > 0, "per-slice drew nothing either");
});

// --- the scaling buttons ----------------------------------------------------

test("the buttons report the active mode through aria-pressed", () => {
  const { view, elements } = rig(weightMeta(), weightVolume());

  view.setScaling("global");
  assert.equal(elements["scaling-global"].getAttribute("aria-pressed"), "true");
  assert.equal(elements["scaling-slice"].getAttribute("aria-pressed"), "false");

  view.setScaling("slice");
  assert.equal(elements["scaling-global"].getAttribute("aria-pressed"), "false");
  assert.equal(elements["scaling-slice"].getAttribute("aria-pressed"), "true");
});

test("exactly one scaling button is pressed at construction", () => {
  const { elements } = rig(weightMeta(), weightVolume());

  const pressed = ["scaling-global", "scaling-slice"].filter(
    (id) => elements[id].getAttribute("aria-pressed") === "true",
  );
  assert.deepEqual(pressed, ["scaling-slice"]);
});

test("the pressed button is also marked active, so visual and accessible state agree", () => {
  const { view, elements } = rig(weightMeta(), weightVolume());

  view.setScaling("global");
  assert.ok(elements["scaling-global"].classes.has("active"));
  assert.ok(!elements["scaling-slice"].classes.has("active"));
});

test("clicking a scaling button switches the mode", () => {
  const { view, elements } = rig(weightMeta(), weightVolume());

  elements["scaling-global"].fire("click");
  assert.equal(view.scaling(), "global");
  elements["scaling-slice"].fire("click");
  assert.equal(view.scaling(), "slice");
});

test("the view constructs when the scaling buttons are absent", () => {
  // Every DOM lookup is optional-chained; a page without the buttons must not
  // throw, or the whole potential layer dies.
  const doc = fakeDoc({ "contour-levels": makeElement() });

  assert.doesNotThrow(() => {
    createContourView(weightMeta(), weightVolume(), new THREE.Group(), doc);
  });
});

// --- the levels panel in per-slice mode -------------------------------------

/** Text content of everything appended to the levels panel. */
function panelText(elements) {
  return elements["contour-levels"].children
    .map((c) => (typeof c === "string" ? c : c.textContent ?? ""))
    .join("|");
}

test("per-slice mode says the levels are re-placed instead of offering toggles", () => {
  const { elements } = rig(weightMeta(), weightVolume());

  assert.match(panelText(elements), /per slice/);
});

test("per-slice mode offers no per-level checkboxes", () => {
  // A fixed checkbox cannot name a level that survives a scrub.
  const { elements } = rig(weightMeta(), weightVolume());

  const boxes = elements["contour-levels"].children.flatMap((row) =>
    (row.children ?? []).filter((c) => c.type === "checkbox"),
  );
  assert.deepEqual(boxes, []);
});

test("switching to global restores the per-level checkboxes", () => {
  const { view, elements } = rig(weightMeta(), weightVolume());

  view.setScaling("global");

  const boxes = elements["contour-levels"].children.flatMap((row) =>
    (row.children ?? []).filter((c) => c.type === "checkbox"),
  );
  assert.ok(boxes.length > 0, "no checkboxes after switching to global");
});

test("switching back to per-slice removes them again", () => {
  const { view, elements } = rig(weightMeta(), weightVolume());
  view.setScaling("global");

  view.setScaling("slice");

  const boxes = elements["contour-levels"].children.flatMap((row) =>
    (row.children ?? []).filter((c) => c.type === "checkbox"),
  );
  assert.deepEqual(boxes, []);
  assert.match(panelText(elements), /per slice/);
});

// --- what per-slice deliberately does NOT touch -----------------------------

test("setScaling does not mutate the payload-wide meta", () => {
  // The slice image and colorbar read meta.vmin/vmax; if per-slice rewrote them
  // the voltage scale would jump while scrubbing, which the commit rules out.
  const m = weightMeta();
  const { view } = rig(m, weightVolume());
  const before = { vmin: m.vmin, vmax: m.vmax };

  view.update("z", 2);
  view.setScaling("global");
  view.update("z", 4);
  view.setScaling("slice");

  assert.deepEqual({ vmin: m.vmin, vmax: m.vmax }, before);
});

test("the declared level set is unchanged by per-slice placement", () => {
  // levels() reports what the user asked for; per-slice re-places that many
  // levels per slice but must not rewrite the declared set.
  const { view } = rig(weightMeta(), weightVolume());
  const declared = view.levels();

  view.update("z", 2);
  view.setScaling("global");
  view.setScaling("slice");

  assert.deepEqual(view.levels(), declared);
});

test("setLevels still governs the count in per-slice mode", () => {
  const { view } = rig(weightMeta(), weightVolume());

  view.setLevels([0.5, 0.25, 0.1]);

  assert.equal(view.levels().length, 3);
  assert.equal(view.scaling(), "slice", "setLevels must not reset the mode");
});

// --- the colour ramp keys to the range the levels came from -----------------

/** Distinct vertex colours in the contour buffer. */
function distinctColors(view) {
  const [lines] = view.group.children;
  const attr = lines.geometry.getAttribute("color");
  if (!attr || attr.count === 0) return 0;
  const seen = new Set();
  for (let n = 0; n < attr.count; n++) {
    seen.add(`${attr.getX(n).toFixed(4)},${attr.getY(n).toFixed(4)},${attr.getZ(n).toFixed(4)}`);
  }
  return seen.size;
}

test("per-slice contours span the colour ramp instead of collapsing to one colour", () => {
  // If the ramp kept the payload range while the levels came from the slice
  // range, every line on a low-max slice would sit at the bottom of the ramp.
  const { view } = rig(weightMeta(), weightVolume());
  view.setLevels([0.9, 0.5, 0.1]);

  const drawn = view.update("z", 4);

  assert.ok(drawn > 0, "no segments to colour");
  assert.ok(distinctColors(view) > 1, "all per-slice contours share one colour");
});

test("a flat slice falls back to global rather than dividing by a zero span", () => {
  const [ni, nj, nk] = SHAPE;
  const volume = new Float32Array(ni * nj * nk);
  // Slice z=0 is flat; the rest ramps so construction still has data.
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++)
      for (let k = 1; k < nk; k++) {
        volume[(i * nj + j) * nk + k] = (i + j + k) / (ni + nj + nk);
      }
  const { view } = rig(weightMeta(), volume);

  let drawn;
  assert.doesNotThrow(() => {
    drawn = view.update("z", 0);
  });
  assert.equal(drawn, 0, "a flat slice has nothing for a contour to separate");
});

test("every per-slice contour colour is a finite in-range value", () => {
  // A NaN from a degenerate range would render as black, not as an error.
  const { view } = rig(weightMeta(), weightVolume());
  view.update("z", 4);

  const [lines] = view.group.children;
  const attr = lines.geometry.getAttribute("color");
  for (let n = 0; n < attr.count; n++) {
    for (const v of [attr.getX(n), attr.getY(n), attr.getZ(n)]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${v}`);
    }
  }
});

// --- the panel markup -------------------------------------------------------

test("the scaling buttons exist in index.html with the ids the view looks up", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const html = readFileSync(join(root, "web", "index.html"), "utf8");

  for (const mode of CONTOUR_SCALINGS) {
    assert.ok(html.includes(`id="scaling-${mode}"`), `missing id="scaling-${mode}"`);
  }
});
