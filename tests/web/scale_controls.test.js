// Tests for contourLevels, the per-level checkbox cap, and wireScaleControls.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTOUR_LEVEL_COUNT,
  MAX_PER_LEVEL_CHECKBOXES,
  contourLevels,
  wireScaleControls,
} from "../../web/potential_view.js";

const weight = (over = {}) => ({ vmin: 0, vmax: 1, units: "dimensionless", ...over });
const drift = (over = {}) => ({ vmin: -9500, vmax: 0, units: "V", ...over });
const LOG = { scale: "log", decades: 8 };
const LINEAR = { scale: "linear", decades: 8 };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- contourLevels: counts --------------------------------------------------

test("the requested number of levels is returned", () => {
  for (const n of [1, 5, 200, 5000]) {
    assert.equal(contourLevels(weight(), n, LINEAR).length, n);
  }
});

test("a fractional count is floored", () => {
  assert.equal(contourLevels(weight(), 7.9, LINEAR).length, 7);
});

test("a count below one still yields one level", () => {
  // A slider can reach 0; an empty contour set would look like a broken render.
  for (const n of [0, -5]) {
    assert.equal(contourLevels(weight(), n, LINEAR).length, 1);
  }
});

// --- contourLevels: linear spacing -----------------------------------------

test("linear levels are evenly spaced", () => {
  const levels = contourLevels(drift(), 4, LINEAR);

  const gaps = levels.slice(1).map((v, n) => v - levels[n]);
  for (const gap of gaps) assert.ok(close(gap, gaps[0], 1e-9));
});

test("linear levels exclude both endpoints", () => {
  // A level exactly at vmin or vmax has no interior contour to draw.
  const levels = contourLevels(drift(), 9, LINEAR);

  for (const level of levels) {
    assert.ok(level > -9500 && level < 0, `${level} is not interior`);
  }
});

test("linear levels ascend", () => {
  const levels = contourLevels(drift(), 6, LINEAR);

  assert.deepEqual([...levels], [...levels].sort((a, b) => a - b));
});

test("one linear level sits at the midpoint", () => {
  assert.ok(close(contourLevels({ vmin: 0, vmax: 10 }, 1, LINEAR)[0], 5));
});

// --- contourLevels: log spacing --------------------------------------------

test("log levels are evenly spaced in the exponent", () => {
  const levels = contourLevels(weight(), 5, LOG);

  const logs = levels.map(Math.log10);
  const gaps = logs.slice(1).map((v, n) => v - logs[n]);
  for (const gap of gaps) assert.ok(close(gap, gaps[0], 1e-9));
});

test("log levels are strictly inside the floor and the max", () => {
  const levels = contourLevels(weight(), 8, LOG);
  const floor = 1 * Math.pow(10, -8);

  for (const level of levels) {
    assert.ok(level > floor, `${level} is at or below the floor`);
    assert.ok(level < 1, `${level} reaches vmax`);
  }
});

test("log levels ascend", () => {
  const levels = contourLevels(weight(), 7, LOG);

  assert.deepEqual([...levels], [...levels].sort((a, b) => a - b));
});

test("log levels are all positive", () => {
  // They feed log-scaled colouring, which rejects non-positive values.
  for (const level of contourLevels(weight(), 50, LOG)) {
    assert.ok(level > 0, `${level}`);
  }
});

test("the decade count sets how far down the levels reach", () => {
  const shallow = contourLevels(weight(), 4, { scale: "log", decades: 4 });
  const deep = contourLevels(weight(), 4, { scale: "log", decades: 16 });

  assert.ok(deep[0] < shallow[0], "more decades should reach further down");
});

test("log spacing spreads a skewed field that linear cannot", () => {
  // The stated motivation: on a 0..1 field with a fast falloff, linear levels
  // land almost entirely inside the top of the range.
  const linear = contourLevels(weight(), 10, LINEAR);
  const log = contourLevels(weight(), 10, LOG);

  assert.ok(linear.filter((v) => v < 0.01).length <= 1, "linear already spread");
  assert.ok(log.filter((v) => v < 0.01).length >= 5, "log did not reach the tail");
});

test("log levels never contain a zero or a NaN", () => {
  for (const level of contourLevels(weight(), 500, { scale: "log", decades: 20 })) {
    assert.ok(Number.isFinite(level) && level > 0, `${level}`);
  }
});

test("levels are distinct at a large count", () => {
  const levels = contourLevels(weight(), 1000, LOG);

  assert.equal(new Set(levels).size, 1000);
});

// --- the per-level checkbox cap --------------------------------------------

test("the cap is a small positive number", () => {
  assert.ok(Number.isInteger(MAX_PER_LEVEL_CHECKBOXES));
  assert.ok(MAX_PER_LEVEL_CHECKBOXES > 0 && MAX_PER_LEVEL_CHECKBOXES < 200);
});

test("the cap is far below the slider maximum", () => {
  // The slider reaches 5000; per-level checkboxes must not be attempted there.
  assert.ok(MAX_PER_LEVEL_CHECKBOXES < 5000 / 10);
});

// --- wireScaleControls ------------------------------------------------------

function fakeElement(tag = "div", value = "") {
  const attrs = {};
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    value,
    disabled: false,
    hidden: false,
    title: "",
    handlers: {},
    attrs,
    classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)), contains: (n) => classes.has(n) },
    getAttribute: (n) => attrs[n],
    setAttribute: (n, v) => { attrs[n] = v; },
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
  };
}

function rig(meta, extra = {}) {
  const els = {
    "scale-linear": fakeElement("button"),
    "scale-log": fakeElement("button"),
    "decades-row": fakeElement(),
    "log-decades": fakeElement("input", "8"),
    "log-decades-label": fakeElement("span"),
    "contour-status": fakeElement(),
    ...extra,
  };
  const doc = { getElementById: (id) => els[id] ?? null };
  const seen = [];
  const controls = wireScaleControls(
    meta,
    { onLevels: (levels) => { seen.push(levels); return levels.length * 2; } },
    doc,
  );
  return { els, seen, controls };
}

test("signed data disables the log button", () => {
  // Log throws on negatives, so the drift field must not be able to select it.
  const { els } = rig(drift());

  assert.equal(els["scale-log"].disabled, true);
});

test("the disabled log button explains why", () => {
  const { els } = rig(drift());

  assert.match(els["scale-log"].title, /non-negative/);
});

test("signed data starts on linear", () => {
  const { els } = rig(drift());

  assert.equal(els["scale-linear"].getAttribute("aria-pressed"), "true");
  assert.equal(els["scale-log"].getAttribute("aria-pressed"), "false");
});

test("non-negative data starts on log", () => {
  // A linear ramp hides everything past the pad on the weighting field.
  const { els } = rig(weight());

  assert.equal(els["scale-log"].getAttribute("aria-pressed"), "true");
  assert.equal(els["scale-log"].disabled, false);
});

test("the decades row is shown only for log", () => {
  assert.equal(rig(weight()).els["decades-row"].hidden, false);
  assert.equal(rig(drift()).els["decades-row"].hidden, true);
});

test("switching to log reveals the decades row", () => {
  const { els } = rig(weight());
  els["scale-linear"].fire("click");
  assert.equal(els["decades-row"].hidden, true);

  els["scale-log"].fire("click");

  assert.equal(els["decades-row"].hidden, false);
});

test("wiring alone emits nothing; the caller drives the first build", () => {
  // viewer.js calls refresh() after wiring, so wireScaleControls must not
  // compute levels before the caller is ready for them.
  const { seen } = rig(weight());

  assert.equal(seen.length, 0);
});

test("refresh emits the current level set", () => {
  const { seen, controls } = rig(weight());

  controls.refresh();

  assert.equal(seen.at(-1).length, 200);
});

test("refreshLevels emits without changing the scale", () => {
  const { seen, controls } = rig(weight());

  controls.refreshLevels();

  assert.equal(seen.at(-1).length, 200);
  assert.equal(controls.getScale().scale, "log");
});

test("the level count is fixed, not read from the panel", () => {
  // The count slider is gone: emitLevels uses CONTOUR_LEVEL_COUNT. A leftover
  // #contour-count element in the document must not influence the count, and
  // firing its events must not drive a rebuild.
  const stray = fakeElement("input", "800");
  const { els, seen, controls } = rig(weight(), { "contour-count": stray });

  controls.refreshLevels();
  assert.equal(seen.at(-1).length, CONTOUR_LEVEL_COUNT);

  const before = seen.length;
  stray.fire("input");
  stray.fire("change");
  assert.equal(seen.length, before, "the stray slider still drives a rebuild");
  assert.equal(els["contour-status"].textContent.includes("800 levels"), false);
});

test("CONTOUR_LEVEL_COUNT is 200", () => {
  assert.equal(CONTOUR_LEVEL_COUNT, 200);
});

test("switching scale re-emits levels with the new spacing", () => {
  const { els, seen } = rig(weight());

  els["scale-linear"].fire("click");
  assert.ok(seen.length > 0, "no levels emitted on scale change");

  const levels = seen.at(-1);
  const gaps = levels.slice(1).map((v, n) => v - levels[n]);
  for (const gap of gaps) assert.ok(close(gap, gaps[0], 1e-9), "not linear");
});

test("the decades slider also recomputes on release, not on drag", () => {
  const { els, seen, controls } = rig(weight());
  controls.refresh();
  const before = seen.at(-1)[0];

  // Unsigned fields now open at FULL_SPAN_DECADES (a3a87c1), so 16 is the
  // shallower window here and must raise the floor rather than lower it.
  els["log-decades"].value = "16";
  els["log-decades"].fire("input");
  assert.equal(seen.at(-1)[0], before, "dragging recomputed");

  els["log-decades"].fire("change");
  assert.ok(seen.at(-1)[0] > before, "a shallower window did not raise the first level");
});

test("dragging decades still updates the label live", () => {
  // The label tracks the drag even though the levels do not.
  const { els } = rig(weight());

  els["log-decades"].value = "12";
  els["log-decades"].fire("input");

  assert.match(els["log-decades-label"].textContent, /^12 /);
});

test("the decades label states the resulting floor", () => {
  const { els } = rig(weight());

  assert.match(els["log-decades-label"].textContent, /floor 1\.0e-40 x max/);
});

test("signed data still opens on the markup's 8 decades", () => {
  // a3a87c1 moved unsigned fields to the full span only. Log is disabled on
  // drift, so its window must be left exactly where the slider says.
  const { els } = rig(drift());

  assert.equal(els["log-decades"].value, "8");
  assert.match(els["log-decades-label"].textContent, /^8 \(floor 1\.0e-8 x max\)/);
});

test("the status line is the only place the level count is reported", () => {
  // The count label went with the slider; nothing writes to it any more.
  const label = fakeElement("span");
  const { els, controls } = rig(weight(), { "contour-count-label": label });
  controls.refresh();

  assert.equal(label.textContent, "");
  assert.match(els["contour-status"].textContent, /200 levels/);
});

test("the status line reports levels, segments and elapsed time", () => {
  // Segments come from the handler's return, so the panel reports what was
  // actually built rather than what was requested.
  const { els, controls } = rig(weight());
  controls.refresh();

  assert.match(els["contour-status"].textContent, /200 levels/);
  assert.match(els["contour-status"].textContent, /400 segments/);
  assert.match(els["contour-status"].textContent, /ms/);
});

test("a missing handler does not break the controls", () => {
  const doc = { getElementById: () => null };

  const controls = wireScaleControls(weight(), {}, doc);

  assert.doesNotThrow(() => controls.refresh());
});

test("a disabled log button cannot be selected by clicking it", () => {
  const { els, controls } = rig(drift());

  els["scale-log"].fire("click");

  assert.equal(controls.getScale().scale, "linear");
});

test("missing controls do not break wiring", () => {
  // The potential panel is absent until a payload loads.
  assert.doesNotThrow(() =>
    wireScaleControls(weight(), {}, { getElementById: () => null }),
  );
});

test("the pressed button is also the active one", () => {
  const { els } = rig(weight());

  for (const name of ["scale-linear", "scale-log"]) {
    const pressed = els[name].getAttribute("aria-pressed") === "true";
    assert.equal(els[name].classList.contains("active"), pressed, name);
  }
});
