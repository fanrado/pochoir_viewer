/**
 * Drifting electron dots riding the drift paths.
 *
 * One dot per path, all in a single THREE.Points object: 100 separate objects
 * would be 100 draw calls for 100 vertices.
 */

import * as THREE from "three";

const DOT_SIZE_PX = 6;
const DOT_COLOR = 0xffe066;

/**
 * Position along `points` at fractional index `f`, written into `out`.
 *
 * `points` is the flat [x, y, z, ...] array scene.json ships. Linear
 * interpolation between the two bracketing samples; the tail clamps rather
 * than wrapping.
 */
export function samplePath(points, f, out) {
  const n = points.length / 3;
  if (n === 0) return out;

  const clamped = Math.min(Math.max(f, 0), n - 1);
  const i = Math.floor(clamped);
  const t = clamped - i;
  const a = i * 3;

  if (i >= n - 1) {
    out[0] = points[(n - 1) * 3];
    out[1] = points[(n - 1) * 3 + 1];
    out[2] = points[(n - 1) * 3 + 2];
    return out;
  }

  const b = a + 3;
  out[0] = points[a] + (points[b] - points[a]) * t;
  out[1] = points[a + 1] + (points[b + 1] - points[a + 1]) * t;
  out[2] = points[a + 2] + (points[b + 2] - points[a + 2]) * t;
  return out;
}

/**
 * Fractional decimated index for response tick `k`.
 *
 * THE MISMATCH THIS BRIDGES: the response has T = 3999 ticks but scene.json
 * ships paths decimated to at most 400 points (export.py max_points), so there
 * are roughly ten ticks per stored point. Mapping tick to a fractional index
 * and interpolating keeps the dot moving smoothly; snapping to the nearest
 * stored point would make it jump every ~10 ticks.
 *
 * `nPoints` is read per path rather than assumed to be 400, because decimate()
 * returns fewer points for short paths.
 */
export function tickToIndex(k, nTicks, nPoints) {
  if (nTicks < 2 || nPoints < 2) return 0;
  return (k / (nTicks - 1)) * (nPoints - 1);
}

/**
 * Build the dots and return their controls.
 *
 * Added to `sceneRoot` by the caller's convention, so the z-compression slider
 * scales the dots in step with the paths they ride on — a dot in world space
 * would drift off its own path the moment z is compressed.
 */
export function createDriftAnim(paths, nTicks) {
  const count = paths.length;
  const positions = new Float32Array(count * 3);
  const scratch = [0, 0, 0];

  // Everything starts parked at its own start point, so the full seeding
  // pattern near the cathode is visible before anything is selected.
  paths.forEach((path, p) => {
    samplePath(path.points, 0, scratch);
    positions[p * 3] = scratch[0];
    positions[p * 3 + 1] = scratch[1];
    positions[p * 3 + 2] = scratch[2];
  });

  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute("position", attribute);

  const material = new THREE.PointsMaterial({
    size: DOT_SIZE_PX,
    color: DOT_COLOR,
    sizeAttenuation: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "driftDots";

  let selected = new Set();

  function place(p, f) {
    samplePath(paths[p].points, f, scratch);
    positions[p * 3] = scratch[0];
    positions[p * 3 + 1] = scratch[1];
    positions[p * 3 + 2] = scratch[2];
  }

  return {
    points,

    /**
     * Move every ANIMATED dot to its position at tick `k`.
     *
     * Unselected dots are left where they are — parked at their start — so the
     * seeding pattern stays on screen while only the chosen electrons move.
     */
    setTick(k) {
      for (const p of selected) {
        place(p, tickToIndex(k, nTicks, paths[p].points.length / 3));
      }
      attribute.needsUpdate = true;
    },

    /** Choose which paths animate; the rest return to their start points. */
    setSelected(ids) {
      selected = new Set(ids);
      paths.forEach((_, p) => {
        if (!selected.has(p)) place(p, 0);
      });
      attribute.needsUpdate = true;
    },

    /** Currently animated path ids, for tests and callers that need to ask. */
    get selected() {
      return [...selected];
    },
  };
}
