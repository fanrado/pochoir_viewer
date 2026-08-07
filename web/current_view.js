/**
 * Draw the four induced-current panels.
 *
 * The 2x2 grid mirrors pixel geometry: the central pixel and its diagonal
 * neighbour sit on one diagonal of the grid, the x- and y-neighbours on the
 * other, matching the order the canvases appear in index.html.
 */

import {
  peakMagnitude,
  tickToUs,
  tickToX,
  tracesForPath,
  valueToY,
} from "./current_build.js";

/**
 * Canvas id per trace key, in grid order.
 *
 * Top-left central, top-right x-neighbour, bottom-left y-neighbour,
 * bottom-right diagonal — so the two panels on each diagonal of the grid are
 * the two pixels diagonal from each other in space.
 */
export const PANELS = [
  { key: "central", id: "current-central", title: "central" },
  { key: "neighbor_x", id: "current-neighbor-x", title: "x-neighbour" },
  { key: "neighbor_y", id: "current-neighbor-y", title: "y-neighbour" },
  { key: "diagonal", id: "current-diagonal", title: "diagonal" },
];

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

  const canvases = PANELS.map((panel) => ({
    ...panel,
    canvas: doc.getElementById(panel.id),
  }));
  const legend = doc.getElementById("current-legend");

  let selection = [];
  let cursor = null;

  /**
   * All four panels share ONE vertical scale, taken across every selected
   * path and every panel. Autoscaling per panel would draw the diagonal
   * neighbour — which peaks ~50x below the central pixel — as the same size
   * wiggle, destroying the amplitude comparison the view exists for.
   */
  function sharedPeak() {
    let peak = 0;
    for (const { i, j } of selection) {
      const traces = tracesForPath(data, i, j);
      const p = peakMagnitude(traces);
      if (p > peak) peak = p;
    }
    return peak;
  }

  function drawPanel({ canvas, key, title }, peak) {
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

    // Zero line: induced current is signed, so the baseline is mid-height and
    // needs to be visible for the sign to read at all.
    const mid = height / 2;
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    selection.forEach(({ i, j }, n) => {
      const trace = tracesForPath(data, i, j)[key];
      ctx.strokeStyle = pathColor(n);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let tick = 0; tick < trace.length; tick++) {
        const x = tickToX(tick, trace.length, width);
        const y = valueToY(trace[tick], peak, height);
        if (tick === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    if (cursor !== null) {
      const nTicks = data.meta.shape[2];
      const x = tickToX(cursor, nTicks, width);
      ctx.strokeStyle = "#a05000";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    ctx.fillStyle = "#444";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(title, 3, 10);

    // Time axis is labelled in physical units from the payload, never ticks.
    const span = tickToUs(data.meta.shape[2] - 1, data.meta);
    const label = `0–${span.toFixed(1)} ${timeUnits(data.meta)}`;
    ctx.fillText(label, 3, height - 3);
  }

  function drawLegend() {
    if (!legend) return;
    legend.replaceChildren();
    selection.forEach(({ i, j }, n) => {
      const row = doc.createElement("div");
      const swatch = doc.createElement("span");
      swatch.className = "current-swatch";
      swatch.style.background = pathColor(n);
      row.append(swatch, doc.createTextNode(` (${i}, ${j})`));
      legend.append(row);
    });
  }

  function draw() {
    const peak = sharedPeak();
    for (const panel of canvases) drawPanel(panel, peak);
    drawLegend();
  }

  return {
    /** Replace the selected paths. Each is `{i, j}` in the central quarter. */
    setSelection(next) {
      selection = [...next];
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
