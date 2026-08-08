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
  partnerIndex,
  peakMagnitude,
  tickToUs,
  tickToX,
  traceAt,
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

// --- tracesForPath: the four partner cells -----------------------------------
//
// fc45c69 brings the browser helper in step with a580d01: an ordered array of
// {index, trace}, no pad-role names. The names are the obvious thing to add
// back and they were wrong for 75 of 100 starts, so the tests check indices,
// never a role.

const indices = (traces) => traces.map((entry) => entry.index.join(","));

test("four partner traces are returned", () => {
  const traces = tracesForPath(payload(), 0, 0);

  assert.equal(traces.length, 4);
  for (const entry of traces) {
    assert.deepEqual(Object.keys(entry).sort(), ["index", "trace"]);
  }
});

test("the partners are the cells the docstring names", () => {
  // "a start at (7, 2) reads (7, 2), (2, 2), (7, 7) and (2, 7)".
  assert.deepEqual(indices(tracesForPath(payload(), 7, 2)), ["7,2", "2,2", "7,7", "2,7"]);
});

test("the order is start, then x-partner, then y-partner, then both", () => {
  // With no keys the ORDER is the contract: the caller labels panels by
  // position, so a reordering would silently swap two plots.
  assert.deepEqual(indices(tracesForPath(payload(), 1, 2)), ["1,2", "6,2", "1,7", "6,7"]);
});

test("the first entry is always the start itself", () => {
  const data = payload();

  for (const i of [0, 4, 5, 9]) {
    for (const j of [0, 4, 5, 9]) {
      assert.equal(indices(tracesForPath(data, i, j))[0], `${i},${j}`);
    }
  }
});

test("each trace is the cell its index names", () => {
  const data = payload();

  for (const entry of tracesForPath(data, 3, 4)) {
    const [a, b] = entry.index;
    assert.equal(entry.trace[0], a * 100 + b);
  }
});

test("the JS and Python partner rules agree", () => {
  // The two index the same buffer; a drift between them would read real
  // numbers from the wrong cell.
  assert.equal(partnerIndex(2, 5), 7);
  assert.equal(partnerIndex(7, 5), 2);
});

test("the partner relation is its own inverse", () => {
  for (const half of [2, 5, 8]) {
    for (let k = 0; k < 2 * half; k++) {
      assert.equal(partnerIndex(partnerIndex(k, half), half), k);
    }
  }
});

test("no role names are reintroduced", () => {
  // A regression guard with a reason: see pochoir_viewer-154c.
  for (const entry of tracesForPath(payload(), 7, 3)) {
    assert.equal("central" in entry, false);
    assert.equal("neighbor_x" in entry, false);
  }
});

test("PIXEL_OFFSET remains the reference domain's half-width", () => {
  // Kept as documentation for the 10-wide domain; tracesForPath derives half
  // from the payload shape instead.
  assert.equal(PIXEL_OFFSET, 5);
});

test("half is taken from the payload, not from PIXEL_OFFSET", () => {
  // A 4x4 block must use 2. This is also the narrow-block case that used to
  // run off the end of the buffer.
  assert.deepEqual(indices(tracesForPath(payload(4, T), 0, 0)), ["0,0", "2,0", "0,2", "2,2"]);
});

test("a trace is the whole tick run for its cell", () => {
  const traces = tracesForPath(payload(), 0, 0);

  assert.equal(traces[0].trace.length, T);
  assert.deepEqual([...traces[0].trace], [0, 1, 2, 3]);
});

test("the traces are views, not copies", () => {
  const data = payload();

  const traces = tracesForPath(data, 0, 0);

  assert.equal(traces[0].trace.buffer, data.block.buffer);
});

test("the four cells are distinct in every quarter", () => {
  const data = payload();

  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      assert.equal(new Set(indices(tracesForPath(data, i, j))).size, 4, `(${i}, ${j})`);
    }
  }
});

test("every start inside the block is accepted", () => {
  // Three quarters of the domain used to throw.
  const data = payload();

  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      assert.equal(tracesForPath(data, i, j).length, 4);
    }
  }
});

test("the four cells repeat across a quarter group", () => {
  // Not a defect -- the property that makes the selector's extra 75 cells
  // redundant rather than informative. Relevant to pochoir_viewer-u9ht.
  const data = payload();
  const key = (i, j) => [...indices(tracesForPath(data, i, j))].sort().join(" ");

  for (const [i, j] of [[7, 3], [2, 8], [7, 8]]) {
    assert.equal(key(i, j), key(2, 3), `(${i}, ${j})`);
  }
});

// --- tracesForPath: the refusals --------------------------------------------

test("a start outside the block is refused", () => {
  const data = payload();

  for (const [i, j] of [[-1, 0], [0, -1], [10, 0], [0, 10], [99, 99]]) {
    assert.throws(() => tracesForPath(data, i, j), /outside the/, `(${i}, ${j})`);
  }
});

test("the refusal names the position and the block", () => {
  assert.throws(() => tracesForPath(payload(), 12, 2), /\(12, 2\).*10x10/);
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
  // NOTE peakMagnitude still iterates Object.values, which over the new array
  // form yields the {index, trace} entries rather than numeric traces. Passing
  // tracesForPath's result straight in no longer works -- pinned below.
  const traces = tracesForPath(payload(), 0, 0).map((e) => e.trace);

  assert.equal(
    peakMagnitude(traces),
    Math.max(...traces.flatMap((t) => [...t].map(Math.abs))),
  );
});

test("peakMagnitude was NOT updated for the new tracesForPath shape", () => {
  // fc45c69 changed tracesForPath's return but left peakMagnitude expecting a
  // collection of raw traces. Feeding it the new form iterates {index, trace}
  // objects, and `for (const v of trace)` throws on one. Pinned as today's
  // behaviour so the mismatch is visible rather than latent; a caller must
  // map to .trace first. current_view.js does NOT -- see the report on
  // fc45c69. If peakMagnitude is taught the new shape, this becomes
  // doesNotThrow.
  assert.throws(
    () => peakMagnitude(tracesForPath(payload(), 0, 0)),
    /not iterable/,
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

test("traceAt agrees with tracesForPath's first entry", () => {
  // tracesForPath is built on it, so a divergence would mean two offsets.
  const data = payload();

  for (const [i, j] of [[0, 0], [2, 3], [7, 8], [9, 9]]) {
    assert.deepEqual(
      [...traceAt(data, i, j)],
      [...tracesForPath(data, i, j)[0].trace],
      `(${i}, ${j})`,
    );
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

test("traceAt does NOT bounds-check, unlike tracesForPath", () => {
  // Pinned as today's contract. An out-of-block index runs off the end of the
  // buffer and subarray clamps, so the caller gets a SHORT or EMPTY trace
  // rather than an error. tracesForPath throws on the same input, so the two
  // public entry points differ -- deliberate or not, a caller has to know.
  const data = payload();

  assert.doesNotThrow(() => traceAt(data, M, 0));
  assert.equal(traceAt(data, M, 0).length, 0, "the out-of-block read was not empty");
  assert.throws(() => tracesForPath(data, M, 0), /outside the/);
});

test("a short read is silently short rather than padded", () => {
  // The last cell plus one: subarray clamps to the end of the buffer.
  const data = payload();

  assert.ok(traceAt(data, M - 1, M - 1).length === T);
  assert.ok(traceAt(data, M - 1, M).length < T);
});
