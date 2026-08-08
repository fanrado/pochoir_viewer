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

/**
 * Smallest window zoom may reach, in ticks.
 *
 * A one-tick window has no span to map across the canvas, so `tickToXIn` would
 * divide by zero and the panel would draw a vertical bar. Bottoming out at a
 * few ticks keeps a hard-zoomed panel showing a readable slope instead.
 */
export const MIN_VIEWPORT_TICKS = 4;

/**
 * The whole time axis, which is what a panel opens on.
 *
 * A viewport is `{tickLo, tickHi}` over `[0, nTicks - 1]` and belongs to ONE
 * panel: the four zoom independently, so nothing here is shared between them.
 * TIME ONLY — amplitude stays autoscaled per panel to its own peak.
 */
export function fullViewport(nTicks) {
  return { tickLo: 0, tickHi: Math.max(nTicks - 1, MIN_VIEWPORT_TICKS) };
}

/** The full span again, for the reset control. */
export function resetViewport(nTicks) {
  return fullViewport(nTicks);
}

/**
 * Force a candidate window to be a legal viewport.
 *
 * Every invariant lives HERE rather than in the callers: a backwards drag, an
 * over-zoom or a pan off the end all arrive as some bad pair of numbers, and
 * fixing them at each call site is how one of them gets missed. Guarantees
 * `tickLo < tickHi`, both ends inside `[0, nTicks - 1]`, and a span of at least
 * MIN_VIEWPORT_TICKS.
 */
export function clampViewport(tickLo, tickHi, nTicks) {
  const last = Math.max(nTicks - 1, MIN_VIEWPORT_TICKS);

  // A drag from right to left is the same window as left to right.
  let lo = Math.min(tickLo, tickHi);
  let hi = Math.max(tickLo, tickHi);

  if (hi - lo < MIN_VIEWPORT_TICKS) {
    // Grow about the centre so a too-small window does not jump to one end.
    const mid = (lo + hi) / 2;
    lo = mid - MIN_VIEWPORT_TICKS / 2;
    hi = mid + MIN_VIEWPORT_TICKS / 2;
  }

  // Slide, rather than squash, a window that overhangs an end: the span the
  // user asked for is preserved wherever it will fit.
  if (lo < 0) {
    hi -= lo;
    lo = 0;
  }
  if (hi > last) {
    lo -= hi - last;
    hi = last;
  }

  return { tickLo: Math.max(lo, 0), tickHi: Math.min(hi, last) };
}

/** Zoom `viewport` by `factor` about `anchorTick`, keeping that tick put. */
export function zoomBy(viewport, factor, anchorTick, nTicks) {
  const { tickLo, tickHi } = viewport;
  // factor < 1 zooms in. Anchoring on the pointer keeps whatever is under it
  // from sliding away as the window shrinks.
  const anchor = Math.min(Math.max(anchorTick, tickLo), tickHi);
  return clampViewport(
    anchor - (anchor - tickLo) * factor,
    anchor + (tickHi - anchor) * factor,
    nTicks,
  );
}

/** Zoom to the span a drag selected, in either direction. */
export function zoomTo(tickA, tickB, nTicks) {
  return clampViewport(tickA, tickB, nTicks);
}

/** Map a tick to an x pixel THROUGH a viewport. */
export function tickToXIn(tick, viewport, width) {
  const { tickLo, tickHi } = viewport;
  const span = tickHi - tickLo;
  if (span <= 0) return 0;
  return ((tick - tickLo) / span) * width;
}

/** Map an x pixel back to a tick, for wheel anchors and drag endpoints. */
export function xToTickIn(x, viewport, width) {
  const { tickLo, tickHi } = viewport;
  if (width <= 0) return tickLo;
  return tickLo + (x / width) * (tickHi - tickLo);
}
