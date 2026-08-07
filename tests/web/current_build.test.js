// Tests for web/current_build.js — the pure side of the induced-current view
// (f12b5a3).
//
// This is the browser-side mirror of pochoir_viewer/current.py's pixel_traces,
// and the two must agree: the same +5 reciprocity offsets, applied to a buffer
// the Python side wrote. So the fixtures here are built the way that writer
// writes -- flat C-order float32, ticks fastest -- and labelled a*100 + b per
// cell, so a stride mistake reads back a specific wrong number.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PIXEL_OFFSET,
  fetchCurrent,
  peakMagnitude,
  tickToUs,
  tickToX,
  tracesForPath,
  valueToY,
} from "../../web/current_build.js";

const M = 10;
const T = 4;

/** A payload shaped exactly as write_current writes it. */
function payload(m = M, t = T) {
  const block = new Float32Array(m * m * t);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < t; k++) {
        // Cell label in the tick-0 sample, tick index in the rest, so both
        // the (i, j) stride and the tick stride are identifiable.
        block[(i * m + j) * t + k] = k === 0 ? i * 100 + j : k;
      }
    }
  }
  return {
    meta: {
      bin: "current.bin",
      shape: [m, m, t],
      n_ticks: t,
      time_step_us: 0.1,
      time_units: "us",
      bytes: m * m * t * 4,
      starts: [],
    },
    block,
  };
}

// --- tracesForPath: the four rows -------------------------------------------

test("the four keys match the Python side's", () => {
  const traces = tracesForPath(payload(), 0, 0);

  assert.deepEqual(Object.keys(traces).sort(), [
    "central",
    "diagonal",
    "neighbor_x",
    "neighbor_y",
  ]);
});

test("each trace is the cell the reciprocity offsets name", () => {
  const traces = tracesForPath(payload(), 2, 3);

  assert.equal(traces.central[0], 203);
  assert.equal(traces.neighbor_x[0], 703);
  assert.equal(traces.neighbor_y[0], 208);
  assert.equal(traces.diagonal[0], 708);
});

test("the offsets follow PIXEL_OFFSET rather than a literal 5", () => {
  const data = payload();
  const i = 1;
  const j = 1;

  const traces = tracesForPath(data, i, j);

  const at = (a, b) => data.block[(a * M + b) * T];
  assert.equal(traces.neighbor_x[0], at(i + PIXEL_OFFSET, j));
  assert.equal(traces.neighbor_y[0], at(i, j + PIXEL_OFFSET));
});

test("PIXEL_OFFSET agrees with the Python constant", () => {
  // The two modules index the same buffer; a drift between them would read
  // real numbers from the wrong pixel.
  assert.equal(PIXEL_OFFSET, 5);
});

test("a trace is the whole tick run for its cell", () => {
  const traces = tracesForPath(payload(), 0, 0);

  assert.equal(traces.central.length, T);
  assert.deepEqual([...traces.central], [0, 1, 2, 3]);
});

test("the traces are views, not copies", () => {
  // subarray, so drawing many selected paths does not allocate per frame.
  const data = payload();

  const traces = tracesForPath(data, 0, 0);

  assert.equal(traces.central.buffer, data.block.buffer);
});

test("the four traces are four distinct cells", () => {
  const traces = tracesForPath(payload(), 4, 4);

  const firsts = new Set(Object.values(traces).map((t) => t[0]));
  assert.equal(firsts.size, 4);
});

test("every start in the central quarter works", () => {
  const data = payload();

  for (let i = 0; i < PIXEL_OFFSET; i++) {
    for (let j = 0; j < PIXEL_OFFSET; j++) {
      assert.equal(tracesForPath(data, i, j).central[0], i * 100 + j);
    }
  }
});

// --- tracesForPath: the refusals --------------------------------------------

test("a start outside the central quarter is refused", () => {
  const data = payload();

  for (const [i, j] of [[5, 0], [0, 5], [9, 9], [-1, 0], [0, -1]]) {
    assert.throws(() => tracesForPath(data, i, j), /central quarter/, `(${i}, ${j})`);
  }
});

test("the refusal names the position", () => {
  assert.throws(() => tracesForPath(payload(), 7, 2), /\(7, 2\)/);
});

test("a block too narrow for the offsets is refused, not left to run off the end", () => {
  // The Python side has this gap: pixel_traces there guards i and j but not
  // the block width, and dies on a bare IndexError. This module closes it,
  // which is the behaviour to keep.
  assert.throws(() => tracesForPath(payload(4, T), 0, 0), /too narrow/);
});

test("the narrow-block refusal reports the block size", () => {
  assert.throws(() => tracesForPath(payload(4, T), 0, 0), /4x4/);
});

test("a block exactly wide enough is accepted", () => {
  // The boundary: 10 wide is the smallest that admits a start at (4, 4).
  assert.doesNotThrow(() => tracesForPath(payload(10, T), 4, 4));
});

// --- peakMagnitude: the shared scale ----------------------------------------

test("the peak is the largest magnitude across all four traces", () => {
  const peak = peakMagnitude({
    a: new Float32Array([1, -2]),
    b: new Float32Array([0, 3]),
  });

  assert.equal(peak, 3);
});

test("the peak is symmetric about zero", () => {
  // Induced current changes sign; a peak taken from the max alone would clip
  // the negative lobe of every bipolar trace.
  const peak = peakMagnitude({ a: new Float32Array([0.1, -9]) });

  assert.equal(peak, 9);
});

test("an all-zero input peaks at zero rather than NaN", () => {
  assert.equal(peakMagnitude({ a: new Float32Array([0, 0]) }), 0);
});

test("an empty set of traces peaks at zero", () => {
  assert.equal(peakMagnitude({}), 0);
});

test("the peak spans the traces rather than being taken per trace", () => {
  // The whole point of a shared scale: the small trace must not set it.
  const traces = tracesForPath(payload(), 0, 0);

  assert.equal(
    peakMagnitude(traces),
    Math.max(...Object.values(traces).flatMap((t) => [...t].map(Math.abs))),
  );
});

// --- valueToY ---------------------------------------------------------------

test("zero maps to mid-height", () => {
  assert.equal(valueToY(0, 10, 60), 30);
});

test("the peak maps to the top and its negative to the bottom", () => {
  // Canvas y grows downward, so +peak is y = 0.
  assert.equal(valueToY(10, 10, 60), 0);
  assert.equal(valueToY(-10, 10, 60), 60);
});

test("a zero peak pins everything to the centre line instead of NaN", () => {
  // The documented guard: an all-zero selection must still draw a flat line.
  for (const v of [0, 1, -1]) {
    assert.equal(valueToY(v, 0, 60), 30, `${v}`);
  }
});

test("values scale linearly between the centre and the peak", () => {
  assert.equal(valueToY(5, 10, 60), 15);
});

test("a value beyond the peak is not clamped", () => {
  // Nothing here clips: the shared peak is taken over everything drawn, so a
  // value past it would mean the caller scaled against the wrong set.
  assert.equal(valueToY(20, 10, 60), -30);
});

// --- tickToX and tickToUs ---------------------------------------------------

test("the first tick is at x zero and the last at the full width", () => {
  assert.equal(tickToX(0, 100, 250), 0);
  assert.equal(tickToX(99, 100, 250), 250);
});

test("ticks are evenly spaced across the width", () => {
  assert.equal(tickToX(50, 101, 200), 100);
});

test("a single-tick payload does not divide by zero", () => {
  for (const n of [0, 1]) {
    assert.equal(tickToX(0, n, 200), 0, `nTicks ${n}`);
  }
});

test("tick times come from the payload's own step", () => {
  const meta = { time_step_us: 0.1 };

  assert.equal(tickToUs(0, meta), 0);
  assert.ok(Math.abs(tickToUs(10, meta) - 1) < 1e-12);
});

test("a different step scales the time axis with it", () => {
  // The step is required at export precisely because it cannot be guessed;
  // this must read it rather than assume 0.1.
  assert.ok(Math.abs(tickToUs(10, { time_step_us: 0.05 }) - 0.5) < 1e-12);
});

// --- fetchCurrent -----------------------------------------------------------

function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const entry = responses[url];
    if (!entry) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      json: async () => entry.json,
      arrayBuffer: async () => entry.buffer,
    };
  };
  return calls;
}

test("the payload and its binary are fetched and paired", async () => {
  const data = payload(2, 2);
  const meta = { ...data.meta, shape: [2, 2, 2], bytes: 32 };
  stubFetch({
    "data/current.json": { json: meta },
    "data/current.bin": { buffer: new Float32Array(8).buffer },
  });

  const result = await fetchCurrent();

  assert.deepEqual(result.meta, meta);
  assert.equal(result.block.length, 8);
});

test("the binary name comes from the metadata, not a hardcoded path", async () => {
  const meta = { bin: "current_alt.bin", shape: [1, 1, 2], bytes: 8 };
  const calls = stubFetch({
    "data/current.json": { json: meta },
    "data/current_alt.bin": { buffer: new Float32Array(2).buffer },
  });

  await fetchCurrent();

  assert.ok(calls.includes("data/current_alt.bin"), `fetched ${calls.join(", ")}`);
});

test("a custom base and name are honoured", async () => {
  const meta = { bin: "c.bin", shape: [1, 1, 1], bytes: 4 };
  const calls = stubFetch({
    "other/c.json": { json: meta },
    "other/c.bin": { buffer: new Float32Array(1).buffer },
  });

  await fetchCurrent("other", "c.json");

  assert.deepEqual(calls, ["other/c.json", "other/c.bin"]);
});

test("a missing json reports the status", async () => {
  stubFetch({});

  await assert.rejects(() => fetchCurrent(), /HTTP 404/);
});

test("a missing binary reports its own name", async () => {
  stubFetch({ "data/current.json": { json: { bin: "current.bin", bytes: 4 } } });

  await assert.rejects(() => fetchCurrent(), /current\.bin: HTTP 404/);
});

test("a length mismatch is refused rather than read as garbage", async () => {
  // The stale-.bin-beside-a-fresh-.json case. Reading it would produce
  // plausible-looking waveforms from misaligned floats.
  stubFetch({
    "data/current.json": { json: { bin: "current.bin", bytes: 400 } },
    "data/current.bin": { buffer: new Float32Array(8).buffer },
  });

  await assert.rejects(() => fetchCurrent(), /is 32 bytes, expected 400/);
});

test("the mismatch names the command that fixes it", async () => {
  stubFetch({
    "data/current.json": { json: { bin: "current.bin", bytes: 400 } },
    "data/current.bin": { buffer: new Float32Array(8).buffer },
  });

  await assert.rejects(() => fetchCurrent(), /export-current/);
});

test("a payload whose length matches passes the guard", async () => {
  stubFetch({
    "data/current.json": { json: { bin: "current.bin", bytes: 32 } },
    "data/current.bin": { buffer: new Float32Array(8).buffer },
  });

  await assert.doesNotReject(() => fetchCurrent());
});
