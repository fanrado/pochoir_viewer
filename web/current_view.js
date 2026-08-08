/**
 * Draw the four induced-current panels.
 *
 * The 2x2 grid mirrors pixel geometry: the central pixel and its diagonal
 * neighbour sit on one diagonal of the grid, the x- and y-neighbours on the
 * other, matching the order the canvases appear in index.html.
 */

import {
  clampViewport,
  fullViewport,
  peakMagnitude,
  tickToUs,
  tickToXIn,
  traceAt,
  valueToY,
} from "./current_build.js";

/**
 * The four canvases, used as four SELECTION SLOTS.
 *
 * Panel n shows the nth selected path and nothing else: its own fr[i, j, :]
 * read with traceAt. Select one path and only the first panel has content; the
 * other three are blank.
 *
 * NO INFERRED NEIGHBOURS. These panels used to show one path's four mirrored
 * partners, so selecting a single cell filled all four and invited the reading
 * that four paths were selected. The ids still carry their original names; only
 * the markup depends on those.
 */
export const PANELS = [
  { id: "current-central" },
  { id: "current-neighbor-x" },
  { id: "current-neighbor-y" },
  { id: "current-diagonal" },
];

/** Slots available; the selection is rendered up to this many. */
export const SLOT_COUNT = PANELS.length;

/**
 * Curve colours, cycled by selection order.
 *
 * Chosen to stay distinguishable against the white canvas and from each other;
 * the selector allows more paths than there are entries, so the cycle repeats
 * and the legend remains the authority on which curve is which.
 */
export const PATH_COLORS = [
  "#1f6fd0",
  "#d04a1f",
  "#1f9c53",
  "#8a3fd0",
  "#c9a227",
  "#0f8f9c",
];

/** Colour for the nth selected path. */
export function pathColor(n) {
  return PATH_COLORS[n % PATH_COLORS.length];
}

function requireDocument(doc, who) {
  if (!doc || typeof doc.getElementById !== "function") {
    throw new TypeError(
      `${who} needs a document: none was passed and globalThis.document is unavailable`,
    );
  }
}

/**
 * Time unit for the axis label.
 *
 * Read from the payload rather than hardcoded: nothing else in the UI assumes
 * volts either, and an exporter that one day writes ns must not be mislabelled.
 */
function timeUnits(meta) {
  return meta.time_units ?? "us";
}

/**
 * Wire the four panels to a payload and return the drawing controls.
 *
 * `selection` is a list of `{i, j}` starts; every panel draws ONE CURVE PER
 * SELECTED PATH, so four selected paths put sixteen curves on screen. The
 * legend keys colour to `{i, j}` because nothing else on screen can.
 */
export function createCurrentView(data, doc = globalThis.document) {
  requireDocument(doc, "createCurrentView");

  const canvases = PANELS.map((panel, n) => ({
    ...panel,
    slot: n,
    canvas: doc.getElementById(panel.id),
  }));
  const legend = doc.getElementById("current-legend");

  let selection = [];
  let cursor = null;

  /**
   * One time window PER PANEL, indexed by slot.
   *
   * Deliberately not shared: zooming one panel must leave the other three
   * where they were, so each slot keeps its own {tickLo, tickHi}.
   */
  const viewports = PANELS.map(() => fullViewport(data.meta.shape[2]));

  function drawPanel({ canvas, slot }) {
    if (!canvas) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;

    // Match the backing store to the CSS box so lines are not blurred by the
    // browser scaling a stale bitmap.
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // An unfilled slot is COMPLETELY blank: no curve, no title, no axes ghost,
    // and no leftover from a previous selection. Anything drawn here would
    // imply a path that is not selected, which is the bug this step fixes.
    const pick = selection[slot];
    if (!pick) return;

    const { i, j } = pick;
    const trace = traceAt(data, i, j);
    const view = viewports[slot];

    // Each panel autoscales to ITS OWN trace. The slots hold unrelated paths
    // now, so a shared scale would flatten whichever is smaller for no reason;
    // the peak goes in the title so the scales stay comparable by eye.
    const peak = peakMagnitude([trace]);

    // Zero line: induced current is signed, so the baseline is mid-height and
    // needs to be visible for the sign to read at all.
    const mid = height / 2;
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    ctx.strokeStyle = pathColor(slot);
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Only the ticks inside this panel's window are drawn, one pixel column at
    // a time through tickToXIn. The endpoints are rounded outward so a partly
    // visible segment still enters and leaves at the panel edge rather than
    // stopping short of it.
    const first = Math.max(Math.floor(view.tickLo), 0);
    const last = Math.min(Math.ceil(view.tickHi), trace.length - 1);
    for (let tick = first; tick <= last; tick++) {
      const x = tickToXIn(tick, view, width);
      const y = valueToY(trace[tick], peak, height);
      if (tick === first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // The cursor ties the panels to the animation, so it must never lie about
    // where the electron is. A tick outside this window is NOT drawn at the
    // edge: clamping would park it at 0 or full width and show the electron at
    // a time it is not at.
    if (cursor !== null && cursor >= view.tickLo && cursor <= view.tickHi) {
      const x = tickToXIn(cursor, view, width);
      ctx.strokeStyle = "#a05000";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    ctx.fillStyle = "#444";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(`(${i}, ${j}) peak ${peak.toExponential(2)}`, 3, 10);

    // Time axis in physical units from the payload, never raw ticks, and
    // recomputed from THIS panel's window so a zoomed panel reads the span it
    // actually shows.
    // One decimal on BOTH ends, so a zoomed panel reads "88.5–92.0 us" and the
    // two numbers line up rather than one carrying a decimal the other lacks.
    const us = (tick) => tickToUs(tick, data.meta).toFixed(1);
    ctx.fillText(
      `${us(view.tickLo)}–${us(view.tickHi)} ${timeUnits(data.meta)}`,
      3,
      height - 3,
    );
  }

  function drawLegend() {
    if (!legend) return;
    legend.replaceChildren();
    selection.forEach((pick, n) => {
      // Slots arrive with holes: an empty slot has no legend row either.
      if (!pick) return;
      const { i, j } = pick;
      const row = doc.createElement("div");
      const swatch = doc.createElement("span");
      swatch.className = "current-swatch";
      swatch.style.background = pathColor(n);
      row.append(swatch, doc.createTextNode(` (${i}, ${j})`));
      legend.append(row);
    });
  }

  function draw() {
    for (const panel of canvases) drawPanel(panel);
    drawLegend();
  }

  return {
    /**
     * Replace the selected paths, in slot order.
     *
     * Only the first SLOT_COUNT are rendered; there are no panels for the rest.
     * The four-slot cap itself is enforced by the selector.
     */
    setSelection(next) {
      selection = [...next].slice(0, SLOT_COUNT);
      draw();
    },
    /**
     * This panel's own viewport, for the zoom controls.
     *
     * Copied out, so a caller cannot mutate the stored one behind draw()'s
     * back.
     */
    viewportOf(slot) {
      return { ...viewports[slot] };
    },

    /**
     * Replace one panel's window. Per panel by design: zooming one must leave
     * the other three exactly where they were.
     */
    setViewport(slot, viewport) {
      viewports[slot] = clampViewport(
        viewport.tickLo,
        viewport.tickHi,
        data.meta.shape[2],
      );
      draw();
    },

    /** Move the shared time cursor across all four panels. */
    setCursor(tick) {
      cursor = tick;
      draw();
    },
    draw,
  };
}
