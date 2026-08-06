// Coverage for a3a87c1 "Open unsigned fields on the full decades span" as
// revised by 53a4692 "Open unsigned fields at the physics floor, not the full
// span".
//
// The markup's decades value is 8, which puts the log floor at vmax*1e-8. On
// the weighting field that left the near-cathode region with no contour levels
// at all while the Image layer still painted it -- the two layers disagreed on
// screen. Unsigned fields now open at PHYSICS_FLOOR_DECADES and the value is
// written back into the slider so the control matches the drawing.
//
// 12, not the full ~39.5-decade span: below 1e-12 the weighting values are
// relaxation-solver residue, and with the count fixed at 200 a full-span open
// spends most of the levels on noise. Both halves matter, so this file pins
// the floor from both sides -- deep enough to reach the near-cathode field,
// shallow enough not to drown it in residue.
//
// Signed drift is untouched: log is disabled there.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTOUR_LEVEL_COUNT,
  PHYSICS_FLOOR_DECADES,
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

test("PHYSICS_FLOOR_DECADES reaches the 1e-12 physics floor", () => {
  assert.equal(PHYSICS_FLOOR_DECADES, 12);
});

test("the default is deeper than the markup's 8 but well short of the full span", () => {
  // The whole point of 53a4692: past the near-cathode blank spot, short of the
  // ~39.5-decade residue tail.
  assert.ok(PHYSICS_FLOOR_DECADES > 8, "no deeper than the markup default");
  assert.ok(PHYSICS_FLOOR_DECADES < 39.5, "back to opening on solver residue");
});

// --- unsigned opens at the floor --------------------------------------------

test("an unsigned field opens at the physics floor, not the markup's 8", () => {
  const { seen, controls } = rig(weight());
  controls.refreshLevels();

  const expected = contourLevels(weight(), CONTOUR_LEVEL_COUNT, {
    scale: "log",
    decades: PHYSICS_FLOOR_DECADES,
  });
  assert.deepEqual(seen.at(-1), expected);
});

test("the slider is pushed to match what is drawn", () => {
  // The stated reason for the write-back: a control showing 8 while 12 decades
  // are drawn is a control that lies.
  const { els } = rig(weight());

  assert.equal(els["log-decades"].value, String(PHYSICS_FLOOR_DECADES));
  assert.match(els["log-decades-label"].textContent, /^12 \(floor 1\.0e-12 x max\)/);
});

test("the default puts levels in the near-cathode region", () => {
  // The original bug: at 8 decades nothing below vmax*1e-8 got a level, so
  // Contours went blank where Image still painted.
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  assert.ok(levels[0] < 1e-8, `first level ${levels[0]} is still inside the old floor`);
});

test("the default does not spend its levels on solver residue", () => {
  // The regression 53a4692 fixed: on the full span most of the fixed 200
  // levels landed below 1e-12, thinning the meaningful range fivefold.
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  const residue = levels.filter((v) => v < 1e-12);
  assert.equal(residue.length, 0, `${residue.length} levels landed in the residue tail`);
});

test("most of the default's levels sit in the physically meaningful range", () => {
  // Stated as a proportion so a future floor change has to face this directly:
  // the point of the default is that the levels describe field, not noise.
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  const meaningful = levels.filter((v) => v >= 1e-12 && v <= 1);
  assert.ok(
    meaningful.length / levels.length > 0.95,
    `only ${meaningful.length}/${levels.length} levels are above the physics floor`,
  );
});

test("the default is still an ascending, finite, in-range level set", () => {
  const { seen, controls } = rig(weight());
  controls.refreshLevels();
  const levels = seen.at(-1);

  assert.equal(levels.length, CONTOUR_LEVEL_COUNT);
  assert.ok(levels.every(Number.isFinite));
  assert.ok(levels.every((v) => v > 0 && v < 1));
  assert.ok(levels.every((v, i) => i === 0 || v > levels[i - 1]));
});

// --- signed is untouched ----------------------------------------------------

test("a signed field keeps the markup's decades", () => {
  const { els } = rig(drift());

  assert.equal(els["log-decades"].value, "8", "drift's slider was rewritten");
  assert.equal(els["scale-log"].disabled, true, "log should stay disabled on signed data");
});

test("a signed field starts on linear regardless of the floor change", () => {
  const { els } = rig(drift());

  assert.equal(els["scale-linear"].getAttribute("aria-pressed"), "true");
  assert.equal(els["scale-log"].getAttribute("aria-pressed"), "false");
});

test("a signed field honours a non-default slider value", () => {
  // Signed reads the slider; unsigned overrides it. Pin both directions so a
  // future edit cannot collapse them into one branch.
  const signed = rig(drift(), "20");
  assert.equal(signed.els["log-decades"].value, "20");

  const unsigned = rig(weight(), "20");
  assert.equal(unsigned.els["log-decades"].value, String(PHYSICS_FLOOR_DECADES));
});

// --- the user can still reach the tail --------------------------------------

test("the residue tail is still reachable by dragging to 40", () => {
  // 53a4692 narrows the default, not the control: "the slider still reaches 40
  // for anyone who wants to look at the residue tail".
  const { els, seen } = rig(weight());
  const opened = seen.at(-1)?.[0] ?? null;

  els["log-decades"].value = "40";
  els["log-decades"].fire("input");
  els["log-decades"].fire("change");

  assert.ok(seen.at(-1)[0] < 1e-12, "40 decades no longer reaches the residue tail");
  if (opened !== null) assert.ok(seen.at(-1)[0] < opened, "widening did not lower the floor");
  assert.match(els["log-decades-label"].textContent, /^40 \(floor 1\.0e-40 x max\)/);
});

test("the user can also drag back up to the markup's 8", () => {
  const { els, seen, controls } = rig(weight());
  controls.refreshLevels();
  const opened = seen.at(-1)[0];

  els["log-decades"].value = "8";
  els["log-decades"].fire("input");
  els["log-decades"].fire("change");

  assert.ok(seen.at(-1)[0] > opened, "narrowing did not raise the floor");
  assert.match(els["log-decades-label"].textContent, /^8 \(floor 1\.0e-8 x max\)/);
});

test("wiring with no decades slider at all still opens at the floor", () => {
  const controls = wireScaleControls(
    weight(),
    { onLevels: () => 0 },
    { getElementById: () => null },
  );
  assert.doesNotThrow(() => controls.refreshLevels());
  assert.equal(controls.getScale().decades, PHYSICS_FLOOR_DECADES);
});

// --- the old name is gone ---------------------------------------------------

test("FULL_SPAN_DECADES is no longer exported under its old name", async () => {
  // 53a4692 renamed it because 12 is not a full span. A lingering export would
  // let a stale import keep the old meaning alive.
  const mod = await import("../../web/potential_view.js");
  assert.equal("FULL_SPAN_DECADES" in mod, false);
});
