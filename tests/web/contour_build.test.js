// Tests for web/contour_build.js — marching squares over a 2-D slice.
import assert from "node:assert/strict";
import { test } from "node:test";

import { contourAt, contourSegments } from "../../web/contour_build.js";
import { extractSlice } from "../../web/potential_build.js";

/**
 * Build a row-major grid from f(a, b), matching the module's contract:
 * value(a, b) = values[a * height + b].
 */
function grid(width, height, f) {
  const values = new Float32Array(width * height);
  for (let a = 0; a < width; a++) {
    for (let b = 0; b < height; b++) values[a * height + b] = f(a, b);
  }
  return values;
}

/** Segments as [{x0, y0, x1, y1}, ...]. */
function segments(flat) {
  const out = [];
  for (let n = 0; n < flat.length; n += 4) {
    out.push({ x0: flat[n], y0: flat[n + 1], x1: flat[n + 2], y1: flat[n + 3] });
  }
  return out;
}

const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// --- output shape -----------------------------------------------------------

test("segments are returned as a flat Float32Array of 4-tuples", () => {
  const values = grid(3, 3, (a) => a);

  const flat = contourSegments(values, 3, 3, 0.5);

  assert.ok(flat instanceof Float32Array);
  assert.equal(flat.length % 4, 0);
  assert.ok(flat.length > 0);
});

test("a wholly-below slice yields no segments", () => {
  const values = grid(4, 4, () => 0);

  assert.equal(contourSegments(values, 4, 4, 5).length, 0);
});

test("a wholly-above slice yields no segments", () => {
  const values = grid(4, 4, () => 10);

  assert.equal(contourSegments(values, 4, 4, 5).length, 0);
});

test("a constant slice exactly at the level yields no segments", () => {
  // Every corner is >= level, so every cell codes 15.
  const values = grid(4, 4, () => 3);

  assert.equal(contourSegments(values, 4, 4, 3).length, 0);
});

test("a single-column grid has no cells to march", () => {
  assert.equal(contourSegments(grid(1, 5, (a, b) => b), 1, 5, 2).length, 0);
});

test("a single-row grid has no cells to march", () => {
  assert.equal(contourSegments(grid(5, 1, (a) => a), 5, 1, 2).length, 0);
});

// --- UV normalisation -------------------------------------------------------

test("all coordinates land inside the unit square", () => {
  const values = grid(6, 5, (a, b) => a + b);

  for (const v of contourSegments(values, 6, 5, 4)) {
    assert.ok(v >= 0 && v <= 1, `coordinate ${v} outside [0, 1]`);
  }
});

test("UV spans the full range for a contour crossing the whole grid", () => {
  // A ramp along a: the contour is a straight line spanning b from 0 to 1.
  const values = grid(5, 5, (a) => a);

  const ys = contourSegments(values, 5, 5, 2).filter((_, n) => n % 2 === 1);

  assert.ok(close(Math.min(...ys), 0));
  assert.ok(close(Math.max(...ys), 1));
});

test("normalisation uses sample steps, not sample counts", () => {
  // 5 samples across is 4 steps: the last sample must map to 1, not 0.8.
  const values = grid(5, 2, (a) => a);

  const xs = contourSegments(values, 5, 2, 3.5).filter((_, n) => n % 2 === 0);

  // Level 3.5 sits halfway between samples 3 and 4, i.e. 3.5 / 4 = 0.875.
  for (const x of xs) assert.ok(close(x, 0.875), `x was ${x}`);
});

// --- the indexing contract --------------------------------------------------

test("a ramp along a contours perpendicular to a", () => {
  const values = grid(5, 5, (a) => a);

  const segs = segments(contourSegments(values, 5, 5, 2));

  for (const s of segs) {
    assert.ok(close(s.x0, 0.5), `x0 was ${s.x0}`);
    assert.ok(close(s.x1, 0.5), `x1 was ${s.x1}`);
  }
});

test("a ramp along b contours perpendicular to b", () => {
  // The transposed case: getting the indexing backwards swaps these two.
  const values = grid(5, 5, (a, b) => b);

  const segs = segments(contourSegments(values, 5, 5, 2));

  for (const s of segs) {
    assert.ok(close(s.y0, 0.5), `y0 was ${s.y0}`);
    assert.ok(close(s.y1, 0.5), `y1 was ${s.y1}`);
  }
});

test("a non-square grid is not silently transposed", () => {
  // width 3, height 7: reading it as 7x3 would run off the end or misplace.
  const values = grid(3, 7, (a) => a);

  const segs = segments(contourSegments(values, 3, 7, 1.5));

  assert.ok(segs.length > 0);
  for (const s of segs) assert.ok(close(s.x0, 0.75), `x0 was ${s.x0}`);
});

test("the contract matches extractSlice's output layout", () => {
  // Contours consume slices directly, so the two layouts must agree.
  const shape = [3, 4, 5];
  const volume = new Float32Array(3 * 4 * 5);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 5; k++) volume[(i * 4 + j) * 5 + k] = i;

  const slice = extractSlice(volume, shape, "z", 0); // spans (i, j), values vary with i
  const segs = segments(contourSegments(slice.values, slice.width, slice.height, 1.5));

  assert.ok(segs.length > 0);
  for (const s of segs) assert.ok(close(s.x0, 0.75), `x0 was ${s.x0}`);
});

// --- linear interpolation ---------------------------------------------------

test("crossings interpolate linearly rather than snapping to midpoints", () => {
  // 0 -> 10 across one step; level 2.5 must land at a quarter, not a half.
  const values = grid(2, 2, (a) => a * 10);

  const segs = segments(contourSegments(values, 2, 2, 2.5));

  for (const s of segs) assert.ok(close(s.x0, 0.25), `x0 was ${s.x0}`);
});

test("interpolation tracks the level across a cell", () => {
  const values = grid(2, 2, (a) => a * 10);

  for (const [level, expected] of [[1, 0.1], [5, 0.5], [9, 0.9]]) {
    const segs = segments(contourSegments(values, 2, 2, level));
    assert.ok(close(segs[0].x0, expected), `level ${level} gave ${segs[0].x0}`);
  }
});

test("a flat edge falls back to the midpoint rather than dividing by zero", () => {
  // v00 == v10 on the bottom edge; the crossing there has no unique solution.
  const values = new Float32Array([5, 0, 5, 10]); // width 2, height 2

  const flat = contourSegments(values, 2, 2, 5);

  for (const v of flat) assert.ok(Number.isFinite(v), `non-finite ${v}`);
});

test("no coordinate is ever NaN or infinite", () => {
  const cases = [
    grid(4, 4, () => 0),
    grid(4, 4, (a, b) => (a === b ? 1 : 0)),
    grid(4, 4, (a, b) => a * b),
  ];

  for (const values of cases) {
    for (const v of contourSegments(values, 4, 4, 0.5)) {
      assert.ok(Number.isFinite(v));
    }
  }
  // A 2x2 all-equal grid: every corner is exactly at the level.
  for (const v of contourSegments(new Float32Array([1, 1, 1, 1]), 2, 2, 0.5)) {
    assert.ok(Number.isFinite(v));
  }
});

// --- level placement --------------------------------------------------------

test("a higher level sits further along an increasing ramp", () => {
  const values = grid(9, 3, (a) => a);

  const xAt = (level) => segments(contourSegments(values, 9, 3, level))[0].x0;

  assert.ok(xAt(2) < xAt(4));
  assert.ok(xAt(4) < xAt(6));
});

test("levels outside the data range produce nothing", () => {
  const values = grid(5, 5, (a) => a); // 0..4

  assert.equal(contourSegments(values, 5, 5, -1).length, 0);
  assert.equal(contourSegments(values, 5, 5, 99).length, 0);
});

test("a level at the data maximum still contours, unlike isosurfaces", () => {
  // Corner tests use >=, so the last cell straddles the max and emits a
  // segment along the top edge. This DIFFERS from isosurfaces(), which skips a
  // level sitting exactly at vmin or vmax (see pochoir_viewer-89d). Recorded
  // deliberately: the 2-D and 3-D paths do not agree at the endpoints, so a
  // level drawn as a contour may have no matching isosurface.
  const values = grid(5, 5, (a) => a);

  const segs = segments(contourSegments(values, 5, 5, 4));

  assert.ok(segs.length > 0);
  for (const s of segs) assert.ok(close(s.x0, 1) && close(s.x1, 1));
});

test("a level below the data minimum produces nothing", () => {
  const values = grid(5, 5, (a) => a);

  assert.equal(contourSegments(values, 5, 5, -0.5).length, 0);
});

test("a negative level works for the drift potential's range", () => {
  const values = grid(9, 3, (a) => -8000 + a * 1000);

  const segs = segments(contourSegments(values, 9, 3, -4000));

  assert.ok(segs.length > 0);
  assert.ok(close(segs[0].x0, 0.5));
});

test("a closed contour around a peak forms a loop", () => {
  // A single high centre: the contour should enclose it, so every segment
  // endpoint sits strictly inside the grid.
  const values = grid(5, 5, (a, b) => (a === 2 && b === 2 ? 10 : 0));

  const segs = segments(contourSegments(values, 5, 5, 5));

  assert.ok(segs.length >= 4, "expected a closed ring of segments");
  for (const s of segs) {
    assert.ok(s.x0 > 0 && s.x0 < 1 && s.y0 > 0 && s.y0 < 1);
  }
});

// --- saddle resolution ------------------------------------------------------

function saddle(diagonalHigh) {
  // width 2, height 2. Case 5: corners (0,0) and (1,1) high.
  // Case 10: corners (1,0) and (0,1) high.
  return diagonalHigh === "main"
    ? new Float32Array([10, 0, 0, 10]) // v00=10, v01=0, v10=0, v11=10
    : new Float32Array([0, 10, 10, 0]); // v00=0, v01=10, v10=10, v11=0
}

test("an ambiguous cell emits two segments, not one", () => {
  for (const kind of ["main", "anti"]) {
    const flat = contourSegments(saddle(kind), 2, 2, 5);
    assert.equal(flat.length, 8, `${kind} diagonal produced ${flat.length / 4} segments`);
  }
});

test("the saddle choice follows the cell-centre average", () => {
  // Centre of [10, 0, 0, 10] is 5. At level 4 the centre is above; at level 6
  // it is below, and the pairing must flip between the two.
  const values = saddle("main");

  const low = contourSegments(values, 2, 2, 4);
  const high = contourSegments(values, 2, 2, 6);

  assert.equal(low.length, 8);
  assert.equal(high.length, 8);
  assert.notDeepEqual([...low], [...high], "the saddle pairing did not flip");
});

test("both saddle orientations stay inside the cell", () => {
  for (const kind of ["main", "anti"]) {
    for (const v of contourSegments(saddle(kind), 2, 2, 5)) {
      assert.ok(v >= 0 && v <= 1, `${kind}: ${v} outside the cell`);
    }
  }
});

test("the saddle resolution is deterministic", () => {
  const a = contourSegments(saddle("main"), 2, 2, 4);
  const b = contourSegments(saddle("main"), 2, 2, 4);

  assert.deepEqual([...a], [...b]);
});

// --- contourAt --------------------------------------------------------------

const sliceOf = (width, height, f) => ({ width, height, values: grid(width, height, f) });

test("contourAt returns one entry per level, in order", () => {
  const slice = sliceOf(5, 5, (a) => a);

  const result = contourAt(slice, [1, 2, 3]);

  assert.deepEqual(result.map((r) => r.level), [1, 2, 3]);
});

test("contourAt entries carry their segments", () => {
  const slice = sliceOf(5, 5, (a) => a);

  const [first] = contourAt(slice, [2]);

  assert.ok(first.segments instanceof Float32Array);
  assert.ok(first.segments.length > 0);
});

test("contourAt keeps out-of-range levels as empty entries", () => {
  // The level list stays aligned with the legend, rather than silently shrinking.
  const slice = sliceOf(5, 5, (a) => a);

  const result = contourAt(slice, [2, 999]);

  assert.equal(result.length, 2);
  assert.equal(result[1].segments.length, 0);
});

test("contourAt with no levels returns nothing", () => {
  assert.deepEqual(contourAt(sliceOf(4, 4, (a) => a), []), []);
});

test("contourAt matches contourSegments for the same level", () => {
  const slice = sliceOf(6, 4, (a, b) => a + b);

  const [entry] = contourAt(slice, [3]);
  const direct = contourSegments(slice.values, slice.width, slice.height, 3);

  assert.deepEqual([...entry.segments], [...direct]);
});

test("contourAt accepts the weighting field's level list", () => {
  const slice = sliceOf(9, 9, (a) => Math.exp(-a / 2));

  const result = contourAt(slice, [0.9, 0.5, 0.1, 0.05]);

  assert.equal(result.length, 4);
  for (const entry of result) {
    for (const v of entry.segments) assert.ok(Number.isFinite(v));
  }
});
