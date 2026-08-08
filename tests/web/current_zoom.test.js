// Property tests for the per-panel zoom (Phase N).
//
// The example-based coverage already exists and is thorough: time_viewport.js
// pins the helper maths case by case, and current_view.test.js drives the real
// pointer handlers for drag, wheel, double-click, independence, the reset
// button and the omitted cursor. Repeating any of that here would only be a
// second copy to keep in step.
//
// What no example-based test can cover is COMPOSITION. Each gesture is correct
// on its own; the risk is a sequence of them — zoom in, drag near an edge,
// wheel out, drag back — walking a viewport somewhere illegal, and the invariants
// are exactly the kind that survive every case someone thought to enumerate and
// fail on the one they did not. So this file fires long random gesture streams
// at the real handlers and asserts the invariants hold after EVERY step.
//
// Randomness is seeded, so a failure names a reproducible seed rather than
// appearing once in a hundred runs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_VIEWPORT_TICKS,
  clampViewport,
  fullViewport,
  zoomBy,
  zoomTo,
} from "../../web/current_build.js";
import {
  PANELS,
  SLOT_COUNT,
  createCurrentView,
} from "../../web/current_view.js";

const M = 10;
const T = 100;
const LAST = T - 1;
const WIDTH = 120;

/** Deterministic PRNG, so a failing case is reproducible from its seed. */
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function fakeCanvas() {
  const handlers = {};
  return {
    clientWidth: WIDTH,
    clientHeight: 60,
    width: 0,
    height: 0,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    setPointerCapture() {},
    releasePointerCapture() {},
    getContext: () => ({
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillText() {},
      set strokeStyle(_v) {}, set fillStyle(_v) {}, set lineWidth(_v) {},
      set font(_v) {},
    }),
    fire(type, event = {}) {
      handlers[type]?.({
        stopPropagation() {}, preventDefault() {}, pointerId: 1, ...event,
      });
    },
  };
}

function payload() {
  const block = new Float32Array(M * M * T);
  for (let n = 0; n < block.length; n++) block[n] = Math.sin(n);
  return {
    meta: {
      bin: "current.bin", shape: [M, M, T], n_ticks: T,
      time_step_us: 0.05, time_units: "us", bytes: block.length * 4, starts: [],
    },
    block,
  };
}

function wired() {
  const els = { "current-legend": { replaceChildren() {}, append() {} } };
  for (const panel of PANELS) els[panel.id] = fakeCanvas();
  const doc = {
    getElementById: (id) => els[id] ?? null,
    createElement: () => ({ style: {}, append() {} }),
    createTextNode: (text) => ({ text }),
  };
  const view = createCurrentView(payload(), doc);
  view.setSelection([{ i: 0, j: 0 }, { i: 1, j: 1 }, { i: 2, j: 2 }, { i: 3, j: 3 }]);
  return { view, canvasOf: (slot) => els[PANELS[slot].id] };
}

/** Every invariant a viewport must satisfy, whatever produced it. */
function assertLegal(v, what) {
  const minSpan = Math.min(MIN_VIEWPORT_TICKS, LAST);

  assert.ok(Number.isFinite(v.tickLo) && Number.isFinite(v.tickHi), `${what}: not finite`);
  assert.ok(v.tickLo >= 0, `${what}: lo ${v.tickLo} is negative`);
  assert.ok(v.tickHi <= LAST, `${what}: hi ${v.tickHi} passes ${LAST}`);
  assert.ok(v.tickLo < v.tickHi, `${what}: lo ${v.tickLo} not below hi ${v.tickHi}`);
  assert.ok(
    v.tickHi - v.tickLo >= minSpan - 1e-9,
    `${what}: span ${v.tickHi - v.tickLo} is below the floor`,
  );
}

/** One random gesture on one random panel. */
function fireRandom(random, canvasOf) {
  const slot = Math.floor(random() * SLOT_COUNT);
  const canvas = canvasOf(slot);
  // Deliberately includes coordinates outside the canvas: a pointer that
  // leaves the panel mid-drag is captured, so the handler does see them.
  const x = () => (random() * 1.6 - 0.3) * WIDTH;

  switch (Math.floor(random() * 4)) {
    case 0:
      canvas.fire("pointerdown", { offsetX: x() });
      canvas.fire("pointerup", { offsetX: x() });
      return `drag on ${slot}`;
    case 1:
      canvas.fire("wheel", { offsetX: x(), deltaY: random() < 0.5 ? -1 : 1 });
      return `wheel on ${slot}`;
    case 2:
      canvas.fire("dblclick", {});
      return `dblclick on ${slot}`;
    default:
      // An abandoned drag: press, then cancel without a matching release.
      canvas.fire("pointerdown", { offsetX: x() });
      canvas.fire("pointercancel", {});
      return `cancelled drag on ${slot}`;
  }
}

test("no sequence of gestures can produce an illegal viewport", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const random = rng(seed);
    const { view, canvasOf } = wired();
    const history = [];

    for (let step = 0; step < 60; step++) {
      history.push(fireRandom(random, canvasOf));
      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        assertLegal(
          view.viewportOf(slot),
          `seed ${seed} step ${step} slot ${slot} after [${history.slice(-3).join(", ")}]`,
        );
      }
    }
  }
});

test("a gesture only ever moves the panel it was aimed at", () => {
  // Independence under composition rather than for one gesture: after a long
  // random stream aimed at ONE panel, the other three must be untouched.
  for (let seed = 1; seed <= 20; seed++) {
    const random = rng(seed);
    const { view, canvasOf } = wired();
    const target = seed % SLOT_COUNT;
    const others = [0, 1, 2, 3].filter((s) => s !== target);
    const before = others.map((s) => view.viewportOf(s));

    for (let step = 0; step < 30; step++) {
      const canvas = canvasOf(target);
      canvas.fire("pointerdown", { offsetX: random() * WIDTH });
      canvas.fire("pointerup", { offsetX: random() * WIDTH });
      canvas.fire("wheel", { offsetX: random() * WIDTH, deltaY: random() < 0.5 ? -1 : 1 });
    }

    others.forEach((slot, n) => {
      assert.deepEqual(
        view.viewportOf(slot),
        before[n],
        `seed ${seed}: slot ${slot} moved while ${target} was driven`,
      );
    });
  }
});

test("a double-click always returns exactly the full span", () => {
  // Whatever state a stream of gestures left the panel in, the escape hatch
  // must land on the axis exactly — not merely somewhere legal.
  for (let seed = 1; seed <= 20; seed++) {
    const random = rng(seed);
    const { view, canvasOf } = wired();

    for (let step = 0; step < 25; step++) fireRandom(random, canvasOf);
    for (let slot = 0; slot < SLOT_COUNT; slot++) canvasOf(slot).fire("dblclick", {});

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      assert.deepEqual(view.viewportOf(slot), fullViewport(T), `seed ${seed} slot ${slot}`);
    }
  }
});

test("the helpers agree with the handlers about what is legal", () => {
  // The handlers route through zoomBy/zoomTo, which route through
  // clampViewport. Fuzzed directly, with the same out-of-range inputs a
  // captured pointer can deliver, so a future handler that bypasses the clamp
  // is not the only thing standing between the user and a broken axis.
  const random = rng(7);

  for (let n = 0; n < 20000; n++) {
    const a = (random() * 2 - 0.5) * T;
    const b = (random() * 2 - 0.5) * T;

    const dragged = zoomTo(a, b, T);
    assertLegal(dragged, `zoomTo(${a}, ${b})`);

    const wheeled = zoomBy(dragged, random() * 6, (random() * 1.5 - 0.25) * T, T);
    assertLegal(wheeled, `zoomBy after zoomTo(${a}, ${b})`);

    assertLegal(clampViewport(a, b, T), `clampViewport(${a}, ${b})`);
  }
});
