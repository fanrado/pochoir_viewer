// Tests for web/drift_anim.js — the drifting electron dots (46774f4).
//
// The load-bearing piece is tickToIndex. The response has 3999 ticks but
// scene.json ships paths decimated to at most 400 points, so a dot has to be
// interpolated between stored samples; snapping to the nearest one would make
// it jump every ~10 ticks. Both ends of that mapping have to line up exactly,
// or the dot finishes early or overruns its own path.

import test from "node:test";
import assert from "node:assert/strict";

import { createDriftAnim, samplePath, tickToIndex } from "../../web/drift_anim.js";

/** A straight path of `n` points marching in +x, as a flat [x,y,z,...]. */
function straight(n, step = 1) {
  const points = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) points[i * 3] = i * step;
  return points;
}

const paths = (counts) => counts.map((n) => ({ points: straight(n) }));

// --- samplePath: the interpolation -------------------------------------------

test("an integer index lands exactly on its stored point", () => {
  const out = [0, 0, 0];

  samplePath(straight(5), 3, out);

  assert.deepEqual(out, [3, 0, 0]);
});

test("a fractional index interpolates between the bracketing samples", () => {
  const out = [0, 0, 0];

  samplePath(straight(5), 2.5, out);

  assert.deepEqual(out, [2.5, 0, 0]);
});

test("all three components are interpolated, not just x", () => {
  // A dot that tracked only one axis would still look like it moved.
  const points = new Float32Array([0, 0, 0, 10, 20, 30]);
  const out = [0, 0, 0];

  samplePath(points, 0.5, out);

  assert.deepEqual(out, [5, 10, 15]);
});

test("the tail clamps rather than wrapping", () => {
  // Wrapping would teleport the electron back to the cathode mid-drift.
  const out = [0, 0, 0];

  samplePath(straight(5), 4.9, out);
  assert.deepEqual(out, [4, 0, 0]);

  samplePath(straight(5), 99, out);
  assert.deepEqual(out, [4, 0, 0]);
});

test("a negative index clamps to the start", () => {
  const out = [0, 0, 0];

  samplePath(straight(5), -3, out);

  assert.deepEqual(out, [0, 0, 0]);
});

test("the last index is exactly the last stored point", () => {
  const out = [0, 0, 0];

  samplePath(straight(5), 4, out);

  assert.deepEqual(out, [4, 0, 0]);
});

test("a single-point path stays at that point", () => {
  const out = [9, 9, 9];

  samplePath(new Float32Array([1, 2, 3]), 0.7, out);

  assert.deepEqual(out, [1, 2, 3]);
});

test("an empty path leaves the output alone rather than writing NaN", () => {
  const out = [7, 8, 9];

  samplePath(new Float32Array([]), 2, out);

  assert.deepEqual(out, [7, 8, 9]);
});

test("samplePath returns the array it wrote into", () => {
  const out = [0, 0, 0];

  assert.equal(samplePath(straight(3), 1, out), out);
});

test("a non-uniform path interpolates within the right segment", () => {
  // Decimated paths are not evenly spaced, so the segment matters.
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 100, 0, 0]);
  const out = [0, 0, 0];

  samplePath(points, 1.5, out);

  assert.deepEqual(out, [50.5, 0, 0]);
});

// --- tickToIndex: two clocks, and each path's own length ---------------------
//
// b36f0a0 replaced a proportional stretch with a real conversion. The old
// `k / (nTicks - 1)` spread every path across the whole response window, so
// every electron arrived exactly at the final tick whatever its real drift
// length -- path 0 is 1810 of 3999 steps, so its current spike landed at ~45%
// of the window while its dot was not yet halfway down. Two things fix that:
// pointsPerTick relates the two clocks, and pathSteps is the path's OWN length.

const T_REFERENCE = 3999;
const timing = (pathSteps, pointsPerTick = 1) => ({ pointsPerTick, pathSteps });

test("tick zero maps to the first stored point", () => {
  assert.equal(tickToIndex(0, 400, timing(400)), 0);
});

test("a path arrives at its own last step, not at the last tick", () => {
  // The defect, stated directly. A path of 1810 steps must reach the end of
  // its decimated array at tick 1809, and stay there.
  const atArrival = tickToIndex(1809, 400, timing(1810));

  assert.ok(Math.abs(atArrival - 399) < 1e-9, `arrived at index ${atArrival}`);
});

test("a short path does not stretch across the whole window", () => {
  // Under the old stretch this was 399 * 1809/3998 -- barely half way.
  const halfway = tickToIndex(Math.round(1809 / 2), 400, timing(1810));

  assert.ok(Math.abs(halfway - 199.5) < 1, `halfway mapped to ${halfway}`);
});

test("the index clamps once the electron is collected", () => {
  // It parks at the anode; the remaining ticks move it no further.
  for (const k of [1810, 2500, T_REFERENCE]) {
    assert.equal(tickToIndex(k, 400, timing(1810)), 399, `tick ${k}`);
  }
});

test("a longer path arrives later than a shorter one", () => {
  // The whole point of a per-path length: two paths at the same tick are at
  // different fractions of their own drift.
  const short = tickToIndex(900, 400, timing(1000));
  const long = tickToIndex(900, 400, timing(3000));

  assert.ok(short > long, `short ${short} did not lead long ${long}`);
});

test("pointsPerTick relates the two clocks", () => {
  // 200000 path points binned into 4000 gives 50: one tick advances fifty
  // stored steps. Assuming 1.0 would run the animation fifty times too slow.
  const fast = tickToIndex(10, 400, timing(1000, 50));
  const slow = tickToIndex(10, 400, timing(1000, 1));

  assert.ok(fast > slow * 10, `${fast} is not far ahead of ${slow}`);
});

test("pointsPerTick defaults to one when the payload omits it", () => {
  assert.equal(
    tickToIndex(500, 400, { pathSteps: 1000 }),
    tickToIndex(500, 400, timing(1000, 1)),
  );
});

test("the mapping is linear up to the arrival", () => {
  const at = (k) => tickToIndex(k, 400, timing(2000));
  const gaps = [at(200) - at(100), at(300) - at(200), at(400) - at(300)];

  for (const gap of gaps) assert.ok(Math.abs(gap - gaps[0]) < 1e-9, `${gaps}`);
});

test("the point count is read per path rather than assumed to be 400", () => {
  // decimate() returns fewer points for short paths.
  assert.equal(tickToIndex(1809, 50, timing(1810)), 49);
  assert.equal(tickToIndex(1809, 12, timing(1810)), 11);
});

test("a degenerate point count or path length maps to zero rather than NaN", () => {
  for (const [nPoints, steps] of [[1, 1810], [0, 1810], [400, 1], [400, 0]]) {
    assert.equal(tickToIndex(5, nPoints, timing(steps)), 0, `${nPoints}/${steps}`);
  }
});

test("a missing pathSteps maps to zero rather than guessing", () => {
  // The caller falls back to the stored point count; the function itself must
  // not invent a length.
  assert.equal(tickToIndex(5, 400, {}), 0);
});

test("the two halves compose: arrival lands on the path's end point", () => {
  const points = straight(400);
  const out = [0, 0, 0];

  samplePath(points, tickToIndex(1809, 400, timing(1810)), out);

  assert.deepEqual(out, [399, 0, 0]);
});

test("a path that runs the full window still arrives exactly at the end", () => {
  // The boundary the old code got right by accident.
  assert.equal(tickToIndex(T_REFERENCE, 400, timing(T_REFERENCE + 1)), 399);
});

// --- createDriftAnim ----------------------------------------------------------

const positions = (anim) => anim.points.geometry.getAttribute("position").array;
const dotAt = (anim, p) => [...positions(anim).slice(p * 3, p * 3 + 3)];

test("there is one dot per path in a single Points object", () => {
  // 100 objects would be 100 draw calls for 100 vertices.
  const anim = createDriftAnim(paths([5, 5, 5]), 3999);

  assert.equal(anim.points.geometry.getAttribute("position").count, 3);
  assert.equal(anim.points.type, "Points");
});

test("every dot starts parked at its own start point", () => {
  // The seeding pattern near the cathode has to be visible before anything
  // is selected.
  const anim = createDriftAnim(
    [{ points: new Float32Array([1, 2, 3, 9, 9, 9]) },
     { points: new Float32Array([4, 5, 6, 9, 9, 9]) }],
    3999,
  );

  assert.deepEqual(dotAt(anim, 0), [1, 2, 3]);
  assert.deepEqual(dotAt(anim, 1), [4, 5, 6]);
});

test("nothing is selected until the caller says so", () => {
  assert.deepEqual(createDriftAnim(paths([5]), 3999).selected, []);
});

test("the object is named so the scene graph can find it", () => {
  assert.equal(createDriftAnim(paths([5]), 3999).points.name, "driftDots");
});

test("dot size does not shrink with distance", () => {
  // sizeAttenuation off: the dots are markers, not objects with extent.
  assert.equal(createDriftAnim(paths([5]), 3999).points.material.sizeAttenuation, false);
});

// --- selection and ticking ----------------------------------------------------

test("only selected dots move when the tick advances", () => {
  // The unselected ones stay parked so the seeding pattern remains on screen.
  const anim = createDriftAnim(paths([400, 400]), 3999);
  anim.setSelected([0]);

  anim.setTick(3998);

  assert.deepEqual(dotAt(anim, 0), [399, 0, 0]);
  assert.deepEqual(dotAt(anim, 1), [0, 0, 0], "an unselected dot moved");
});

test("a selected dot advances monotonically with the tick", () => {
  const anim = createDriftAnim(paths([400]), 3999);
  anim.setSelected([0]);

  const seen = [];
  for (const k of [0, 1000, 2000, 3000, 3998]) {
    anim.setTick(k);
    seen.push(dotAt(anim, 0)[0]);
  }

  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(new Set(seen).size, seen.length, "the dot stalled between ticks");
});

test("deselecting returns a dot to its start", () => {
  const anim = createDriftAnim(paths([400]), 3999);
  anim.setSelected([0]);
  anim.setTick(3998);

  anim.setSelected([]);

  assert.deepEqual(dotAt(anim, 0), [0, 0, 0]);
});

test("changing the selection resets the dots that left it", () => {
  const anim = createDriftAnim(paths([400, 400]), 3999);
  anim.setSelected([0, 1]);
  anim.setTick(3998);

  anim.setSelected([1]);

  assert.deepEqual(dotAt(anim, 0), [0, 0, 0], "the dropped dot stayed mid-drift");
  assert.deepEqual(dotAt(anim, 1), [399, 0, 0], "the kept dot was reset");
});

test("the selection is reported back", () => {
  const anim = createDriftAnim(paths([5, 5, 5]), 3999);

  anim.setSelected([2, 0]);

  assert.deepEqual(anim.selected.sort(), [0, 2]);
});

test("a repeated id is not animated twice", () => {
  const anim = createDriftAnim(paths([5, 5]), 3999);

  anim.setSelected([1, 1]);

  assert.deepEqual(anim.selected, [1]);
});

test("the selection is copied, so a caller's later edit does not leak in", () => {
  const anim = createDriftAnim(paths([5, 5]), 3999);
  const ids = [0];

  anim.setSelected(ids);
  ids.push(1);

  assert.deepEqual(anim.selected, [0]);
});

// BufferAttribute.needsUpdate is a write-only accessor -- setting it bumps
// `version`, and reading it back gives undefined. So the upload flag is
// observed through version, which is what the renderer actually consults.
test("the geometry is flagged for upload after every move", () => {
  // Without this three keeps drawing the previous frame's positions.
  const anim = createDriftAnim(paths([400]), 3999);
  const attribute = anim.points.geometry.getAttribute("position");
  anim.setSelected([0]);
  const before = attribute.version;

  anim.setTick(100);

  assert.ok(attribute.version > before, "the tick did not flag an upload");
});

test("setSelected also flags the geometry, since it moves dots too", () => {
  const anim = createDriftAnim(paths([400]), 3999);
  const attribute = anim.points.geometry.getAttribute("position");
  anim.setSelected([0]);
  anim.setTick(2000);
  const before = attribute.version;

  anim.setSelected([]);

  assert.ok(attribute.version > before, "the reset did not flag an upload");
});

// --- paths of differing lengths ----------------------------------------------

test("each dot uses its own path's point count", () => {
  // decimate() returns fewer points for short paths, so a shared 400 would
  // stop the short ones early.
  const anim = createDriftAnim([{ points: straight(400) }, { points: straight(50) }], 3999);
  anim.setSelected([0, 1]);

  anim.setTick(3998);

  assert.deepEqual(dotAt(anim, 0), [399, 0, 0]);
  assert.deepEqual(dotAt(anim, 1), [49, 0, 0], "the short path did not reach its end");
});

// --- the payload's timing reaches the dots (b36f0a0) -------------------------

test("path_steps from the payload gives each dot its own arrival", () => {
  // The reference dataset's paths end between 1810 and 1835 steps of 3999, so
  // without this every electron would arrive at the final tick together.
  const anim = createDriftAnim(paths([400, 400]), 3999, {
    points_per_tick: 1,
    path_steps: [1000, 3000],
  });
  anim.setSelected([0, 1]);

  anim.setTick(999);

  assert.deepEqual(dotAt(anim, 0), [399, 0, 0], "the short path had not arrived");
  assert.ok(dotAt(anim, 1)[0] < 399, "the long path arrived with the short one");
});

test("an arrived dot stays put while the response plays on", () => {
  const anim = createDriftAnim(paths([400]), 3999, {
    points_per_tick: 1,
    path_steps: [1000],
  });
  anim.setSelected([0]);

  anim.setTick(999);
  const arrived = dotAt(anim, 0);
  anim.setTick(3998);

  assert.deepEqual(dotAt(anim, 0), arrived, "the dot kept moving past its arrival");
});

test("points_per_tick from the payload scales the advance", () => {
  const slow = createDriftAnim(paths([400]), 3999, { points_per_tick: 1, path_steps: [2000] });
  const fast = createDriftAnim(paths([400]), 3999, { points_per_tick: 10, path_steps: [2000] });
  slow.setSelected([0]);
  fast.setSelected([0]);

  slow.setTick(50);
  fast.setTick(50);

  assert.ok(dotAt(fast, 0)[0] > dotAt(slow, 0)[0], "points_per_tick did not reach the dots");
});

test("a payload with no timing gets the OLD proportional stretch", () => {
  // aad9bc0's deliberate choice, and worth pinning because the obvious
  // fallback is wrong in a worse way. With pathSteps defaulting to nTicks the
  // formula collapses to k / (nTicks - 1) -- the pre-Phase-M timing, which is
  // what a payload predating the timing fields should get. Defaulting to
  // nPoints instead would park every dot at tick 399 of 3999.
  const anim = createDriftAnim(paths([400]), 3999);
  anim.setSelected([0]);

  anim.setTick(399);

  const x = dotAt(anim, 0)[0];
  assert.ok(Math.abs(x - (399 / 3998) * 399) < 0.5, `fell back to something else: ${x}`);
  assert.ok(x < 399, "the dot arrived at tick 399, so it fell back to nPoints");
});

test("an untimed payload still reaches the end at the final tick", () => {
  // The old stretch's one correct property: nothing is left mid-path.
  const anim = createDriftAnim(paths([400]), 3999);
  anim.setSelected([0]);

  anim.setTick(3998);

  assert.deepEqual(dotAt(anim, 0), [399, 0, 0]);
});

test("a path with no entry in path_steps also falls back to nTicks", () => {
  // A partial path_steps list is a malformed payload; the fallback must be
  // the same one, not a per-path guess.
  const anim = createDriftAnim(paths([400, 400]), 3999, {
    points_per_tick: 1,
    path_steps: [1000],
  });
  anim.setSelected([1]);

  anim.setTick(3998);

  assert.deepEqual(dotAt(anim, 1), [399, 0, 0]);
});

test("a single-point path does not break the tick loop", () => {
  const anim = createDriftAnim([{ points: new Float32Array([1, 2, 3]) }], 3999);
  anim.setSelected([0]);

  assert.doesNotThrow(() => anim.setTick(2000));
  assert.deepEqual(dotAt(anim, 0), [1, 2, 3]);
});

test("no path at all still builds", () => {
  const anim = createDriftAnim([], 3999);

  assert.equal(anim.points.geometry.getAttribute("position").count, 0);
  assert.doesNotThrow(() => anim.setTick(10));
});
