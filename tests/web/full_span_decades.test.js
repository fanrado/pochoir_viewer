// Coverage for a3a87c1 "Open unsigned fields on the full decades span".
//
// The markup's decades value is 8, which puts the log floor at vmax*1e-8. On
// the weighting field that left the near-cathode region with no contour levels
// at all while the Image layer still painted it -- the two layers disagreed on
// screen. Unsigned fields now open at FULL_SPAN_DECADES and the value is
// written back into the slider so the control matches the drawing. Signed
// drift is untouched: log is disabled there.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTOUR_LEVEL_COUNT,
  FULL_SPAN_DECADES,
  contourLevels,
  wireScaleControls,
} from "../../web/potential_view.js";

const weight = (over = {}) => ({ vmin: 0, vmax: 1, units: "dimensionless", ...over });
const drift = (over = {}) => ({ vmin: -9500, vmax: 0, units: "V", ...over });

function fakeElement(tag = "div", value = "") {
  return {
    tagName: tag.toUpperCase(), value, textContent: "", disabled: false, title: "", hidden: false,
    attrs: {}, handlers: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
  };
}

// The markup's own starting value, so the rig reproduces a real page open.
function rig(meta, decadesValue = "8") {
  const els = {
    "scale-linear": fakeElement("button"),
    "scale-log": fakeElement("button"),
    "decades-row": fakeElement(),
    "log-decades": fakeElement("input", decadesValue),
    "log-decades-label": fakeElement("span"),
    "contour-status": fakeElement(),
  };
  const seen = [];
  const controls = wireScaleControls(
    meta,
    { onLevels: (levels) => { seen.push(levels); return levels.length * 2; } },
    { getElementById: (id) => els[id] ?? null },
  );
  return { els, seen, controls };
}

// --- the constant -----------------------------------------------------------

test("FULL_SPAN_DECADES covers the weighting volume's ~39.5 decades", () => {
  assert.equal(FULL_SPAN_DECADES, 40);
  assert.ok(FULL_SPAN_DECADES >= 39.5);
});

// --- unsigned opens wide ----------------------------------------------------

test("an unsigned field opens on the full span, not the markup's 8", () => {
  const { seen, controls } = rig(weight());
  controls.refreshLevels();

  const expected = contourLevels(weight(), CONTOUR_LEVEL_COUNT, {
    scale: "log",
    decades: FULL_SPAN_DECADES,
  });
  assert.deepEqual(seen.at(-1), expected);
});

test("the slider is pushed to match what is drawn", () => {
  // The stated reason for the write-back: a control showing 8 while 40 decades
  // are drawn is a control that lies.
  const { els } = rig(weight());

  assert.equal(els["log-decades"].value, String(FULL_SPAN_DECADES));
  assert.match(els["log-decades-label"].textContent, /^40 \(floor 1\.0e-40 x max\)/);
});

test("the full span puts levels in the near-cathode region", () => {
  // The bug: at 8 decades nothing below vmax*1e-8 got a level, so Contours went
  // blank where Image still painted.
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  assert.ok(levels[0] < 1e-8, `first level ${levels[0]} is still inside the old floor`);
  assert.ok(levels.some((v) => v < 1e-30), "nothing reaches the deep tail");
  assert.ok(levels.every((v) => v > 0 && v < 1));
});

test("the widened default is still an ascending, finite level set", () => {
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  assert.equal(levels.length, CONTOUR_LEVEL_COUNT);
  assert.ok(levels.every(Number.isFinite));
  assert.ok(levels.every((v, i) => i === 0 || v > levels[i - 1]));
});

// --- signed is untouched ----------------------------------------------------

test("a signed field keeps the markup's decades", () => {
  const { els } = rig(drift());

  assert.equal(els["log-decades"].value, "8", "drift's slider was rewritten");
  assert.equal(els["scale-log"].disabled, true, "log should stay disabled on signed data");
});

test("a signed field starts on linear regardless of the span change", () => {
  const { els } = rig(drift());

  assert.equal(els["scale-linear"].getAttribute("aria-pressed"), "true");
  assert.equal(els["scale-log"].getAttribute("aria-pressed"), "false");
});

test("a signed field honours a non-default slider value", () => {
  // Signed reads the slider; unsigned overrides it. Pin both directions so a
  // future edit cannot collapse them into one branch.
  const signed = rig(drift(), "12");
  assert.equal(signed.els["log-decades"].value, "12");

  const unsigned = rig(weight(), "12");
  assert.equal(unsigned.els["log-decades"].value, String(FULL_SPAN_DECADES));
});

// --- the user can still move it ---------------------------------------------

test("the user can drag back below the full span", () => {
  const { els, seen } = rig(weight());
  const opened = seen.at(-1)?.[0] ?? null;

  // A real slider fires input during the drag and change on release; only the
  // input handler reads the new value, so both are needed.
  els["log-decades"].value = "8";
  els["log-decades"].fire("input");
  els["log-decades"].fire("change");

  assert.ok(seen.at(-1)[0] > (opened ?? 0), "narrowing did not raise the floor");
  assert.match(els["log-decades-label"].textContent, /^8 \(floor 1\.0e-8 x max\)/);
});

test("wiring with no decades slider at all still opens on the full span", () => {
  const seen = [];
  const controls = wireScaleControls(
    weight(),
    { onLevels: (levels) => { seen.push(levels); return 0; } },
    { getElementById: () => null },
  );
  assert.doesNotThrow(() => controls.refreshLevels());
  assert.equal(controls.getScale().decades, FULL_SPAN_DECADES);
});
