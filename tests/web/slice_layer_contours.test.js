// Regression tests for pochoir_viewer-k9jk (Phase G/Step 1).
//
// THE BUG: showing the potential slice and then switching the layer off left a
// grid floating in the drift volume. wireLayer("layer-slice") moved only
// sliceView.mesh.visible, so the 200 contour lines drawn on the slice stayed in
// the scene, and #layer-contours had no wireLayer at all so it could not clear
// them either.
//
// viewer.js cannot be imported under node (top-level-await fetch, WebGL at
// module scope), so this EXECUTES the real applySliceVisibility declaration
// lifted out of the source rather than restating its rules — a restatement
// would only test itself. The sibling source-grep tests in
// slice_visibility.test.js check where things are wired; these check what the
// visibility rule actually computes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const source = readFileSync(join(WEB_DIR, "viewer.js"), "utf8");
const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");

/** Source text of a top-level `function name(...) { ... }`, braces matched. */
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `viewer.js no longer defines ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced braces in ${name}`);
}

/**
 * Run the shipped visibility rule for one combination of the three controls.
 *
 * Returns what the scene would show: `{ mesh, lines }`.
 */
function visibility({ sliceLayer, contoursLayer, mode }) {
  const sliceView = { mesh: { visible: null } };
  const contourView = { group: { visible: null } };

  const run = new Function(
    "pressed",
    "sliceModes",
    "sliceView",
    "contourView",
    `${functionSource("applySliceVisibility")}
     applySliceVisibility();`,
  );

  run(
    (id) => (id === "layer-slice" ? sliceLayer : contoursLayer),
    { getMode: () => mode },
    sliceView,
    contourView,
  );

  return { mesh: sliceView.mesh.visible, lines: contourView.group.visible };
}

const MODES = ["image", "contours", "both"];

// --- the reported bug ----------------------------------------------------------

test("with the slice layer off nothing is left in the volume, whatever the mode", () => {
  // The regression itself: the contour lines used to survive the layer being
  // switched off, and that is what the user saw as a grid in the drift volume.
  for (const mode of MODES) {
    const shown = visibility({ sliceLayer: false, contoursLayer: true, mode });

    assert.deepEqual(shown, { mesh: false, lines: false }, `mode ${mode}`);
  }
});

test("the layer off hides the contours even with the contours button pressed", () => {
  const shown = visibility({ sliceLayer: false, contoursLayer: true, mode: "contours" });

  assert.equal(shown.lines, false, "the 200 contour lines stayed in the scene");
});

// --- turning it back on --------------------------------------------------------

test("turning the layer on restores exactly the mode's choice", () => {
  // Not "both visible": the mode decides, which is the other half of the fix.
  const expected = {
    image: { mesh: true, lines: false },
    contours: { mesh: false, lines: true },
    both: { mesh: true, lines: true },
  };

  for (const mode of MODES) {
    assert.deepEqual(
      visibility({ sliceLayer: true, contoursLayer: true, mode }),
      expected[mode],
      `mode ${mode}`,
    );
  }
});

test("the layer coming back on does not force both objects visible", () => {
  const shown = visibility({ sliceLayer: true, contoursLayer: true, mode: "image" });

  assert.equal(shown.lines, false, "the layer overrode the mode");
});

// --- the contours layer button -------------------------------------------------

test("the contours button actually toggles the contours", () => {
  const on = visibility({ sliceLayer: true, contoursLayer: true, mode: "both" });
  const off = visibility({ sliceLayer: true, contoursLayer: false, mode: "both" });

  assert.equal(on.lines, true);
  assert.equal(off.lines, false, "#layer-contours changed nothing");
});

test("the contours button does not disturb the slice image", () => {
  for (const contoursLayer of [true, false]) {
    const shown = visibility({ sliceLayer: true, contoursLayer, mode: "both" });

    assert.equal(shown.mesh, true, `contoursLayer ${contoursLayer}`);
  }
});

test("the contours button cannot show contours while the layer is off", () => {
  const shown = visibility({ sliceLayer: false, contoursLayer: true, mode: "both" });

  assert.equal(shown.lines, false);
});

// --- the full truth table ------------------------------------------------------

test("visibility is exactly layer AND mode AND, for lines, the contours button", () => {
  // Stated as the rule rather than case by case, so a change to any one control
  // is caught rather than only the combinations someone thought to enumerate.
  for (const sliceLayer of [true, false]) {
    for (const contoursLayer of [true, false]) {
      for (const mode of MODES) {
        const shown = visibility({ sliceLayer, contoursLayer, mode });

        assert.deepEqual(
          shown,
          {
            mesh: sliceLayer && mode !== "contours",
            lines: sliceLayer && mode !== "image" && contoursLayer,
          },
          `layer=${sliceLayer} contours=${contoursLayer} mode=${mode}`,
        );
      }
    }
  }
});

// --- the wiring the rule depends on --------------------------------------------

/** The whole `wireLayer("id", ...)` call, braces matched. */
function wireLayerCall(id) {
  const start = source.indexOf(`wireLayer("${id}"`);
  assert.ok(start > 0, `${id} is not wired`);
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced parentheses in the ${id} wiring`);
}

test("both layer buttons run the same visibility rule", () => {
  // Two controls governing one object is what caused the bug; there must be a
  // single authority and both buttons must call it. Matched over the whole
  // callback rather than a fixed character window: a comment added inside it
  // must not decide whether this test passes.
  for (const id of ["layer-slice", "layer-contours"]) {
    assert.match(
      wireLayerCall(id),
      /applySliceVisibility\(\)/,
      `${id} does not go through applySliceVisibility`,
    );
  }
});

test("#layer-contours exists in the markup it is wired against", () => {
  assert.match(html, /id="layer-contours"/);
});
