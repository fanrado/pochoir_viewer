// Coverage for c60693e "Remove isosurface and opacity controls from the page".
//
// The commit deleted the iso markup from index.html only. These checks pin
// both halves of that change: the markup really is gone, AND no shipped module
// still reaches for the ids it deleted. The second half is what turns a tidy-up
// into a crash -- viewer.js runs `getElementById("iso-levels").replaceChildren()`
// unguarded at startup, so a missing id is a TypeError before the first frame,
// not a silently dead control.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const html = () => readFileSync(join(WEB_DIR, "index.html"), "utf8");

// Everything the commit removed from the page.
const REMOVED_IDS = ["iso-controls", "iso-opacity", "iso-opacity-label", "iso-levels", "layer-iso"];
const REMOVED_CLASSES = ["iso-skipped"];

test("the removed iso control ids are absent from index.html", () => {
  const still = REMOVED_IDS.filter((id) => html().includes(`id="${id}"`));
  assert.deepEqual(still, [], `index.html still declares removed iso ids: ${still.join(", ")}`);
});

test("the removed iso styling hook is absent from index.html", () => {
  const still = REMOVED_CLASSES.filter((c) => html().includes(c));
  assert.deepEqual(still, [], `index.html still mentions removed iso classes: ${still.join(", ")}`);
});

test("the surviving panel sections are untouched by the removal", () => {
  // Guards against an over-broad delete taking neighbouring controls with it.
  for (const id of ["slice-idx", "log-decades", "zscale", "npaths",
                    "layer-paths", "layer-slice", "layer-boundary", "volt-readout"]) {
    assert.ok(html().includes(`id="${id}"`), `removal also dropped id="${id}"`);
  }
});

test("no web module dereferences a removed iso id", () => {
  // getElementById(...) returns null for a deleted id; any property access or
  // call chained straight off it throws on load.
  const offenders = [];
  for (const file of readdirSync(WEB_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(WEB_DIR, file), "utf8");
    for (const id of REMOVED_IDS) {
      if (new RegExp(`getElementById\\(\\s*["'\`]${id}["'\`]\\s*\\)\\s*[.?[]`).test(src)) {
        offenders.push(`${file}: getElementById("${id}") used without a null guard`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("no web module wires a layer button that no longer exists", () => {
  const offenders = [];
  for (const file of readdirSync(WEB_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(WEB_DIR, file), "utf8");
    if (/["'`]layer-iso["'`]/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `still reference the removed layer-iso button: ${offenders.join(", ")}`);
});
