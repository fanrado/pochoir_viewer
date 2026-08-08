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
import { readFileSync } from "node:fs";

import * as build from "../../web/current_build.js";
import {
  fetchCurrent,
  peakMagnitude,
  tickToUs,
  tickToX,
  traceAt,
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

// --- the partner machinery is gone (75cf870) ---------------------------------
//
// Phase K removed partnerIndex and tracesForPath from the browser helper. The
// view stopped using them at 7c529b6, when panels became selection slots, so
// keeping them was an invitation to infer neighbours again. The reciprocity
// maths itself survives in pochoir_viewer/current.py, which is where the
// export lives; nothing in the browser needs it.

test("the browser helper no longer exports partner machinery", () => {
  for (const name of ["tracesForPath", "partnerIndex", "PIXEL_OFFSET"]) {
    assert.equal(name in build, false, `${name} is still exported`);
  }
});

test("what it does export is the single-cell read and the plotting maths", () => {
  assert.deepEqual(Object.keys(build).sort(), [
    "fetchCurrent",
    "peakMagnitude",
    "tickToUs",
    "tickToX",
    "traceAt",
    "valueToY",
  ]);
});

test("no reciprocity arithmetic is left in the source", () => {
  // A helper that still mirrored about the quarter boundary would be dead
  // code the next reader could reasonably wire back up. Code only: the
  // docstrings are checked separately below.
  const source = readFileSync(new URL("../../web/current_build.js", import.meta.url), "utf8")
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.doesNotMatch(source, /partner|quarter|neighbor_x|reciprocity/i);
});

test("no docstring still points at the removed helper", () => {
  // traceAt's docstring explains itself by contrast with tracesForPath, which
  // 75cf870 deleted -- so it now sends the reader to a function that is not
  // there. Harmless to run, misleading to read.
  const source = readFileSync(new URL("../../web/current_build.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /tracesForPath/, "a comment still names tracesForPath");
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

test("the peak spans every trace it is given, not just the first", () => {
  // Now called per panel with one trace, but it still has to handle a set:
  // a max over only the first would be silently right in the common case.
  const data = payload();
  const traces = [traceAt(data, 0, 0), traceAt(data, 9, 9)];

  assert.equal(
    peakMagnitude(traces),
    Math.max(...traces.flatMap((t) => [...t].map(Math.abs))),
  );
});

test("peakMagnitude takes raw traces, as its callers now pass them", () => {
  // The contract settled by 8fa1ddb and confirmed by 75cf870: the caller maps
  // to numeric traces, peakMagnitude never sees an {index, trace} wrapper.
  // Feeding it objects still throws, which is the honest failure.
  assert.throws(() => peakMagnitude([{ index: [0, 0], trace: [1] }]), /not iterable/);
  assert.equal(peakMagnitude([traceAt(payload(), 0, 0)]) > 0, true);
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

// --- traceAt, now public (7dc6140) -------------------------------------------
//
// "This is the only place the buffer offset is computed", so it is worth
// testing on its own: every other reader inherits whatever it gets wrong.
// Note it has NO bounds check, unlike tracesForPath -- pinned below, because
// an exported accessor that silently returns an empty array on a bad index is
// a different contract from one that throws, and callers need to know which.

test("traceAt reads the cell's own contiguous run", () => {
  const data = payload();

  assert.equal(traceAt(data, 3, 4)[0], 304);
  assert.deepEqual([...traceAt(data, 3, 4)], [304, 1, 2, 3]);
});

test("traceAt is now the only way into the buffer", () => {
  // With tracesForPath gone it is the single offset computation, so every
  // cell must be reachable through it alone.
  const data = payload();

  for (const [i, j] of [[0, 0], [2, 3], [7, 8], [9, 9]]) {
    assert.equal(traceAt(data, i, j)[0], i * 100 + j, `(${i}, ${j})`);
  }
});

test("traceAt is a view, not a copy", () => {
  const data = payload();

  assert.equal(traceAt(data, 1, 1).buffer, data.block.buffer);
});

test("the offset is row-major: j varies fastest", () => {
  // (i * cols + j) * nTicks. A column-major offset would still return
  // plausible traces, just the wrong ones.
  const data = payload();
  const at = (i, j) => traceAt(data, i, j)[0];

  assert.equal(at(0, 1), 1, "adjacent j is not the adjacent run");
  assert.equal(at(1, 0), 100, "adjacent i did not step a whole row");
});

test("traceAt reads the column count from the payload shape", () => {
  // A non-square block would expose a hardcoded 10 or a rows/cols swap.
  const block = new Float32Array(3 * 5 * 2);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) {
      block[(i * 5 + j) * 2] = i * 100 + j;
    }
  }
  const data = { meta: { shape: [3, 5, 2] }, block };

  assert.equal(traceAt(data, 2, 4)[0], 204);
  assert.equal(traceAt(data, 1, 0)[0], 100);
});

test("every cell of the block is reachable and distinct", () => {
  const data = payload();
  const seen = new Set();

  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const trace = traceAt(data, i, j);
      assert.equal(trace.length, T, `(${i}, ${j}) is short`);
      seen.add(trace[0]);
    }
  }

  assert.equal(seen.size, M * M);
});

test("traceAt does NOT bounds-check", () => {
  // Pinned as today's contract, and it matters more now: tracesForPath used to
  // throw on an out-of-block index, and it was the only entry point that did.
  // With it gone, nothing in the browser helper rejects a bad cell -- the
  // caller gets a short or empty trace and no error.
  const data = payload();

  assert.doesNotThrow(() => traceAt(data, M, 0));
  assert.equal(traceAt(data, M, 0).length, 0, "the out-of-block read was not empty");
});

test("a short read is silently short rather than padded", () => {
  // The last cell plus one: subarray clamps to the end of the buffer.
  const data = payload();

  assert.ok(traceAt(data, M - 1, M - 1).length === T);
  assert.ok(traceAt(data, M - 1, M).length < T);
});
