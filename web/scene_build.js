// Pure scene-construction helpers: no DOM, no renderer, no fetch, no top-level
// side effects. viewer.js owns all of that. Kept separate so these can be
// imported and unit-tested in node without a WebGL context.

import * as THREE from "three";

// Display labels, not physics claims — they come from the exporter's z ordering.
export const GROUP_COLORS = { anode: 0xff8844, grid: 0x44ccff, cathode: 0x88ff88 };
export const FALLBACK_COLORS = [0xcc99ff, 0xffcc44, 0x99ffcc, 0xff99cc];

export const COLOR_FAR = 0x2222ff; // at z = extent_mm[2]
export const COLOR_NEAR = 0xffff22; // at z = 0

export function buildBoundaryMesh(group, index) {
  // One mesh per group: every quad contributes two +z-facing triangles.
  const positions = new Float32Array(group.quads.length * 18);
  const normals = new Float32Array(group.quads.length * 18);
  const z = (group.z_min_mm + group.z_max_mm) / 2;

  group.quads.forEach(([x0, y0, x1, y1], q) => {
    const corners = [
      x0, y0, z, x1, y0, z, x1, y1, z,
      x0, y0, z, x1, y1, z, x0, y1, z,
    ];
    positions.set(corners, q * 18);
    for (let v = 0; v < 6; v++) normals.set([0, 0, 1], q * 18 + v * 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const material = new THREE.MeshLambertMaterial({
    color: GROUP_COLORS[group.name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = group.name;
  return mesh;
}

/**
 * Flatten every path into one interleaved LineSegments buffer.
 *
 * All paths live in a single buffer: one Line object per path would be one draw
 * call per path, and a single buffer also gives the hover raycast one target.
 *
 * Returns {linePositions, lineColors, pathRanges, vertexTotal}, where
 * pathRanges[p] is the {start, count} vertex range of path p.
 */
export function buildPathBuffers(paths, extentZ) {
  const colorFar = new THREE.Color(COLOR_FAR);
  const colorNear = new THREE.Color(COLOR_NEAR);

  const pathRanges = []; // {start, count} in vertices, indexed by path

  let vertexTotal = 0;
  for (const path of paths) {
    const segments = Math.max(path.points.length / 3 - 1, 0);
    pathRanges.push({ start: vertexTotal, count: segments * 2 });
    vertexTotal += segments * 2;
  }

  const linePositions = new Float32Array(vertexTotal * 3);
  const lineColors = new Float32Array(vertexTotal * 3);
  const scratch = new THREE.Color();

  paths.forEach((path, p) => {
    const pts = path.points;
    let w = pathRanges[p].start * 3;

    for (let i = 0; i + 5 < pts.length; i += 3) {
      // Emit the consecutive pair (i, i+1) as one segment.
      for (const base of [i, i + 3]) {
        linePositions[w] = pts[base];
        linePositions[w + 1] = pts[base + 1];
        linePositions[w + 2] = pts[base + 2];

        scratch.copy(colorNear).lerp(colorFar, pts[base + 2] / extentZ);
        lineColors[w] = scratch.r;
        lineColors[w + 1] = scratch.g;
        lineColors[w + 2] = scratch.b;
        w += 3;
      }
    }
  });

  return { linePositions, lineColors, pathRanges, vertexTotal };
}

/** Vertex offset just past path N-1, i.e. the draw count showing N paths. */
export function offsetOfPath(n, pathRanges, vertexTotal) {
  if (n <= 0) return 0;
  if (n >= pathRanges.length) return vertexTotal;
  return pathRanges[n - 1].start + pathRanges[n - 1].count;
}

/** Path owning a given vertex index, or -1. */
export function pathOfVertex(index, pathRanges) {
  for (let p = 0; p < pathRanges.length; p++) {
    const { start, count } = pathRanges[p];
    if (index >= start && index < start + count) return p;
  }
  return -1;
}
