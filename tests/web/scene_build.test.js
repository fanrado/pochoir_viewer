// Tests for web/scene_build.js — the pure scene-construction helpers.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  COLOR_FAR,
  COLOR_NEAR,
  FALLBACK_COLORS,
  GROUP_COLORS,
  buildBoundaryMesh,
  buildPathBuffers,
  offsetOfPath,
  pathOfVertex,
} from "../../web/scene_build.js";

/** A path whose points run from z=z0 downward in `n` steps of `dz`. */
function path(n, { x = 0, y = 0, z0 = 0, dz = 1 } = {}) {
  const points = [];
  for (let i = 0; i < n; i++) points.push(x, y, z0 + i * dz);
  return { points };
}

const positionsOf = (mesh) => Array.from(mesh.geometry.getAttribute("position").array);
const normalsOf = (mesh) => Array.from(mesh.geometry.getAttribute("normal").array);

// --- buildBoundaryMesh ------------------------------------------------------

test("boundary mesh emits two triangles (18 floats) per quad", () => {
  const group = { name: "anode", z_min_mm: 0, z_max_mm: 1, quads: [[0, 0, 1, 1], [2, 2, 3, 3]] };

  const mesh = buildBoundaryMesh(group, 0);

  assert.equal(positionsOf(mesh).length, 2 * 18);
  assert.equal(mesh.geometry.getAttribute("position").count, 12); // 6 vertices per quad
});

test("boundary mesh places every vertex at the slab midpoint in z", () => {
  const group = { name: "grid", z_min_mm: 9.8, z_max_mm: 10.1, quads: [[0, 0, 1, 1]] };

  const positions = positionsOf(buildBoundaryMesh(group, 0));

  for (let i = 2; i < positions.length; i += 3) {
    assert.ok(Math.abs(positions[i] - 9.95) < 1e-6, `z was ${positions[i]}`);
  }
});

test("boundary mesh triangulates a quad with the documented corner winding", () => {
  const group = { name: "anode", z_min_mm: 0, z_max_mm: 0, quads: [[1, 2, 3, 4]] };

  const positions = positionsOf(buildBoundaryMesh(group, 0));

  assert.deepEqual(positions, [
    1, 2, 0, 3, 2, 0, 3, 4, 0,
    1, 2, 0, 3, 4, 0, 1, 4, 0,
  ]);
});

test("boundary mesh covers the quad's full extent", () => {
  const group = { name: "cathode", z_min_mm: 160, z_max_mm: 160.1, quads: [[0, 0, 4.4, 4.4]] };

  const positions = positionsOf(buildBoundaryMesh(group, 0));
  const xs = positions.filter((_, i) => i % 3 === 0);
  const ys = positions.filter((_, i) => i % 3 === 1);

  assert.equal(Math.min(...xs), 0);
  assert.ok(Math.abs(Math.max(...xs) - 4.4) < 1e-6);
  assert.equal(Math.min(...ys), 0);
  assert.ok(Math.abs(Math.max(...ys) - 4.4) < 1e-6);
});

test("boundary mesh normals all face +z", () => {
  const group = { name: "anode", z_min_mm: 0, z_max_mm: 1, quads: [[0, 0, 1, 1], [1, 1, 2, 2]] };

  const normals = normalsOf(buildBoundaryMesh(group, 0));

  assert.equal(normals.length, 2 * 18);
  for (let i = 0; i < normals.length; i += 3) {
    assert.deepEqual([normals[i], normals[i + 1], normals[i + 2]], [0, 0, 1]);
  }
});

test("boundary mesh with no quads is empty, not malformed", () => {
  const mesh = buildBoundaryMesh({ name: "anode", z_min_mm: 0, z_max_mm: 1, quads: [] }, 0);

  assert.equal(positionsOf(mesh).length, 0);
  assert.equal(mesh.name, "anode");
});

test("boundary mesh takes its name from the group", () => {
  for (const name of ["anode", "grid", "cathode"]) {
    const mesh = buildBoundaryMesh({ name, z_min_mm: 0, z_max_mm: 1, quads: [[0, 0, 1, 1]] }, 0);
    assert.equal(mesh.name, name);
  }
});

test("named groups get their designated colour regardless of index", () => {
  for (const [name, hex] of Object.entries(GROUP_COLORS)) {
    const mesh = buildBoundaryMesh({ name, z_min_mm: 0, z_max_mm: 1, quads: [] }, 7);
    assert.equal(mesh.material.color.getHex(), new THREE.Color(hex).getHex());
  }
});

test("unnamed groups cycle through the fallback colours by index", () => {
  for (const index of [0, 1, 2, 3, 4, 9]) {
    const mesh = buildBoundaryMesh({ name: "grid-9", z_min_mm: 0, z_max_mm: 1, quads: [] }, index);
    const expected = FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    assert.equal(mesh.material.color.getHex(), new THREE.Color(expected).getHex());
  }
});

test("boundary material is translucent and double-sided", () => {
  // Slabs are viewed from both sides and must not hide the paths behind them.
  const mesh = buildBoundaryMesh({ name: "anode", z_min_mm: 0, z_max_mm: 1, quads: [] }, 0);

  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.35);
  assert.equal(mesh.material.side, THREE.DoubleSide);
});

// --- buildPathBuffers: ranges ----------------------------------------------

test("an n-point path becomes n-1 segments, i.e. 2(n-1) vertices", () => {
  for (const n of [2, 3, 10, 400]) {
    const { vertexTotal, pathRanges } = buildPathBuffers([path(n)], 100);
    assert.equal(vertexTotal, 2 * (n - 1), `n=${n}`);
    assert.equal(pathRanges[0].count, 2 * (n - 1), `n=${n}`);
  }
});

test("path ranges are contiguous and sum to vertexTotal", () => {
  const paths = [path(5), path(2), path(9), path(3)];

  const { pathRanges, vertexTotal } = buildPathBuffers(paths, 100);

  let expected = 0;
  for (const range of pathRanges) {
    assert.equal(range.start, expected);
    expected += range.count;
  }
  assert.equal(expected, vertexTotal);
});

test("a 1-point path contributes an empty range without shifting later paths", () => {
  const { pathRanges, vertexTotal } = buildPathBuffers([path(1), path(3)], 100);

  assert.deepEqual(pathRanges[0], { start: 0, count: 0 });
  assert.deepEqual(pathRanges[1], { start: 0, count: 4 });
  assert.equal(vertexTotal, 4);
});

test("a 0-point path is clamped to zero segments, never negative", () => {
  const { pathRanges, vertexTotal } = buildPathBuffers([{ points: [] }], 100);

  assert.deepEqual(pathRanges[0], { start: 0, count: 0 });
  assert.equal(vertexTotal, 0);
});

test("no paths yields empty buffers", () => {
  const { linePositions, lineColors, pathRanges, vertexTotal } = buildPathBuffers([], 100);

  assert.equal(vertexTotal, 0);
  assert.equal(linePositions.length, 0);
  assert.equal(lineColors.length, 0);
  assert.deepEqual(pathRanges, []);
});

test("buffers are sized to exactly 3 floats per vertex", () => {
  const { linePositions, lineColors, vertexTotal } = buildPathBuffers([path(5), path(4)], 100);

  assert.equal(linePositions.length, vertexTotal * 3);
  assert.equal(lineColors.length, vertexTotal * 3);
});

// --- buildPathBuffers: geometry --------------------------------------------

test("segments duplicate the shared interior point (LineSegments is unindexed)", () => {
  // 3 points -> 2 segments -> vertices p0,p1,p1,p2.
  const { linePositions } = buildPathBuffers([path(3, { dz: 10 })], 100);

  const zs = [linePositions[2], linePositions[5], linePositions[8], linePositions[11]];
  assert.deepEqual(zs, [0, 10, 10, 20]);
});

test("a two-point path yields exactly one segment with the original endpoints", () => {
  const points = [1, 2, 3, 4, 5, 6];

  const { linePositions, vertexTotal } = buildPathBuffers([{ points }], 100);

  assert.equal(vertexTotal, 2);
  assert.deepEqual(Array.from(linePositions), points);
});

test("each path writes into its own slice of the shared buffer", () => {
  const a = { points: [0, 0, 0, 1, 1, 1] };
  const b = { points: [9, 9, 9, 8, 8, 8] };

  const { linePositions, pathRanges } = buildPathBuffers([a, b], 100);

  assert.deepEqual(Array.from(linePositions.slice(0, 6)), a.points);
  const start = pathRanges[1].start * 3;
  assert.deepEqual(Array.from(linePositions.slice(start, start + 6)), b.points);
});

test("x and y coordinates are carried through unchanged", () => {
  const points = [0.22, 0.33, 0, 0.44, 0.55, 1];

  const { linePositions } = buildPathBuffers([{ points }], 100);

  assert.ok(Math.abs(linePositions[0] - 0.22) < 1e-6);
  assert.ok(Math.abs(linePositions[1] - 0.33) < 1e-6);
  assert.ok(Math.abs(linePositions[3] - 0.44) < 1e-6);
  assert.ok(Math.abs(linePositions[4] - 0.55) < 1e-6);
});

// --- buildPathBuffers: colours ----------------------------------------------

const colorAt = (lineColors, vertex) =>
  new THREE.Color(lineColors[vertex * 3], lineColors[vertex * 3 + 1], lineColors[vertex * 3 + 2]);

test("z=0 is COLOR_NEAR and z=extent is COLOR_FAR", () => {
  const extentZ = 160.1;
  const { lineColors } = buildPathBuffers([{ points: [0, 0, 0, 0, 0, extentZ] }], extentZ);

  assert.equal(colorAt(lineColors, 0).getHex(), new THREE.Color(COLOR_NEAR).getHex());
  assert.equal(colorAt(lineColors, 1).getHex(), new THREE.Color(COLOR_FAR).getHex());
});

test("the midpoint z is the lerp of the two endpoint colours", () => {
  const extentZ = 100;
  const { lineColors } = buildPathBuffers([{ points: [0, 0, 0, 0, 0, 50] }], extentZ);

  const expected = new THREE.Color(COLOR_NEAR).lerp(new THREE.Color(COLOR_FAR), 0.5);
  const actual = colorAt(lineColors, 1);

  for (const channel of ["r", "g", "b"]) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) < 1e-3, channel);
  }
});

test("colour depends on z only, not on x or y", () => {
  const extentZ = 100;
  const a = buildPathBuffers([{ points: [0, 0, 25, 0, 0, 75] }], extentZ);
  const b = buildPathBuffers([{ points: [4, 4, 25, 4, 4, 75] }], extentZ);

  assert.deepEqual(Array.from(a.lineColors), Array.from(b.lineColors));
});

test("a vertex shared by two segments gets the same colour in both", () => {
  const { lineColors } = buildPathBuffers([path(3, { dz: 10 })], 100);

  assert.deepEqual(colorAt(lineColors, 1).getHex(), colorAt(lineColors, 2).getHex());
});

// --- offsetOfPath -----------------------------------------------------------

const ranges4 = buildPathBuffers([path(3), path(5), path(2), path(4)], 100);

test("offsetOfPath(0) draws nothing", () => {
  assert.equal(offsetOfPath(0, ranges4.pathRanges, ranges4.vertexTotal), 0);
});

test("offsetOfPath clamps a negative count to zero", () => {
  assert.equal(offsetOfPath(-3, ranges4.pathRanges, ranges4.vertexTotal), 0);
});

test("offsetOfPath at or beyond the path count draws everything", () => {
  for (const n of [4, 5, 100]) {
    assert.equal(offsetOfPath(n, ranges4.pathRanges, ranges4.vertexTotal), ranges4.vertexTotal);
  }
});

test("offsetOfPath(n) is the end of path n-1", () => {
  const { pathRanges, vertexTotal } = ranges4;

  for (let n = 1; n <= pathRanges.length; n++) {
    const expected = pathRanges[n - 1].start + pathRanges[n - 1].count;
    assert.equal(offsetOfPath(n, pathRanges, vertexTotal), expected, `n=${n}`);
  }
});

test("offsetOfPath is monotonic non-decreasing", () => {
  const { pathRanges, vertexTotal } = ranges4;

  let previous = -1;
  for (let n = 0; n <= pathRanges.length + 2; n++) {
    const offset = offsetOfPath(n, pathRanges, vertexTotal);
    assert.ok(offset >= previous, `n=${n}`);
    previous = offset;
  }
});

test("offsetOfPath handles an empty scene", () => {
  const { pathRanges, vertexTotal } = buildPathBuffers([], 100);

  assert.equal(offsetOfPath(0, pathRanges, vertexTotal), 0);
  assert.equal(offsetOfPath(5, pathRanges, vertexTotal), 0);
});

// --- pathOfVertex -----------------------------------------------------------

test("pathOfVertex maps the first and last vertex of every path back to it", () => {
  const { pathRanges } = ranges4;

  pathRanges.forEach((range, p) => {
    assert.equal(pathOfVertex(range.start, pathRanges), p, `first of ${p}`);
    assert.equal(pathOfVertex(range.start + range.count - 1, pathRanges), p, `last of ${p}`);
  });
});

test("the range is half-open: start+count belongs to the NEXT path", () => {
  const { pathRanges } = ranges4;
  const boundary = pathRanges[0].start + pathRanges[0].count;

  assert.equal(pathOfVertex(boundary - 1, pathRanges), 0);
  assert.equal(pathOfVertex(boundary, pathRanges), 1);
});

test("every vertex in the buffer maps to some path", () => {
  const { pathRanges, vertexTotal } = ranges4;

  for (let v = 0; v < vertexTotal; v++) {
    assert.notEqual(pathOfVertex(v, pathRanges), -1, `vertex ${v}`);
  }
});

test("pathOfVertex returns -1 outside the buffer", () => {
  const { pathRanges, vertexTotal } = ranges4;

  assert.equal(pathOfVertex(-1, pathRanges), -1);
  assert.equal(pathOfVertex(vertexTotal, pathRanges), -1);
  assert.equal(pathOfVertex(vertexTotal + 10, pathRanges), -1);
});

test("pathOfVertex never matches a zero-length range", () => {
  // A 1-point path occupies no vertices; the path after it must own that offset.
  const { pathRanges } = buildPathBuffers([path(1), path(3)], 100);

  assert.equal(pathOfVertex(0, pathRanges), 1);
});

test("pathOfVertex on an empty scene returns -1", () => {
  assert.equal(pathOfVertex(0, buildPathBuffers([], 100).pathRanges), -1);
});

test("pathOfVertex inverts the packing for mixed-length paths", () => {
  const paths = [path(2), path(1), path(7), path(3), path(1), path(4)];
  const { pathRanges } = buildPathBuffers(paths, 100);

  pathRanges.forEach((range, p) => {
    if (range.count === 0) return;
    for (let v = range.start; v < range.start + range.count; v++) {
      assert.equal(pathOfVertex(v, pathRanges), p, `vertex ${v} of path ${p}`);
    }
  });
});

// --- the slider/raycast contract these two functions jointly satisfy --------

test("a vertex is drawn iff its path index is below the slider value", () => {
  const { pathRanges, vertexTotal } = ranges4;

  for (let shown = 0; shown <= pathRanges.length; shown++) {
    const drawn = offsetOfPath(shown, pathRanges, vertexTotal);
    for (let v = 0; v < vertexTotal; v++) {
      const p = pathOfVertex(v, pathRanges);
      assert.equal(v < drawn, p < shown, `shown=${shown} vertex=${v}`);
    }
  }
});
