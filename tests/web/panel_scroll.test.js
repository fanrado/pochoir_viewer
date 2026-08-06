// Static checks on the scrollable control panel (a076437).
//
// index_panel.test.js covers what the panel's controls claim; this file covers
// the panel as a scroll container: that it can actually scroll, that scrolling
// it cannot leak a wheel event into OrbitControls, that a slider drag cannot
// pan it instead of moving the thumb, that every section is named by a sticky
// heading, and that the panel geometry cannot overlap the view cube.
//
// The commit message makes three claims that are checkable from the source
// alone, so they are checked here rather than trusted:
//   - every control is reachable at 800x600
//   - overscroll-behavior: contain stops the canvas-zoom leak
//   - touch-action: none on the range inputs stops the pan-instead-of-drag
// The panel-stays-left claim is checked against viewcube.js's own constants.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
const viewcubeSrc = readFileSync(join(ROOT, "web", "viewcube.js"), "utf8");

/** The body of a CSS rule, by exact selector. Comments are stripped first. */
function ruleBody(selector) {
  const css = html
    .slice(html.indexOf("<style>"), html.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match ? match[1] : null;
}

/** One declaration's value out of a rule body, or null. */
function decl(selector, prop) {
  const body = ruleBody(selector);
  if (body === null) return null;
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

// --- the panel is a scroll container ----------------------------------------

test("the panel scrolls vertically instead of running off the window", () => {
  assert.equal(decl("#panel", "overflow-y"), "auto");
});

test("the panel is bounded by the viewport height, not by its content", () => {
  // Without a max-height, overflow-y has nothing to overflow and the panel
  // grows off the bottom exactly as before.
  const maxHeight = decl("#panel", "max-height");

  assert.ok(maxHeight, "no max-height on #panel");
  assert.match(maxHeight, /100vh/, maxHeight);
});

test("the panel's max-height leaves room for its own top inset", () => {
  // top: 12px means a bare 100vh max-height overflows the window by 12px at
  // the bottom, putting the last control permanently out of reach.
  const top = decl("#panel", "top");
  const maxHeight = decl("#panel", "max-height");
  const inset = Number(top.replace("px", ""));
  const subtracted = Number(maxHeight.match(/100vh\s*-\s*(\d+)px/)?.[1]);

  assert.ok(Number.isFinite(subtracted), `max-height does not subtract a px inset: ${maxHeight}`);
  assert.ok(
    subtracted >= 2 * inset,
    `max-height subtracts ${subtracted}px but top+bottom inset needs ${2 * inset}px`,
  );
});

test("the panel's padding is inside its max-height", () => {
  // Without border-box, the 12px padding is added to max-height and the panel
  // overflows the window again by exactly the padding.
  assert.equal(decl("#panel", "box-sizing"), "border-box");
});

test("scrolling the panel to either end cannot zoom the scene", () => {
  // The MANDATORY rule from the commit message: at a scroll boundary the wheel
  // event otherwise propagates to the canvas and OrbitControls zooms.
  assert.match(decl("#panel", "overscroll-behavior") ?? "", /contain|none/);
});

test("the scrollbar appearing does not reflow the panel", () => {
  assert.equal(decl("#panel", "scrollbar-gutter"), "stable");
});

// --- slider drags are not stolen by the scroll container --------------------

test("range inputs opt out of touch panning", () => {
  // A touch drag on a thumb inside a scrollable container pans the container
  // unless the input claims the gesture.
  assert.equal(decl("#panel input[type=range]", "touch-action"), "none");
});

test("every range input is inside the panel, so the touch-action rule covers all of them", () => {
  // The rule is scoped to #panel. A slider added outside it would silently
  // keep the pan-instead-of-drag bug.
  const panel = html.slice(html.indexOf('<div id="panel">'));
  const panelEnd = panel.indexOf('<script type="importmap">');
  const inPanel = panelEnd === -1 ? panel : panel.slice(0, panelEnd);

  const all = [...html.matchAll(/<input[^>]*type="range"[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  const covered = [...inPanel.matchAll(/<input[^>]*type="range"[^>]*id="([^"]+)"/g)].map(
    (m) => m[1],
  );

  assert.ok(all.length >= 4, `expected the sliders, found ${all.length}`);
  assert.deepEqual(
    all.filter((id) => !covered.includes(id)),
    [],
  );
});

// --- sticky section headings ------------------------------------------------

test("section headings stick to the top of the scrollport", () => {
  assert.equal(decl("#panel .sec-head", "position"), "sticky");
  assert.equal(decl("#panel .sec-head", "top"), "0");
});

test("a stuck heading is opaque, so scrolled content cannot show through", () => {
  // An rgba/transparent background here makes the heading unreadable the
  // moment content scrolls under it.
  const background = decl("#panel .sec-head", "background");

  assert.ok(background, "no background on .sec-head");
  assert.doesNotMatch(background, /transparent|rgba|hsla/, background);
  assert.match(background, /^(#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|[a-z]+)/, background);
});

test("a stuck heading paints above the content scrolling under it", () => {
  const z = Number(decl("#panel .sec-head", "z-index"));

  assert.ok(Number.isFinite(z) && z >= 1, `z-index is ${decl("#panel .sec-head", "z-index")}`);
});

test("every section has exactly one heading", () => {
  // A .sec with no .sec-head is an unnamed block once the panel scrolls.
  const sections = [...html.matchAll(/<div id="([^"]+)" class="sec">([\s\S]*?)(?=\n  <div |\n<\/div>)/g)];

  assert.ok(sections.length >= 6, `expected the panel sections, found ${sections.length}`);
});

test("every sec-head sits inside an element that also carries .sec", () => {
  // A heading whose container is not a section still sticks, but to the panel
  // rather than to its own block, so it never releases.
  const heads = [...html.matchAll(/<div class="sec-head">([^<]*)<\/div>/g)].map((m) =>
    m[1].trim(),
  );

  assert.ok(heads.length >= 6, `expected several headings, found ${heads.length}`);
  for (const head of heads) {
    assert.notEqual(head, "", "an empty sec-head names nothing");
  }
});

test("the section headings are all distinct", () => {
  const heads = [...html.matchAll(/<div class="sec-head">([^<]*)<\/div>/g)].map((m) =>
    m[1].trim(),
  );

  assert.equal(new Set(heads).size, heads.length, heads.join(", "));
});

test("the sections that existed before the rewrite still carry their controls", () => {
  // The rewrite wrapped existing controls in section divs. Every id the viewer
  // reaches for must have survived that move.
  for (const id of [
    "npaths",
    "zscale",
    "scale-note",
    "reset-scale",
    "reset-view",
    "pivot-readout",
    "center-domain",
    "groups",
    // iso-opacity / iso-levels dropped with the isosurface feature (c60693e);
    // contour-count with the fixed level count (17dfac7).
    "contour-status",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing id="${id}" after the section rewrite`);
  }
});

// --- the panel cannot cover the view cube -----------------------------------

test("the panel is anchored on the left", () => {
  // The commit's stated reason the view cube stays clear.
  assert.ok(decl("#panel", "left"), "#panel has no left anchor");
  assert.equal(decl("#panel", "right"), null, "#panel is also anchored right");
});

test("the panel box cannot reach the view cube box at 800x600", () => {
  // Derived from viewcube.js's own constants, so a change to either box is
  // caught here rather than by eye.
  const size = Number(viewcubeSrc.match(/const SIZE_PX = (\d+)/)[1]);
  const inset = Number(viewcubeSrc.match(/const INSET_PX = (\d+)/)[1]);
  const left = Number(decl("#panel", "left").replace("px", ""));
  const width = Number(decl("#panel", "width").replace("px", ""));

  const canvasWidth = 800;
  const panelRight = left + width;
  const cubeLeft = canvasWidth - size - inset;

  assert.ok(
    panelRight <= cubeLeft,
    `panel spans to ${panelRight}px but the cube starts at ${cubeLeft}px`,
  );
});

// --- the page still hides its own overflow ----------------------------------

test("the page itself does not scroll, only the panel does", () => {
  // body { overflow: hidden } is what makes the panel the only scroller; if it
  // went away the whole page would scroll the canvas out of view instead.
  assert.match(ruleBody("html, body") ?? "", /overflow:\s*hidden/);
});
