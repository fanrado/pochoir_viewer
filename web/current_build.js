/**
 * Pure helpers for the induced-current payload.
 *
 * Like scene_build.js and unlike potential_view.js: no DOM, no THREE, and no
 * fetch at import time, so the whole module runs under `node --test` with no
 * WebGL context. Everything that touches a canvas lives in the drawing step.
 */

/** Reciprocity offset between neighbouring pixel quarters. Mirrors PIXEL_OFFSET. */
export const PIXEL_OFFSET = 5;

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
 * The buffer is C-order, so the trace for (i, j) is one contiguous run.
 */
function traceAt({ meta, block }, i, j) {
  const [, m, t] = meta.shape;
  const start = (i * m + j) * t;
  return block.subarray(start, start + t);
}

/**
 * The four induced-current traces for the path starting at ``(i, j)``.
 *
 * Browser-side mirror of `pixel_traces` in pochoir_viewer/current.py, and it
 * must stay in step with it. A response row is indexed by the electron's
 * STARTING position; by reciprocity the quarter that start falls in picks out
 * which pixel the current lands on, so the four pixels one path induces on are
 * four different rows of the same block, offset by PIXEL_OFFSET.
 *
 * ``(i, j)`` must lie in the central quarter — outside it the offsets name a
 * different pair of pixels and would run off the end of the buffer.
 */
export function tracesForPath(data, i, j) {
  const [rows, cols] = data.meta.shape;
  if (!(i >= 0 && i < PIXEL_OFFSET && j >= 0 && j < PIXEL_OFFSET)) {
    throw new RangeError(
      `start (${i}, ${j}) is outside the central quarter ` +
        `[0,${PIXEL_OFFSET}) — the reciprocity offsets are meaningless there`,
    );
  }
  if (rows <= i + PIXEL_OFFSET || cols <= j + PIXEL_OFFSET) {
    throw new RangeError(
      `block is ${rows}x${cols}, too narrow for the +${PIXEL_OFFSET} ` +
        `reciprocity offsets from (${i}, ${j})`,
    );
  }

  const k = PIXEL_OFFSET;
  return {
    central: traceAt(data, i, j),
    neighbor_x: traceAt(data, i + k, j),
    neighbor_y: traceAt(data, i, j + k),
    diagonal: traceAt(data, i + k, j + k),
  };
}

/** Time in microseconds at `tick`. The payload records the step; never guess it. */
export function tickToUs(tick, meta) {
  return tick * meta.time_step_us;
}

/**
 * Symmetric peak magnitude over `traces`, for a SHARED vertical scale.
 *
 * The four panels must share one scale or the comparison they exist to support
 * is meaningless: the diagonal neighbour peaks ~50x below the central pixel,
 * and autoscaling each panel would draw both as the same size wiggle. Symmetric
 * about zero because induced current changes sign.
 *
 * Returns 0 for an all-zero input; callers must treat that as "nothing to
 * scale" rather than dividing by it.
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
