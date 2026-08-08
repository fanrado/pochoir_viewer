// Static checks on the induced-current panel markup (60167fa).
//
// A shell with no behaviour yet, so there is little to test by running it. The
// two things worth pinning are the ones whose comments in index.html state a
// dependency on code elsewhere, because a comment cannot fail:
//
//   1. top: 120px is derived from viewcube.js's SIZE_PX + 2*INSET_PX. That is
//      computed here from the constants rather than restated, so moving either
//      one fails this file instead of silently sliding the panel under the
//      cube.
//   2. pointer-events: none on the panel with auto on its interactive
//      children. Getting this wrong does not break the panel -- it breaks
//      orbit on the region of canvas behind it, which is the kind of thing
//      nobody notices until they try to rotate the scene.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
const viewcube = readFileSync(join(ROOT, "web", "viewcube.js"), "utf8");

/** The body of the CSS rule for this selector. */
function rule(selector) {
  const match = html.match(
    new RegExp(`${selector.replace(/[#.]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

/** A numeric const from viewcube.js. */
function viewcubeConst(name) {
  const match = viewcube.match(new RegExp(`const ${name} = (\\d+)`));
  assert.ok(match, `viewcube.js no longer defines ${name}`);
  return Number(match[1]);
}

const PIXELS = ["central", "neighbor-x", "neighbor-y", "diagonal"];

// --- the elements exist -----------------------------------------------------

test("the panel and its parts are in the page", () => {
  for (const id of ["current-panel", "current-grid", "current-play"]) {
    assert.ok(html.includes(`id="${id}"`), `no #${id}`);
  }
});

test("there is one canvas per pixel, named for the trace it draws", () => {
  // The four ids must line up with pixel_traces' four keys, since that is
  // what the payload will be keyed by.
  for (const pixel of PIXELS) {
    assert.match(
      html,
      new RegExp(`<canvas id="current-${pixel}"`),
      `no canvas for ${pixel}`,
    );
  }
});

test("the panel holds exactly four canvases", () => {
  const panel = html.slice(html.indexOf('<div id="current-panel">'));
  const grid = panel.slice(0, panel.indexOf("</div>", panel.indexOf("</canvas>")));

  assert.equal((grid.match(/<canvas /g) ?? []).length, 4);
});

test("each canvas is labelled for a screen reader", () => {
  const labels = [...html.matchAll(/<canvas id="current-[\w-]+"[^>]*aria-label="([^"]+)"/g)];

  assert.equal(labels.length, 4, "a current canvas has no aria-label");
  assert.equal(new Set(labels.map((m) => m[1])).size, 4, "two canvases share a label");
});

test("the panel ids are unique in the page", () => {
  for (const id of ["current-panel", "current-grid", "current-play", ...PIXELS.map((p) => `current-${p}`)]) {
    assert.equal(
      (html.match(new RegExp(`id="${id}"`, "g")) ?? []).length,
      1,
      `id="${id}" is declared more than once`,
    );
  }
});

// --- the view cube offset, computed rather than restated --------------------

test("the panel clears the view cube by exactly its drawn footprint", () => {
  // The comment in index.html says 12 + 96 + 12 = 120. Derive it, so that
  // changing SIZE_PX or INSET_PX fails here rather than overlapping.
  const expected = viewcubeConst("INSET_PX") * 2 + viewcubeConst("SIZE_PX");

  assert.match(rule("#current-panel"), new RegExp(`top: ${expected}px`));
});

test("the panel is pinned to the same edge the cube is drawn on", () => {
  // Clearing the cube vertically only matters if they share the right edge.
  assert.match(rule("#current-panel"), /position: fixed/);
  assert.match(rule("#current-panel"), /right: \d+px/);
});

test("the cube constants the offset depends on are still there", () => {
  // A rename would make viewcubeConst throw rather than quietly pass.
  assert.equal(viewcubeConst("SIZE_PX"), 96);
  assert.equal(viewcubeConst("INSET_PX"), 12);
});

// --- pointer-events discipline ----------------------------------------------

test("the panel itself does not swallow drags meant for the canvas", () => {
  assert.match(rule("#current-panel"), /pointer-events: none/);
});

test("the canvases opt back in", () => {
  assert.match(rule("#current-grid canvas"), /pointer-events: auto/);
});

test("the play button opts back in", () => {
  // Without this the button would be inert: the panel's `none` inherits.
  assert.match(rule("#current-play"), /pointer-events: auto/);
});

test("every interactive child of the panel re-enables pointer events", () => {
  // Stated as a sweep so a fifth control added later cannot be forgotten.
  const panel = html.slice(
    html.indexOf('<div id="current-panel">'),
    html.indexOf("<div id=\"readout\">"),
  );
  const interactive = [...panel.matchAll(/<(canvas|button|input|select)[^>]*id="([^"]+)"/g)];
  assert.ok(interactive.length >= 5, "the panel lost its controls");

  for (const [, , id] of interactive) {
    const own = rule(`#${id}`);
    const covered = own?.includes("pointer-events: auto")
      || rule("#current-grid canvas")?.includes("pointer-events: auto");
    assert.ok(covered, `#${id} is inert: nothing re-enables pointer events`);
  }
});

// --- the 2x2 layout the comment describes -----------------------------------

test("the grid is two columns, so the canvases form a 2x2", () => {
  assert.match(rule("#current-grid"), /grid-template-columns: 1fr 1fr/);
});

test("the canvases are ordered to mirror the pixels in space", () => {
  // central, x-neighbour, y-neighbour, diagonal -- in that source order the
  // 2-column grid puts the x-neighbour beside the central pixel and the
  // y-neighbour below it, which is what the comment claims.
  const order = [...html.matchAll(/<canvas id="current-([\w-]+)"/g)].map((m) => m[1]);

  assert.deepEqual(order, PIXELS);
});

// --- it does not disturb what is already on screen --------------------------

test("the two fixed panels are on opposite edges", () => {
  // The only reason they cannot overlap. #panel's own comment explains that
  // it stays on the LEFT precisely to avoid reserving top-right clearance;
  // #current-panel is the first element to take that clearance on, so if
  // #panel ever moved right the two would fight for the same corner.
  const main = rule("#panel");

  assert.match(main, /left: \d+px/, "the main panel is no longer left-anchored");
  assert.equal(/(^|;)\s*right:/.test(main), false, "the main panel now claims the right edge");
  assert.match(rule("#current-panel"), /right: \d+px/);
});

test("the readout is still the last fixed element declared", () => {
  assert.ok(
    html.indexOf('<div id="current-panel">') < html.indexOf('<div id="readout">'),
    "the panel was inserted after the readout",
  );
});

// --- the 3x enlargement (e1bdfa1) --------------------------------------------
//
// The panel went from 260px wide with 60px canvases to 780px with 180px ones.
// Both fixed panels are pinned to opposite edges at fixed widths, so the two
// now have a hard minimum viewport width below which they overlap. That is
// arithmetic, not opinion, so it is computed rather than asserted as a number.

function px(rule_, name) {
  const match = rule_.match(new RegExp(`${name}: (\\d+)px`));
  return match ? Number(match[1]) : null;
}

test("the canvases are tall enough to read a waveform", () => {
  // A 60px panel showed a bipolar trace as ~25px of swing either side.
  assert.ok(px(rule("#current-grid canvas"), "height") >= 120);
});

test("all four canvases are the same size", () => {
  // "so no slot reads as more important than another" -- with the panels now
  // holding four unrelated paths, a larger first panel would imply a primary.
  const css = rule("#current-grid canvas");

  assert.match(css, /width: 100%/);
  assert.equal(rule('#current-grid canvas:first-child'), null, "a per-canvas override appeared");
});

test("the grid is still 2x2", () => {
  assert.match(rule("#current-grid"), /grid-template-columns: 1fr 1fr/);
});

test("the two fixed panels need a wide window not to overlap", () => {
  // Computed from the stylesheet: left panel + right panel + both insets.
  // Recorded rather than judged -- if this exceeds a laptop's viewport it is
  // worth a decision, and either way a future width change moves it visibly.
  const current = rule("#current-panel");
  const main = rule("#panel");
  const minimum =
    px(main, "left") + px(main, "width") + px(current, "width") + px(current, "right");

  assert.equal(minimum, 1024, `the panels now need ${minimum}px of width, not 1024`);
});

test("the enlarged panel still clears the view cube", () => {
  // Widening moves it left, not up, so the cube offset is unchanged -- but
  // this is the check that would catch a top: edit made alongside a width one.
  const expected = viewcubeConst("INSET_PX") * 2 + viewcubeConst("SIZE_PX");

  assert.match(rule("#current-panel"), new RegExp(`top: ${expected}px`));
});

test("the panel still does not swallow drags meant for the canvas", () => {
  // It now covers three times as much of the window, so the pointer-events
  // discipline matters more than it did, not less.
  assert.match(rule("#current-panel"), /pointer-events: none/);
  assert.match(rule("#current-grid canvas"), /pointer-events: auto/);
});

test("the layout comment describes selection slots, not pad neighbours", () => {
  // The CSS comment was the last place the pad-role reading survived.
  const css = html.slice(html.indexOf("#current-grid canvas") - 400, html.indexOf("#current-grid canvas"));

  assert.match(css, /SELECTION SLOTS/);
  assert.equal(/the x-neighbour beside it/.test(css), false);
});
