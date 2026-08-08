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
 * Fractional decimated index for response tick `k`, for ONE path.
 *
 * Two conversions, and the second is what the old proportional stretch got
 * wrong:
 *
 * 1. tick -> RAW step index, `k * pointsPerTick`. The path array and the
 *    response are on different clocks; `pointsPerTick` comes from the payload
 *    (1.0 for the reference dataset, 50 where 200000 path points are binned
 *    into 4000).
 * 2. raw step -> decimated index, scaled by the path's OWN real length. The
 *    decimated array spans `pathSteps` raw steps in `nPoints` samples.
 *
 * CLAMPED AT `pathSteps`: once the electron is collected it parks at the anode
 * and the remaining ticks move it no further. Stretching every path across all
 * T ticks instead — which is what `k / (nTicks - 1)` did — made every electron
 * arrive exactly at the final tick whatever its real drift length, so path 0
 * (1810 of 3999 steps) had its current spike at ~45% of the window while its
 * dot was not yet halfway down.
 *
 * `nPoints` is read per path rather than assumed to be 400, because decimate()
 * returns fewer points for short paths.
 */
export function tickToIndex(k, nPoints, { pointsPerTick = 1, pathSteps } = {}) {
  if (nPoints < 2) return 0;

  const steps = pathSteps ?? 0;
  if (steps < 2) return 0;

  const raw = k * pointsPerTick;
  // Fraction of this path's OWN drift completed, never of the whole window.
  const fraction = Math.min(raw / (steps - 1), 1);
  return fraction * (nPoints - 1);
}

/**
 * Build the dots and return their controls.
 *
 * Added to `sceneRoot` by the caller's convention, so the z-compression slider
 * scales the dots in step with the paths they ride on — a dot in world space
 * would drift off its own path the moment z is compressed.
 */
export function createDriftAnim(paths, nTicks, timing = {}) {
  // points_per_tick and path_steps come from current.json (Phase M/Step 1).
  // Without them a dot cannot be placed: pathSteps falls back to the stored
  // point count, which is only right when the path was never padded.
  const pointsPerTick = timing.points_per_tick ?? 1;
  const pathSteps = timing.path_steps ?? [];
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
        const nPoints = paths[p].points.length / 3;
        place(p, tickToIndex(k, nPoints, {
          pointsPerTick,
          pathSteps: pathSteps[p] ?? nPoints,
        }));
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
