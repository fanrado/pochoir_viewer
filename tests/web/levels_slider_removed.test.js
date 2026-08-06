// Coverage for 02e863a "Fix the contour level count at 200" and 17dfac7
// "Remove the levels slider from the panel".
//
// Two halves, and both have to hold together: the count is now the constant
// CONTOUR_LEVEL_COUNT rather than a #contour-count read, and the slider markup
// is gone from the page. A half-done removal is the dangerous case -- markup
// deleted while a module still dereferences the id is a TypeError at startup,
// and a surviving slider that no longer drives anything is a control that lies
// to the user.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CONTOUR_LEVEL_COUNT, contourLevels } from "../../web/potential_view.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const html = () => readFileSync(join(WEB_DIR, "index.html"), "utf8");

// The levels slider (17dfac7) and the per-level checkbox panel it fed
// (af737a4) -- one removal thread, so they are pinned together.
const REMOVED_IDS = ["contour-count", "contour-count-label", "contour-levels"];

// --- the markup is gone -----------------------------------------------------

test("the removed contour-panel ids are absent from index.html", () => {
  const still = REMOVED_IDS.filter((id) => html().includes(`id="${id}"`));
  assert.deepEqual(still, [], `index.html still declares: ${still.join(", ")}`);
});

test("no label still points at the removed slider", () => {
  assert.doesNotMatch(html(), /for="contour-count"/);
});

test("the #contour-levels styling hook went with the element", () => {
  // A rule for a deleted id is dead CSS that makes the element look alive.
  assert.doesNotMatch(html(), /#contour-levels\b/);
});

test("the surrounding contour panel survived the removal", () => {
  // Guards against an over-broad delete taking the neighbouring readouts.
  // #contour-levels is NOT in this list: af737a4 removed it too, with the
  // per-level checkboxes it held.
  for (const id of ["contour-status", "contour-legend", "log-decades"]) {
    assert.ok(html().includes(`id="${id}"`), `removal also dropped id="${id}"`);
  }
});

// --- and nothing still reaches for it ---------------------------------------

test("no web module dereferences a removed slider id", () => {
  const offenders = [];
  for (const file of readdirSync(WEB_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(WEB_DIR, file), "utf8");
    for (const id of REMOVED_IDS) {
      if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) offenders.push(`${file}: ${id}`);
    }
  }
  assert.deepEqual(offenders, [], `still referenced: ${offenders.join(", ")}`);
});

// --- the constant that replaced it ------------------------------------------

test("CONTOUR_LEVEL_COUNT is the shipped 200", () => {
  assert.equal(CONTOUR_LEVEL_COUNT, 200);
});

test("the fixed count is a usable level count", () => {
  // The constant has to satisfy contourLevels' own contract, or the fixed
  // count would be a startup failure rather than a default.
  const levels = contourLevels({ vmin: 0, vmax: 1 }, CONTOUR_LEVEL_COUNT, { scale: "linear", decades: 8 });
  assert.equal(levels.length, CONTOUR_LEVEL_COUNT);
  assert.ok(levels.every((v) => v > 0 && v < 1), "levels escaped the open range");
});

test("the fixed count sits inside the old slider's range", () => {
  // 200 was the slider's default and min was 100: the fix keeps the shipped
  // behaviour rather than changing what users saw.
  assert.ok(CONTOUR_LEVEL_COUNT >= 100 && CONTOUR_LEVEL_COUNT <= 5000);
});
