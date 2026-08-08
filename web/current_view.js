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
    for (let tick = 0; tick < trace.length; tick++) {
      const x = tickToX(tick, trace.length, width);
      const y = valueToY(trace[tick], peak, height);
      if (tick === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (cursor !== null) {
      const x = tickToX(cursor, data.meta.shape[2], width);
      ctx.strokeStyle = "#a05000";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    ctx.fillStyle = "#444";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(`(${i}, ${j}) peak ${peak.toExponential(2)}`, 3, 10);

    // Time axis in physical units from the payload, never raw ticks.
    const span = tickToUs(data.meta.shape[2] - 1, data.meta);
    ctx.fillText(`0–${span.toFixed(1)} ${timeUnits(data.meta)}`, 3, height - 3);
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
    /** Move the shared time cursor across all four panels. */
    setCursor(tick) {
      cursor = tick;
      draw();
    },
    draw,
  };
}
