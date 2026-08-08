/**
 * Pure helpers for the induced-current payload.
 *
 * Like scene_build.js and unlike potential_view.js: no DOM, no THREE, and no
 * fetch at import time, so the whole module runs under `node --test` with no
 * WebGL context. Everything that touches a canvas lives in the drawing step.
 */

/**
 * Fetch `current.json` and its binary, returning ``{meta, block}``.
 *
 * The length check is the same guard fetchPotential uses, with the same
 * wording: a stale .bin beside a fresh .json otherwise reads as garbage
 * waveforms rather than as an export that needs re-running.
 */
export async function fetchCurrent(base = "data", name = "current.json") {
  const metaResponse = await fetch(`${base}/${name}`);
  if (!metaResponse.ok) {
    throw new Error(`${base}/${name}: HTTP ${metaResponse.status}`);
  }
  const meta = await metaResponse.json();

  const binResponse = await fetch(`${base}/${meta.bin}`);
  if (!binResponse.ok) {
    throw new Error(`${base}/${meta.bin}: HTTP ${binResponse.status}`);
  }
  const buffer = await binResponse.arrayBuffer();

  if (buffer.byteLength !== meta.bytes) {
    throw new Error(
      `${meta.bin} is ${buffer.byteLength} bytes, expected ${meta.bytes} ` +
        `— re-run: python -m pochoir_viewer export-current`,
    );
  }

  return { meta, block: new Float32Array(buffer) };
}

/**
 * One (T,) trace out of the flat (M, M, T) buffer, without copying.
 *
 * The buffer is C-order, so the trace for (i, j) is one contiguous run:
 * `fr[i, j, :]` starts at `(i * cols + j) * nTicks`.
 *
 * Each panel reads exactly one cell this way. This is the only place the buffer
 * offset is computed.
 */
export function traceAt({ meta, block }, i, j) {
  const [, m, t] = meta.shape;
  const start = (i * m + j) * t;
  return block.subarray(start, start + t);
}

/** Time in microseconds at `tick`. The payload records the step; never guess it. */
export function tickToUs(tick, meta) {
  return tick * meta.time_step_us;
}

/**
 * Symmetric peak magnitude over `traces`, an iterable of numeric traces.
 *
 * Called PER PANEL: each slot holds an unrelated path, so each scales to its
 * own trace and prints that peak in its title. An earlier design shared one
 * scale across all four, which suited panels showing one path's neighbours but
 * would now flatten whichever selected path happens to be smaller.
 *
 * Symmetric about zero because induced current changes sign. Returns 0 for an
 * all-zero input; callers must treat that as "nothing to scale" rather than
 * dividing by it.
 */
export function peakMagnitude(traces) {
  let peak = 0;
  for (const trace of Object.values(traces)) {
    for (const v of trace) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * Map a current value to a y pixel, zero at mid-height and +peak at the top.
 *
 * Canvas y grows downward, hence the subtraction. A zero `peak` pins everything
 * to the centre line instead of producing NaN.
 */
export function valueToY(value, peak, height) {
  const mid = height / 2;
  if (!peak) return mid;
  return mid - (value / peak) * mid;
}

/** Map a tick index to an x pixel across `width`. */
export function tickToX(tick, nTicks, width) {
  if (nTicks < 2) return 0;
  return (tick / (nTicks - 1)) * width;
}
