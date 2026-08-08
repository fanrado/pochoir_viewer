// Behavioural tests for viewer.js's applySliceVisibility (c06e166).
//
// viewer.js cannot be imported, but this function is pure with respect to its
// three inputs, so its SOURCE TEXT is extracted and evaluated against stubs.
// That is a real behavioural test of the shipped code rather than a reading of
// it -- the rest of my viewer coverage is static, and 3cc9bf5 showed what
// static reading misses.
//
// The rule is a truth table over three controls that could otherwise
// contradict each other, and the bug it fixes was invisible in exactly the way
// that matters: switching the slice layer off left 200 contour lines behind,
// floating in the volume as a grid, because the layer button only ever moved
// sliceView.mesh.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const source = readFileSync(join(WEB_DIR, "viewer.js"), "utf8");

/** The body of a named top-level function, brace-matched. */
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `viewer.js no longer defines ${name}`);
  const rest = source.slice(start);
  const open = rest.indexOf("{");
  let depth = 0;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}" && --depth === 0) return rest.slice(0, i + 1);
  }
  assert.fail(`${name} is unbalanced`);
}

/**
 * Run the shipped applySliceVisibility against stubbed surroundings.
 *
 * Returns the two visibility flags it set.
 */
function apply({ layerSlice, layerContours, mode, hasSlice = true, hasContours = true }) {
  const sliceView = hasSlice ? { mesh: { visible: null } } : null;
  const contourView = hasContours ? { group: { visible: null } } : null;
  const pressed = (id) => (id === "layer-slice" ? layerSlice : layerContours);
  const sliceModes = mode === undefined ? null : { getMode: () => mode };

  const run = new Function(
    "pressed",
    "sliceModes",
    "sliceView",
    "contourView",
    `${functionSource("applySliceVisibility")}; applySliceVisibility();`,
  );
  run(pressed, sliceModes, sliceView, contourView);

  return {
    image: sliceView?.mesh.visible ?? null,
    contours: contourView?.group.visible ?? null,
  };
}

// --- the layer button governs the whole layer --------------------------------

test("the slice layer off hides the contours too", () => {
  // The defect: the layer button moved only the mesh, so 200 contour lines
  // stayed in the scene as a floating grid.
  for (const mode of ["image", "contours", "both"]) {
    const shown = apply({ layerSlice: false, layerContours: true, mode });

    assert.equal(shown.image, false, `mode ${mode}`);
    assert.equal(shown.contours, false, `mode ${mode} left the contours behind`);
  }
});

test("the slice layer off wins even with the contours layer on", () => {
  const shown = apply({ layerSlice: false, layerContours: true, mode: "contours" });

  assert.equal(shown.contours, false);
});

test("the slice layer on restores what the mode asks for", () => {
  const shown = apply({ layerSlice: true, layerContours: true, mode: "both" });

  assert.equal(shown.image, true);
  assert.equal(shown.contours, true);
});

// --- the mode decides between the two ----------------------------------------

test("image mode shows the plane and not the lines", () => {
  const shown = apply({ layerSlice: true, layerContours: true, mode: "image" });

  assert.equal(shown.image, true);
  assert.equal(shown.contours, false);
});

test("contours mode shows the lines and not the plane", () => {
  // "Contours hides the textured plane outright rather than fading it, so
  // nothing bleeds through from behind."
  const shown = apply({ layerSlice: true, layerContours: true, mode: "contours" });

  assert.equal(shown.image, false);
  assert.equal(shown.contours, true);
});

test("both shows both", () => {
  const shown = apply({ layerSlice: true, layerContours: true, mode: "both" });

  assert.deepEqual(shown, { image: true, contours: true });
});

// --- the contours layer gates the lines only ---------------------------------

test("the contours layer off hides the lines but keeps the plane", () => {
  const shown = apply({ layerSlice: true, layerContours: false, mode: "both" });

  assert.equal(shown.image, true);
  assert.equal(shown.contours, false);
});

test("the contours layer off cannot hide the plane in image mode", () => {
  const shown = apply({ layerSlice: true, layerContours: false, mode: "image" });

  assert.equal(shown.image, true);
});

test("contours mode with the contours layer off shows nothing", () => {
  // Legitimately empty: the mode hides the plane and the layer hides the
  // lines. Worth pinning as intended rather than as a blank-screen bug.
  const shown = apply({ layerSlice: true, layerContours: false, mode: "contours" });

  assert.deepEqual(shown, { image: false, contours: false });
});

// --- the whole truth table ---------------------------------------------------

test("every combination of the three controls is decided, not left null", () => {
  // One place decides visibility, so no combination may fall through.
  for (const layerSlice of [true, false]) {
    for (const layerContours of [true, false]) {
      for (const mode of ["image", "contours", "both"]) {
        const shown = apply({ layerSlice, layerContours, mode });
        assert.equal(typeof shown.image, "boolean", `${layerSlice}/${layerContours}/${mode}`);
        assert.equal(typeof shown.contours, "boolean", `${layerSlice}/${layerContours}/${mode}`);
      }
    }
  }
});

test("nothing is ever shown while the slice layer is off", () => {
  // The single invariant the commit is about, stated over the whole table.
  for (const layerContours of [true, false]) {
    for (const mode of ["image", "contours", "both"]) {
      const shown = apply({ layerSlice: false, layerContours, mode });
      assert.deepEqual(shown, { image: false, contours: false }, `${layerContours}/${mode}`);
    }
  }
});

test("the contours can never be shown while their own layer is off", () => {
  for (const layerSlice of [true, false]) {
    for (const mode of ["image", "contours", "both"]) {
      const shown = apply({ layerSlice, layerContours: false, mode });
      assert.equal(shown.contours, false, `${layerSlice}/${mode}`);
    }
  }
});

// --- the absent-payload states -----------------------------------------------

test("no payload loaded yet does not throw", () => {
  // potentialControls is hidden until a payload arrives; the layer button can
  // still be clicked.
  assert.doesNotThrow(() =>
    apply({ layerSlice: true, layerContours: true, mode: "both", hasSlice: false, hasContours: false }),
  );
});

test("a missing mode wiring defaults to both", () => {
  // getMode() is unavailable until wireSliceModes has run.
  const shown = apply({ layerSlice: true, layerContours: true, mode: undefined });

  assert.deepEqual(shown, { image: true, contours: true });
});

test("a contour view with no slice view is still gated", () => {
  const shown = apply({ layerSlice: false, layerContours: true, mode: "contours", hasSlice: false });

  assert.equal(shown.contours, false);
});

// --- the controls agree with each other --------------------------------------

test("picking a mode updates the contours layer button to match", () => {
  // Otherwise the button would claim contours are off while they are drawn.
  const listener = source.slice(source.indexOf('`mode-${mode}`'));

  assert.match(listener.slice(0, 300), /setPressed\("layer-contours", mode !== "image"\)/);
  assert.match(listener.slice(0, 300), /applySliceVisibility\(\)/);
});

test("setPressed moves the styling with the state", () => {
  // aria-pressed alone would leave the button looking unpressed.
  const body = functionSource("setPressed");

  assert.match(body, /setAttribute\("aria-pressed", String\(on\)\)/);
  assert.match(body, /classList\.toggle\("active", on\)/);
});

test("asking for contours in image mode moves the mode rather than doing nothing", () => {
  const handler = source.slice(source.indexOf('wireLayer("layer-contours"'));

  assert.match(handler.slice(0, 700), /getMode\(\) === "image"/);
  assert.match(handler.slice(0, 700), /getElementById\("mode-both"\)\?\.click\(\)/);
});

test("mode ownership stays in potential_view.js", () => {
  // The handler clicks the button rather than reaching into wireSliceModes'
  // internals, which is what keeps one owner for the mode state.
  const handler = source.slice(source.indexOf('wireLayer("layer-contours"'), source.indexOf('enableKeyboardShortcuts'));

  assert.equal(/sliceModes\.(setMode|mode\s*=)/.test(handler), false);
});

test("applySliceVisibility is the only place visibility is assigned", () => {
  // The stated design: "This is the ONE place visibility is decided, so the
  // controls cannot contradict each other." A second assignment in viewer.js
  // is how the original bug arose.
  const assignments = [...source.matchAll(/(sliceView\.mesh|contourView\.group)\.visible\s*=/g)];
  const body = functionSource("applySliceVisibility");

  assert.equal(
    assignments.length,
    (body.match(/\.visible\s*=/g) ?? []).length,
    "viewer.js assigns slice visibility outside applySliceVisibility",
  );
});

// --- listener accumulation across field switches ------------------------------
//
// buildPotential is called from selectField, so it runs again on every field
// switch. It both calls wireSliceModes -- which attaches a click listener to
// each mode button -- and attaches three of its own. Neither removes the
// previous set, so the listeners accumulate: after drift -> weight -> drift,
// each mode button carries three of each.
//
// The visible behaviour stays correct, which is why this is pinned rather than
// filed as a break: the newest viewer listener runs last and calls
// applySliceVisibility against the current views, so the final state is right.
// What accumulates is stale wireSliceModes closures holding DISPOSED sliceView
// and contourView objects, which they then set .visible on. That retains them
// and does a growing amount of pointless work per click.

test("the mode listeners are attached inside buildPotential", () => {
  // Pinning where they are, because that is the cause. If they move to module
  // scope -- attached once, like the layer buttons -- this test should be
  // rewritten to assert that instead.
  const start = source.indexOf("function buildPotential(");
  const rest = source.slice(start);
  let depth = 0;
  let end = 0;
  const open = rest.indexOf("{");
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = rest.slice(0, end);

  assert.match(body, /addEventListener\("click"/, "the mode listeners left buildPotential");
  assert.match(body, /sliceModes = wireSliceModes\(/);
});

test("buildPotential runs once per field switch, so they accumulate", () => {
  // The other half of the cause: one call site, inside selectField.
  const calls = [...source.matchAll(/\bbuildPotential\(/g)];

  assert.equal(calls.length, 2, "buildPotential's call sites changed");
  const selectField = source.slice(source.indexOf("async function selectField"));
  assert.match(selectField.slice(0, 4000), /buildPotential\(meta, volume\)/);
});

test("nothing removes the previous listeners", () => {
  // A removeEventListener or an AbortController would fix it; neither is
  // present today.
  assert.equal(/removeEventListener/.test(source), false, "listeners are now removed somewhere");
  assert.equal(/AbortController/.test(source), false, "an AbortController appeared");
});

test("the layer buttons are wired once, for contrast", () => {
  // wireLayer is called at module scope, so those do not accumulate. This is
  // the shape the mode buttons would need.
  const wireLayerCalls = [...source.matchAll(/^wireLayer\(/gm)];

  assert.ok(wireLayerCalls.length >= 3, "the layer buttons moved into a function");
});
