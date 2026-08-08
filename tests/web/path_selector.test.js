// Static checks on the 10x10 path selector markup (fd7f8e2).
//
// 100 hand-written buttons is a lot of markup to get subtly wrong, and the way
// it goes wrong is not visible: a missing or duplicated (i, j) still renders as
// a tidy grid. So the whole set is reconstructed from data-i/data-j and checked
// for completeness rather than spot-checked.
//
// The orientation is the other half. The comment says columns are i and rows
// are j with the LARGEST j on top, "so the pattern on screen matches the
// physical seeding rather than a vertical mirror of it". A vertical mirror
// would look perfectly plausible on screen and would mislabel every path in
// the y direction, so source order is pinned exactly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");

const M = 10;

/** Every path cell, in source order. */
const cells = [...html.matchAll(/<button class="path-cell"([^>]*)>([^<]*)<\/button>/g)].map(
  ([, attrs, text]) => ({
    attrs,
    text: text.trim(),
    i: Number(attrs.match(/data-i="(\d+)"/)?.[1]),
    j: Number(attrs.match(/data-j="(\d+)"/)?.[1]),
    pressed: attrs.match(/aria-pressed="(\w+)"/)?.[1],
    title: attrs.match(/title="([^"]*)"/)?.[1],
  }),
);

function rule(selector) {
  const match = html.match(
    new RegExp(`${selector.replace(/[#.[\]="]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

// --- the grid is complete ----------------------------------------------------

test("there is one cell per path", () => {
  assert.equal(cells.length, M * M);
});

test("every (i, j) in the 10x10 domain appears exactly once", () => {
  // A duplicate would silently shadow a missing one, and both still render.
  const seen = new Map();
  for (const cell of cells) seen.set(`${cell.i},${cell.j}`, (seen.get(`${cell.i},${cell.j}`) ?? 0) + 1);

  const missing = [];
  const duplicated = [];
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const count = seen.get(`${i},${j}`) ?? 0;
      if (count === 0) missing.push(`(${i}, ${j})`);
      if (count > 1) duplicated.push(`(${i}, ${j}) x${count}`);
    }
  }

  assert.deepEqual(missing, [], `absent: ${missing.join(" ")}`);
  assert.deepEqual(duplicated, [], `repeated: ${duplicated.join(" ")}`);
});

test("no cell names a path outside the domain", () => {
  for (const cell of cells) {
    assert.ok(Number.isInteger(cell.i) && cell.i >= 0 && cell.i < M, `bad i: ${cell.attrs}`);
    assert.ok(Number.isInteger(cell.j) && cell.j >= 0 && cell.j < M, `bad j: ${cell.attrs}`);
  }
});

// --- the orientation ----------------------------------------------------------

test("the grid is ten columns wide, so source order lays out rows", () => {
  // Everything below depends on this: with any other column count the source
  // order would wrap differently and the orientation claim would not hold.
  assert.match(rule("#path-grid"), /grid-template-columns: repeat\(10, 1fr\)/);
});

test("columns are i, ascending left to right", () => {
  for (let row = 0; row < M; row++) {
    const is = cells.slice(row * M, row * M + M).map((c) => c.i);
    assert.deepEqual(is, [...Array(M).keys()], `row ${row} is not i-ascending`);
  }
});

test("rows are j, with the largest on top", () => {
  // The stated point: a vertical mirror would look fine and be wrong.
  const js = [];
  for (let row = 0; row < M; row++) js.push(cells[row * M].j);

  assert.deepEqual(js, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test("every cell in a row shares that row's j", () => {
  for (let row = 0; row < M; row++) {
    const rowCells = cells.slice(row * M, row * M + M);
    assert.equal(new Set(rowCells.map((c) => c.j)).size, 1, `row ${row} mixes j values`);
  }
});

test("the top-left cell is the largest j at the smallest i", () => {
  // One concrete anchor, so a reader can check the orientation by eye.
  assert.equal(cells[0].i, 0);
  assert.equal(cells[0].j, 9);
  assert.equal(cells.at(-1).i, 9);
  assert.equal(cells.at(-1).j, 0);
});

// --- labels and titles --------------------------------------------------------

test("each cell's label is its own coordinates", () => {
  for (const cell of cells) {
    assert.equal(cell.text, `${cell.i},${cell.j}`, `label ${cell.text} on (${cell.i}, ${cell.j})`);
  }
});

test("each cell's title names the same path its data attributes do", () => {
  // The title is what a user reads on hover; a mismatch would be invisible
  // until someone trusted it.
  for (const cell of cells) {
    assert.equal(cell.title, `path (${cell.i}, ${cell.j})`, cell.attrs);
  }
});

test("every cell starts unpressed", () => {
  const pressed = cells.filter((c) => c.pressed !== "false");

  assert.deepEqual(pressed.map((c) => `(${c.i}, ${c.j})`), []);
});

test("every cell carries aria-pressed, so the toggle state is announced", () => {
  assert.equal(cells.filter((c) => c.pressed === undefined).length, 0);
});

// --- the surrounding controls -------------------------------------------------

test("the selector and its clear button are in the page", () => {
  for (const id of ["path-select", "path-grid", "path-clear"]) {
    assert.ok(html.includes(`id="${id}"`), `no #${id}`);
  }
});

test("the grid is announced as one labelled group", () => {
  // 100 unlabelled buttons in a row is unusable with a screen reader.
  assert.match(html, /<div id="path-grid" role="group" aria-label="select drift paths">/);
});

test("the cells and the clear button escape the panel's pointer-events none", () => {
  // #current-panel is pointer-events: none so drags reach the canvas behind
  // it; anything clickable inside has to opt back in or it is inert.
  assert.match(rule("#path-grid button.path-cell"), /pointer-events: auto/);
  assert.match(rule("#path-clear"), /pointer-events: auto/);
});

test("a pressed cell is styled distinctly from an unpressed one", () => {
  // aria-pressed is the state; without a visual rule the grid cannot be read.
  const on = rule('#path-grid button.path-cell[aria-pressed="true"]');

  assert.ok(on, "no pressed-state rule");
  assert.match(on, /background: #3f6fd0/);
});

test("the cells override the panel-wide button styling", () => {
  // #panel button rules set width and margin-top; a 100-cell grid inheriting
  // them would blow the panel out.
  const cell = rule("#panel button.path-cell, #path-grid button.path-cell");

  assert.match(cell, /width: auto/);
  assert.match(cell, /margin-top: 0/);
});

// --- it sits inside the induced-current panel ---------------------------------

test("the selector is part of the current panel it drives", () => {
  const panelStart = html.indexOf('<div id="current-panel">');
  const readout = html.indexOf('<div id="readout">');
  const selector = html.indexOf('<div id="path-select">');

  assert.ok(selector > panelStart && selector < readout, "the selector is outside the panel");
});

test("the ids the selector adds are unique", () => {
  for (const id of ["path-select", "path-grid", "path-clear"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, id);
  }
});

test("the cells carry no ids, so none of them can collide", () => {
  // 100 generated ids would be 100 chances at a duplicate; data attributes
  // are how the handler will find them.
  assert.equal(cells.filter((c) => c.attrs.includes("id=")).length, 0);
});

// --- can every offered cell actually be selected? (6ed3d79) ------------------
//
// The selector offers all 100 paths. tracesForPath refuses any start outside
// the central quarter [0, PIXEL_OFFSET) -- by reciprocity the +5 offsets name
// a different pair of pixels there, so the four panels have nothing correct to
// draw. viewer.js routes a click straight into currentView.setSelection, with
// no filter and no try, so a cell outside the quarter throws out of the click
// handler.

import { PIXEL_OFFSET, tracesForPath } from "../../web/current_build.js";

/** A payload the size the selector assumes. */
function payload(m = M, t = 4) {
  return {
    meta: { bin: "current.bin", shape: [m, m, t], n_ticks: t, time_step_us: 0.1, bytes: m * m * t * 4, starts: [] },
    block: new Float32Array(m * m * t),
  };
}

test("every cell the selector offers can be turned into traces", () => {
  // Each cell is a button a user can click; one that throws is a broken
  // control, not an edge case.
  const broken = [];
  for (const cell of cells) {
    try {
      tracesForPath(payload(), cell.i, cell.j);
    } catch (error) {
      broken.push(`(${cell.i}, ${cell.j})`);
    }
  }

  assert.deepEqual(
    broken,
    [],
    `${broken.length} of ${cells.length} cells throw when clicked; `
      + `tracesForPath only accepts starts in [0, ${PIXEL_OFFSET}). `
      + `First few: ${broken.slice(0, 5).join(" ")}`,
  );
});

test("the offered range matches the range the traces support", () => {
  // Was red while tracesForPath only accepted the central quarter
  // (pochoir_viewer-u9ht). 94799a9 opened every quarter, so the supported
  // range is the block width. Still stated as a comparison rather than a
  // literal, so whichever side moves next the two are checked against each
  // other.
  const offered = Math.max(...cells.flatMap((c) => [c.i, c.j])) + 1;
  const supported = payload().meta.shape[0];

  assert.equal(
    offered,
    supported,
    `the grid offers ${offered} positions per axis against a ${supported}-wide block`,
  );
  assert.ok(offered > PIXEL_OFFSET, "the grid no longer reaches past the first quarter");
});
