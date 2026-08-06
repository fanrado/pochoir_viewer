// Coverage for aa20183 "Widen the decades slider to 40".
//
// The weighting volume spans about 39.5 decades. At the old max of 20 the log
// floor vmax*10^-decades sat ~19 decades above the smallest real values, so the
// near-cathode field had no levels in it at all and the slider could not be
// dragged far enough to fix that. These checks pin the new range and the thing
// the range is for: 40 decades must actually reach the bottom of the data.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { contourLevels, wireScaleControls } from "../../web/potential_view.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");

const sliderTag = html.match(/<input[^>]*id="log-decades"[^>]*>/)?.[0] ?? "";
const attr = (name) => sliderTag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

const LOG = (decades) => ({ scale: "log", decades });
const weight = { vmin: 0, vmax: 1, units: "dimensionless" };

// --- the markup -------------------------------------------------------------

test("the decades slider reaches 40", () => {
  assert.ok(sliderTag, "no #log-decades input in index.html");
  assert.equal(attr("max"), "40");
});

test("the rest of the decades slider is unchanged", () => {
  // The commit widened the top end only: a moved min, step or default would
  // silently change what every user sees on open.
  assert.equal(attr("min"), "2");
  assert.equal(attr("step"), "1");
  assert.equal(attr("value"), "8");
  assert.equal(attr("type"), "range");
});

test("the max covers the weighting volume's own span", () => {
  // ~39.5 decades is the number the commit message cites as the requirement.
  assert.ok(Number(attr("max")) >= 39.5, "40 decades no longer covers the data");
});

// --- what the new reach buys ------------------------------------------------

test("40 decades puts levels below where 20 decades bottomed out", () => {
  const wide = contourLevels(weight, 200, LOG(40));
  const narrow = contourLevels(weight, 200, LOG(20));
  assert.ok(wide[0] < narrow[0], "widening did not lower the first level");
  assert.ok(wide[0] < 1e-20, `first level ${wide[0]} still above the old floor`);
});

test("40 decades reaches the bottom of a ~39.5-decade volume", () => {
  // The point of the change: the smallest real values must fall inside the
  // level set rather than under its floor.
  const smallest = Math.pow(10, -39.5);
  const levels = contourLevels(weight, 200, LOG(40));
  assert.ok(levels[0] < smallest, `floor ${levels[0]} still above ${smallest}`);
});

test("levels stay ordered and inside the open range at 40 decades", () => {
  const levels = contourLevels(weight, 200, LOG(40));
  assert.equal(levels.length, 200);
  assert.ok(levels.every((v) => v > 0 && v < 1), "a level escaped (0, vmax)");
  assert.ok(levels.every((v, i) => i === 0 || v > levels[i - 1]), "levels are not ascending");
  assert.ok(levels.every(Number.isFinite), "a level is not finite");
});

test("a per-slice positive vmin still wins over the 40-decade window", () => {
  // The floor is max(vmin, vmax*10^-decades): widening the window must not
  // drag a narrow slice's levels down below the slice's own data.
  const slice = { vmin: 3.7e-4, vmax: 5.0e-4 };
  const levels = contourLevels(slice, 50, LOG(40));
  assert.ok(levels[0] > slice.vmin, "levels fell below the slice minimum");
  assert.ok(levels.at(-1) < slice.vmax);
});

// --- the panel accepts the new top end --------------------------------------

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

test("dragging decades to 40 drives the levels and the label", () => {
  const els = {
    "scale-linear": fakeElement("button"),
    "scale-log": fakeElement("button"),
    "decades-row": fakeElement(),
    "log-decades": fakeElement("input", "8"),
    "log-decades-label": fakeElement("span"),
    "contour-status": fakeElement(),
  };
  const seen = [];
  const controls = wireScaleControls(
    weight,
    { onLevels: (levels) => { seen.push(levels); return levels.length * 2; } },
    { getElementById: (id) => els[id] ?? null },
  );
  // Unsigned fields open at the full span (a3a87c1), so drag down to 20 first
  // to establish the old ceiling, then back to 40.
  els["log-decades"].value = "20";
  els["log-decades"].fire("input");
  els["log-decades"].fire("change");
  const atTwenty = seen.at(-1)[0];

  els["log-decades"].value = "40";
  els["log-decades"].fire("input");
  assert.match(els["log-decades-label"].textContent, /^40 /);

  els["log-decades"].fire("change");
  assert.ok(seen.at(-1)[0] < atTwenty, "40 decades did not lower the first level");
  assert.ok(seen.at(-1).every(Number.isFinite));
});
