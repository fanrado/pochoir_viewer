// Static checks on the control-panel markup added for the weighting field.
//
// index_html.test.js covers the page's import map, shortcuts and id uniqueness.
// This file covers the panel's own claims — in particular that each slice-axis
// label names the plane that axis actually shows, which is checked against
// extractSlice rather than restated by hand.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extractSlice } from "../../web/potential_build.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");

/** The <label> text wrapping the input with this id. */
function labelFor(id) {
  const match = html.match(new RegExp(`<label>[^<]*<input[^>]*id="${id}"[^>]*>([^<]*)</label>`));
  return match ? match[1].trim() : null;
}

/** Attributes of the input with this id. */
function inputAttrs(id) {
  const match = html.match(new RegExp(`<input([^>]*id="${id}"[^>]*)>`));
  return match ? match[1] : null;
}

// --- the field selector -----------------------------------------------------

test("both fields are offered", () => {
  assert.ok(inputAttrs("field-drift"), "no drift radio");
  assert.ok(inputAttrs("field-weight"), "no weight radio");
});

test("the field radios share one group name, so they are exclusive", () => {
  for (const id of ["field-drift", "field-weight"]) {
    assert.match(inputAttrs(id), /name="field"/, id);
  }
});

test("the field radios carry the values the CLI accepts", () => {
  // --field takes exactly these two choices; a mismatch would request a field
  // the exporter cannot produce.
  assert.match(inputAttrs("field-drift"), /value="drift"/);
  assert.match(inputAttrs("field-weight"), /value="weight"/);
});

test("drift is the checked default, matching the exporter", () => {
  assert.match(inputAttrs("field-drift"), /checked/);
  assert.doesNotMatch(inputAttrs("field-weight") ?? "", /checked/);
});

test("exactly one field radio is checked", () => {
  const checked = ["field-drift", "field-weight"].filter((id) =>
    /checked/.test(inputAttrs(id) ?? ""),
  );

  assert.equal(checked.length, 1);
});

// --- slice-axis labels name the plane each slice actually shows -------------

/** Which world axes an axis-slice spans, derived from extractSlice itself. */
function spannedAxes(axis) {
  // A deliberately non-cubic shape: equal dimensions would hide a mix-up.
  const shape = [2, 3, 5];
  const volume = new Float32Array(2 * 3 * 5);
  const { width, height } = extractSlice(volume, shape, axis, 0);
  const nameOf = (n) => ["x", "y", "z"][shape.indexOf(n)];
  return nameOf(width) + nameOf(height);
}

test("each slice-axis label names the plane that slice spans", () => {
  // "yz (x-slice)": an x-slice spans (j, k) = (y, z). Getting this backwards
  // is the same confusion that produced the transposed x slice in 278190b.
  for (const axis of ["x", "y", "z"]) {
    const label = labelFor(`axis-${axis}`);
    assert.ok(label, `no label for axis-${axis}`);
    assert.ok(
      label.startsWith(spannedAxes(axis)),
      `axis-${axis} is labelled "${label}" but spans ${spannedAxes(axis)}`,
    );
  }
});

test("each label also names the axis it slices along", () => {
  for (const axis of ["x", "y", "z"]) {
    assert.match(labelFor(`axis-${axis}`), new RegExp(`${axis}-slice`), axis);
  }
});

test("the three plane labels are distinct", () => {
  const labels = ["x", "y", "z"].map((a) => labelFor(`axis-${a}`));

  assert.equal(new Set(labels).size, 3);
});

test("the axis radios still share one group name", () => {
  for (const axis of ["x", "y", "z"]) {
    assert.match(inputAttrs(`axis-${axis}`), /name="slice-axis"/, axis);
  }
});

test("the axis radios keep their single-letter values", () => {
  // wireSliceControls keys on the element id, but the value is what a reader
  // and any future handler would use; it must stay the bare axis letter.
  for (const axis of ["x", "y", "z"]) {
    assert.match(inputAttrs(`axis-${axis}`), new RegExp(`value="${axis}"`), axis);
  }
});

test("z remains the checked starting axis", () => {
  assert.match(inputAttrs("axis-z"), /checked/);
  assert.doesNotMatch(inputAttrs("axis-x"), /checked/);
  assert.doesNotMatch(inputAttrs("axis-y"), /checked/);
});

// --- contour controls -------------------------------------------------------

test("the contour controls are present", () => {
  // #contour-levels went with the per-level checkboxes (af737a4).
  for (const id of ["layer-contours", "contour-status", "contour-legend"]) {
    assert.ok(html.includes(`id="${id}"`), `missing id="${id}"`);
  }
});

test("the contour toggle is a layer button that starts off", () => {
  const button = html.match(/<button id="layer-contours"([^>]*)>/)[1];

  assert.match(button, /class="layer"/);
  assert.match(button, /aria-pressed="false"/);
});

test("contour controls live inside the potential panel", () => {
  // They are meaningless without a loaded potential, so they must be hidden
  // with it rather than sitting outside.
  const panel = html.slice(
    html.indexOf('<div id="potential-controls"'),
    html.indexOf('<div id="groups">'),
  );

  assert.ok(panel.includes('id="contour-controls"'), "contours are outside the panel");
});

test("the potential panel still starts hidden", () => {
  assert.match(html, /<div id="potential-controls" hidden>/);
});

// --- panel-wide invariants --------------------------------------------------

test("every id in the panel is declared exactly once", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const duplicated = [...seen].filter(([, n]) => n > 1).map(([id]) => id);

  assert.deepEqual(duplicated, []);
});

test("every layer button declares its pressed state", () => {
  const buttons = [...html.matchAll(/<button id="(layer-[^"]+)"([^>]*)>/g)];

  assert.ok(buttons.length >= 4, "expected the layer button group");
  for (const [, id, attrs] of buttons) {
    assert.match(attrs, /aria-pressed="(true|false)"/, id);
  }
});

test("a pressed layer button is also marked active", () => {
  // The two must agree, or the visual state and the accessible state diverge.
  for (const [, id, attrs] of html.matchAll(/<button id="(layer-[^"]+)"([^>]*)>/g)) {
    const pressed = /aria-pressed="true"/.test(attrs);
    const active = /class="layer active"/.test(attrs);
    assert.equal(pressed, active, `${id}: aria-pressed and .active disagree`);
  }
});

test("every radio input sits inside a label", () => {
  const radios = [...html.matchAll(/<input type="radio"[^>]*id="([^"]+)"/g)].map((m) => m[1]);

  assert.ok(radios.length >= 5);
  for (const id of radios) {
    assert.ok(labelFor(id) !== null, `radio ${id} has no wrapping label`);
  }
});
