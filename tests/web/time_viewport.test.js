// Tests for the per-panel time viewport helpers (0d1f28c).
//
// clampViewport is declared the single authority for every invariant, on the
// stated grounds that fixing them at each call site is how one gets missed. So
// it is tested as an authority: not "does a normal drag work" but "is there any
// pair of numbers that gets past it". The properties are asserted over swept
// inputs rather than a handful of chosen cases, because the bad pairs arrive
// from a backwards drag, an over-zoom and a pan off the end -- three call sites
// that each look fine in isolation.
//
// TIME ONLY. Amplitude stays autoscaled per panel to its own peak, so nothing
// here should touch it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_VIEWPORT_TICKS,
  clampViewport,
  fullViewport,
  resetViewport,
  tickToXIn,
  xToTickIn,
  zoomBy,
  zoomTo,
} from "../../web/current_build.js";

const T = 3999;
const LAST = T - 1;
const span = ({ tickLo, tickHi }) => tickHi - tickLo;

/**
 * Every viewport must satisfy these, whatever produced it.
 *
 * The window never reaches past the DATA: `nTicks - 1` is the last real tick,
 * and the MIN_VIEWPORT_TICKS floor exists to stop zoom collapsing a window,
 * not to license inventing samples that do not exist. A payload shorter than
 * the floor therefore opens on all of itself and no more, so the floor is
 * `min(MIN_VIEWPORT_TICKS, last)` rather than a constant.
 */
function assertLegal(v, nTicks, what) {
  const last = Math.max(nTicks - 1, 0);
  const minSpan = Math.min(MIN_VIEWPORT_TICKS, last);
  assert.ok(Number.isFinite(v.tickLo) && Number.isFinite(v.tickHi), `${what}: not finite`);
  assert.ok(v.tickLo <= v.tickHi, `${what}: lo ${v.tickLo} is above hi ${v.tickHi}`);
  assert.ok(v.tickLo >= 0, `${what}: lo ${v.tickLo} is negative`);
  assert.ok(v.tickHi <= last, `${what}: hi ${v.tickHi} passes ${last}`);
  assert.ok(
    v.tickHi - v.tickLo >= minSpan - 1e-9,
    `${what}: span ${v.tickHi - v.tickLo} is below the floor`,
  );
}

// --- the opening state --------------------------------------------------------

test("a panel opens on the whole axis", () => {
  assert.deepEqual(fullViewport(T), { tickLo: 0, tickHi: LAST });
});

test("reset returns the whole axis again", () => {
  assert.deepEqual(resetViewport(T), fullViewport(T));
});

test("a tiny payload still opens on a legal window", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assertLegal(fullViewport(n), n, `nTicks ${n}`);
  }
});

test("a payload shorter than the floor opens on exactly its own data", () => {
  // Was the reverse: the floor was applied to the full span too, so 3 ticks
  // opened on 0..4 and the axis was labelled past the last sample. Applying a
  // zoom floor to the opening span invents time that was never measured.
  for (const n of [1, 2, 3, 4]) {
    assert.deepEqual(fullViewport(n), { tickLo: 0, tickHi: n - 1 }, `nTicks ${n}`);
  }
});

test("a degenerate single-tick payload does not divide by zero", () => {
  // It cannot honour lo < hi -- there is one sample -- so the drawing helpers
  // must absorb a zero span rather than the viewport faking one.
  const v = fullViewport(1);

  assert.deepEqual(v, { tickLo: 0, tickHi: 0 });
  assert.equal(tickToXIn(0, v, 400), 0);
  assert.ok(Number.isFinite(xToTickIn(200, v, 400)));
});

// --- clampViewport as the single authority ------------------------------------

test("a backwards drag is the same window as a forwards one", () => {
  assert.deepEqual(clampViewport(900, 100, T), clampViewport(100, 900, T));
});

test("an over-zoom is grown about its centre, not snapped to an end", () => {
  // Snapping would jump the panel somewhere the user was not looking.
  const v = clampViewport(2000, 2000.5, T);

  assertLegal(v, T, "over-zoom");
  assert.ok(Math.abs((v.tickLo + v.tickHi) / 2 - 2000.25) < 1e-9, "the centre moved");
});

test("a window overhanging the start slides rather than squashing", () => {
  // The span the user asked for is preserved wherever it fits.
  const v = clampViewport(-500, 500, T);

  assert.equal(v.tickLo, 0);
  assert.equal(span(v), 1000, "the requested span was squashed");
});

test("a window overhanging the end slides too", () => {
  const v = clampViewport(LAST - 100, LAST + 900, T);

  assert.equal(v.tickHi, LAST);
  assert.equal(span(v), 1000);
});

test("a window wider than the axis collapses to the axis", () => {
  // It cannot slide anywhere that fits, so both ends clamp.
  const v = clampViewport(-10000, 10000, T);

  assert.deepEqual(v, { tickLo: 0, tickHi: LAST });
});

test("no pair of numbers gets past the clamp", () => {
  // The authority claim, swept rather than spot-checked.
  const values = [-10000, -1, 0, 0.5, 1, 3, 1999, LAST - 1, LAST, LAST + 1, 10000];

  for (const a of values) {
    for (const b of values) {
      assertLegal(clampViewport(a, b, T), T, `clamp(${a}, ${b})`);
    }
  }
});

test("an equal pair still produces a usable window", () => {
  for (const at of [0, 1, LAST / 2, LAST]) {
    assertLegal(clampViewport(at, at, T), T, `degenerate at ${at}`);
  }
});

test("clamping is idempotent", () => {
  // A legal viewport must survive being clamped again, or repeated zooms
  // would drift.
  for (const [a, b] of [[100, 900], [-500, 500], [0, LAST], [2000, 2000.5]]) {
    const once = clampViewport(a, b, T);
    const twice = clampViewport(once.tickLo, once.tickHi, T);
    assert.deepEqual(twice, once, `(${a}, ${b}) moved on the second clamp`);
  }
});

// --- zoomBy --------------------------------------------------------------------

test("zooming in keeps the anchor tick where it was", () => {
  // The whole point of anchoring on the pointer: what is under it must not
  // slide away.
  const v = fullViewport(T);
  const anchor = 1200;

  const zoomed = zoomBy(v, 0.5, anchor, T);

  const before = tickToXIn(anchor, v, 800);
  const after = tickToXIn(anchor, zoomed, 800);
  assert.ok(Math.abs(before - after) < 1e-6, `anchor moved ${before} -> ${after}`);
});

test("zooming in narrows the window", () => {
  const v = zoomBy(fullViewport(T), 0.5, 2000, T);

  assert.ok(span(v) < LAST / 2 + 1);
  assertLegal(v, T, "zoom in");
});

test("zooming out widens it", () => {
  const start = clampViewport(1000, 2000, T);

  const v = zoomBy(start, 2, 1500, T);

  assert.ok(span(v) > span(start));
});

test("zooming out past the axis stops at the axis", () => {
  let v = clampViewport(1000, 2000, T);
  for (let n = 0; n < 20; n++) v = zoomBy(v, 2, 1500, T);

  assert.deepEqual(v, { tickLo: 0, tickHi: LAST });
});

test("zooming in repeatedly stops at the floor, never inverting", () => {
  let v = fullViewport(T);
  for (let n = 0; n < 40; n++) {
    v = zoomBy(v, 0.5, 2000, T);
    assertLegal(v, T, `zoom step ${n}`);
  }

  assert.ok(Math.abs(span(v) - MIN_VIEWPORT_TICKS) < 1e-6, `bottomed out at ${span(v)}`);
});

test("an anchor outside the window is pulled to its edge", () => {
  // A wheel event over a panel whose window has moved on must not zoom about
  // a tick that is not visible.
  const v = clampViewport(1000, 2000, T);

  const low = zoomBy(v, 0.5, -500, T);
  const high = zoomBy(v, 0.5, 9999, T);

  assert.ok(Math.abs(low.tickLo - 1000) < 1e-9, "the low edge moved");
  assert.ok(Math.abs(high.tickHi - 2000) < 1e-9, "the high edge moved");
});

test("a zoom about either edge keeps that edge fixed", () => {
  const v = clampViewport(1000, 2000, T);

  assert.ok(Math.abs(zoomBy(v, 0.5, 1000, T).tickLo - 1000) < 1e-9);
  assert.ok(Math.abs(zoomBy(v, 0.5, 2000, T).tickHi - 2000) < 1e-9);
});

// --- zoomTo --------------------------------------------------------------------

test("a drag selects exactly the span it covered", () => {
  const v = zoomTo(800, 1200, T);

  assert.deepEqual(v, { tickLo: 800, tickHi: 1200 });
});

test("a drag in either direction gives the same window", () => {
  assert.deepEqual(zoomTo(1200, 800, T), zoomTo(800, 1200, T));
});

test("a too-short drag still lands on a legal window", () => {
  // A click, or a drag of two pixels.
  assertLegal(zoomTo(1500, 1500.2, T), T, "short drag");
});

// --- the pixel mapping ----------------------------------------------------------

test("the viewport's ends map to the panel's edges", () => {
  const v = clampViewport(1000, 2000, T);

  assert.equal(tickToXIn(v.tickLo, v, 800), 0);
  assert.equal(tickToXIn(v.tickHi, v, 800), 800);
});

test("a tick outside the window maps outside the panel", () => {
  // Not clamped: the caller decides whether to draw it, and clamping here
  // would fold off-screen samples onto the edge as a false vertical line.
  const v = clampViewport(1000, 2000, T);

  assert.ok(tickToXIn(999, v, 800) < 0);
  assert.ok(tickToXIn(2001, v, 800) > 800);
});

test("x and tick round-trip through the viewport", () => {
  const v = clampViewport(1000, 2000, T);

  for (const x of [0, 1, 400, 799, 800]) {
    const back = tickToXIn(xToTickIn(x, v, 800), v, 800);
    assert.ok(Math.abs(back - x) < 1e-6, `${x} -> ${back}`);
  }
});

test("the round-trip holds at the zoom floor too", () => {
  const v = clampViewport(2000, 2000, T);

  for (const x of [0, 123, 800]) {
    assert.ok(Math.abs(tickToXIn(xToTickIn(x, v, 800), v, 800) - x) < 1e-6, `${x}`);
  }
});

test("a zero-width panel does not divide by zero", () => {
  // Canvases are measured from clientWidth, which is 0 before layout.
  const v = clampViewport(1000, 2000, T);

  assert.equal(xToTickIn(0, v, 0), v.tickLo);
  assert.ok(Number.isFinite(tickToXIn(1500, v, 0)));
});

test("a degenerate viewport maps to zero rather than NaN", () => {
  // clampViewport cannot produce one, but tickToXIn is exported and a caller
  // could hand it a stale object.
  assert.equal(tickToXIn(5, { tickLo: 10, tickHi: 10 }, 800), 0);
  assert.equal(tickToXIn(5, { tickLo: 10, tickHi: 0 }, 800), 0);
});

// --- the panels are independent --------------------------------------------------

test("nothing here is shared between panels", () => {
  // "a viewport belongs to ONE panel". Every helper returns a fresh object, so
  // one panel's zoom cannot alias another's.
  const a = fullViewport(T);
  const b = fullViewport(T);

  assert.notEqual(a, b);
  const zoomed = zoomBy(a, 0.5, 1000, T);
  assert.notEqual(zoomed, a);
  assert.deepEqual(a, fullViewport(T), "zoomBy mutated its input");
});

test("clampViewport does not mutate anything it is given", () => {
  const v = { tickLo: 1000, tickHi: 2000 };

  zoomBy(v, 0.5, 1500, T);

  assert.deepEqual(v, { tickLo: 1000, tickHi: 2000 });
});
