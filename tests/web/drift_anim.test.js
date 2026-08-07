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

// --- tickToIndex: the 3999-to-400 bridge -------------------------------------

test("tick zero maps to the first stored point", () => {
  assert.equal(tickToIndex(0, 3999, 400), 0);
});

test("the last tick maps exactly to the last stored point", () => {
  // Off by anything here and the dot stops short of, or runs past, the anode.
  assert.equal(tickToIndex(3998, 3999, 400), 399);
});

test("the mapping is linear across the span", () => {
  const mid = tickToIndex(1999, 3999, 400);

  assert.ok(Math.abs(mid - 199.5) < 1e-9, `midpoint mapped to ${mid}`);
});

test("the index is fractional, not snapped to a stored point", () => {
  // The stated reason the function exists: ~10 ticks per point, so snapping
  // would make the dot jump.
  const index = tickToIndex(1, 3999, 400);

  assert.ok(index > 0 && index < 1, `tick 1 mapped to ${index}`);
});

test("the point count is read per path rather than assumed to be 400", () => {
  // decimate() returns fewer points for short paths.
  assert.equal(tickToIndex(3998, 3999, 50), 49);
  assert.equal(tickToIndex(3998, 3999, 12), 11);
});

test("a degenerate tick or point count maps to zero rather than NaN", () => {
  for (const [nTicks, nPoints] of [[1, 400], [0, 400], [3999, 1], [3999, 0]]) {
    assert.equal(tickToIndex(5, nTicks, nPoints), 0, `${nTicks}/${nPoints}`);
  }
});

test("the two halves compose: the last tick reaches the path's end point", () => {
  // tickToIndex and samplePath are only correct together.
  const points = straight(400);
  const out = [0, 0, 0];

  samplePath(points, tickToIndex(3998, 3999, 400), out);

  assert.deepEqual(out, [399, 0, 0]);
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
