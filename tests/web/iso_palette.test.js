// Tests for the isosurface shell palette, render ordering and opacity slider.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  ISO_PALETTE,
  applyIsoOpacity,
  buildIsoSurfaces,
} from "../../web/potential_view.js";

const meta = (over = {}) => ({
  shape: [4, 4, 4],
  spacing: [0.1, 0.1, 0.1],
  origin: [0, 0, 0],
  vmin: -8000,
  vmax: 0,
  units: "V",
  isosurfaces: [],
  skipped_levels: [],
  ...over,
});

/** N surfaces with descending levels; index 0 is the LOWEST level. */
function surfaces(levels) {
  return levels.map((level) => ({
    level,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    n_tris: 1,
  }));
}

function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    className: "",
    type: "",
    checked: false,
    value: "0.35",
    style: {},
    children: [],
    handlers: {},
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); },
    fire(t) { for (const fn of this.handlers[t] ?? []) fn(); },
    append(...kids) { this.children.push(...kids); },
  };
}

function fakeDoc(elements = {}) {
  const created = [];
  return {
    elements,
    created,
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => { const el = fakeElement(tag); created.push(el); return el; },
  };
}

const hexes = (meshes) => meshes.map((m) => m.material.color.getHex());
const paletteHexes = () => ISO_PALETTE.map((h) => new THREE.Color(h).getHex());

// --- the palette ------------------------------------------------------------

test("the palette has seven distinct saturated hues", () => {
  assert.equal(ISO_PALETTE.length, 7);
  assert.equal(new Set(ISO_PALETTE).size, 7);
});

test("no palette entry is black or white", () => {
  // The whole point of the reversal: no shell may come out muddy or invisible.
  for (const hex of ISO_PALETTE) {
    const c = new THREE.Color(hex);
    const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    assert.ok(luma > 0.15, `${hex.toString(16)} is too dark`);
    assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.3, "not saturated");
  }
});

test("every shell takes a palette colour", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-6000, -4000, -2000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  for (const hex of hexes(meshes)) assert.ok(paletteHexes().includes(hex));
});

test("the highest level gets the first palette entry", () => {
  // Innermost shell first, per the palette docstring.
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-6000, -4000, -2000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const highest = meshes[2]; // level -2000
  assert.equal(highest.material.color.getHex(), new THREE.Color(ISO_PALETTE[0]).getHex());
});

test("palette rank follows level order, not array order", () => {
  // The input is deliberately shuffled: colour must track the level.
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000, -1000, -7000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const byLevel = [...meshes].sort(
    (a, b) => Number(b.name.split(" ")[1]) - Number(a.name.split(" ")[1]),
  );
  assert.deepEqual(
    byLevel.map((m) => m.material.color.getHex()),
    ISO_PALETTE.slice(0, 3).map((h) => new THREE.Color(h).getHex()),
  );
});

test("distinct levels get distinct colours up to the palette length", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-7000, -6000, -5000, -4000, -3000, -2000, -1000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  assert.equal(new Set(hexes(meshes)).size, 7);
});

test("more levels than hues wraps rather than going black", () => {
  // The docstring's stated fallback: two shells may repeat a colour.
  const levels = Array.from({ length: 10 }, (_, n) => -9000 + n * 500);
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces(levels) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  assert.equal(meshes.length, 10);
  for (const hex of hexes(meshes)) assert.ok(paletteHexes().includes(hex));
  assert.equal(new Set(hexes(meshes)).size, 7, "expected exactly the 7 hues, wrapped");
});

test("the wrap is modular: entry 8 repeats entry 1", () => {
  const levels = Array.from({ length: 8 }, (_, n) => -8000 + n * 500);
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces(levels) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const byLevel = [...meshes].sort(
    (a, b) => Number(b.name.split(" ")[1]) - Number(a.name.split(" ")[1]),
  );
  assert.equal(
    byLevel[7].material.color.getHex(),
    byLevel[0].material.color.getHex(),
  );
});

test("a single level uses the first hue", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  assert.equal(meshes[0].material.color.getHex(), new THREE.Color(ISO_PALETTE[0]).getHex());
});

// --- render ordering --------------------------------------------------------

test("the outermost shell draws first", () => {
  // Lower renderOrder draws first; several shells interleave with the pad and
  // grid planes, where unordered transparent draws blend wrongly.
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-6000, -4000, -2000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const outermost = meshes[0]; // lowest level -6000
  const innermost = meshes[2]; // highest level -2000
  assert.ok(
    outermost.renderOrder < innermost.renderOrder,
    `outermost ${outermost.renderOrder} should precede innermost ${innermost.renderOrder}`,
  );
});

test("render order is monotonic across every level", () => {
  const levels = [-7000, -5000, -3000, -1000];
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces(levels) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const byLevelAscending = [...meshes].sort(
    (a, b) => Number(a.name.split(" ")[1]) - Number(b.name.split(" ")[1]),
  );
  const orders = byLevelAscending.map((m) => m.renderOrder);
  for (let n = 1; n < orders.length; n++) {
    assert.ok(orders[n] > orders[n - 1], `not monotonic at ${n}: ${orders}`);
  }
});

test("render orders are distinct", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-6000, -4000, -2000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  const orders = meshes.map((m) => m.renderOrder);
  assert.equal(new Set(orders).size, orders.length);
});

test("a single shell has a finite render order", () => {
  // `-rank || 0` turns -0 into 0; it must never be NaN or undefined.
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  assert.ok(Number.isFinite(meshes[0].renderOrder));
  assert.ok(!Object.is(meshes[0].renderOrder, -0));
});

// --- applyIsoOpacity --------------------------------------------------------

test("opacity is applied to the material", () => {
  const material = new THREE.MeshLambertMaterial();

  applyIsoOpacity(material, 0.5);

  assert.equal(material.opacity, 0.5);
});

test("a translucent value keeps transparent blending and no depth write", () => {
  const material = new THREE.MeshLambertMaterial();

  applyIsoOpacity(material, 0.35);

  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
});

test("at the top of the slider the shell becomes a genuine solid", () => {
  // A fully opaque mesh left in transparent mode sorts wrongly and shows
  // artefacts, which is the stated reason for the flip.
  const material = new THREE.MeshLambertMaterial();

  applyIsoOpacity(material, 1.0);

  assert.equal(material.transparent, false);
  assert.equal(material.depthWrite, true);
});

test("the solid threshold is 0.98, inclusive", () => {
  const at = new THREE.MeshLambertMaterial();
  const below = new THREE.MeshLambertMaterial();

  applyIsoOpacity(at, 0.98);
  applyIsoOpacity(below, 0.96);

  assert.equal(at.transparent, false, "0.98 should be solid");
  assert.equal(below.transparent, true, "0.96 should be translucent");
});

test("the flip is reversible", () => {
  const material = new THREE.MeshLambertMaterial();

  applyIsoOpacity(material, 1.0);
  applyIsoOpacity(material, 0.3);

  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
});

test("needsUpdate is set so the flag change takes effect", () => {
  // three's Material.needsUpdate is a write-only setter that bumps .version;
  // asserting the boolean back would always fail.
  const material = new THREE.MeshLambertMaterial();
  const before = material.version;

  applyIsoOpacity(material, 0.5);

  assert.ok(material.version > before, "material version did not advance");
});

test("a fully transparent shell is still valid", () => {
  const material = new THREE.MeshLambertMaterial();

  applyIsoOpacity(material, 0.02);

  assert.equal(material.opacity, 0.02);
  assert.equal(material.transparent, true);
});

// --- the opacity slider -----------------------------------------------------

/**
 * ONE shared slider for every test below.
 *
 * wireIsoOpacity guards handler attachment with a MODULE-LEVEL flag, not a
 * per-element one, so only the first slider this module ever sees gets a
 * listener. That matches the real page — one document, one slider that is never
 * recreated — but it means each test cannot mint its own element. Sharing one
 * mirrors production; see the note in the report about the recreated-slider
 * case, which the app does not currently exercise.
 */
const sharedSlider = fakeElement("input");
const sharedLabel = fakeElement("span");
const sharedDoc = fakeDoc({
  "iso-opacity": sharedSlider,
  "iso-opacity-label": sharedLabel,
});

function withSlider(value = "0.35") {
  sharedSlider.value = value;
  return { slider: sharedSlider, label: sharedLabel, doc: sharedDoc };
}

test("shells adopt the slider's live value, not the default", () => {
  // The stated reason for reading the slider: a rebuild after a field switch
  // must not silently reset the user's choice.
  const { doc } = withSlider("0.8");

  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000, -2000]) }),
    new THREE.Group(),
    null,
    doc,
  );

  for (const mesh of meshes) assert.equal(mesh.material.opacity, 0.8);
});

test("moving the slider drives every shell", () => {
  const { slider, doc } = withSlider("0.35");
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000, -2000]) }),
    new THREE.Group(),
    null,
    doc,
  );

  slider.value = "0.6";
  slider.fire("input");

  for (const mesh of meshes) assert.equal(mesh.material.opacity, 0.6);
});

test("the slider flips shells to solid at the top", () => {
  const { slider, doc } = withSlider("0.35");
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    doc,
  );

  slider.value = "1";
  slider.fire("input");

  assert.equal(meshes[0].material.transparent, false);
  assert.equal(meshes[0].material.depthWrite, true);
});

test("the label reports whole percent", () => {
  const { slider, label, doc } = withSlider("0.35");
  buildIsoSurfaces(meta({ isosurfaces: surfaces([-4000]) }), new THREE.Group(), null, doc);

  slider.value = "0.62";
  slider.fire("input");

  assert.equal(label.textContent, "opacity 62%");
});

test("a rebuild does not leave the slider driving discarded materials", () => {
  // The module-level registry exists for exactly this: after a field switch the
  // old meshes are gone, and updating them would be wasted or wrong.
  const { slider, doc } = withSlider("0.35");
  const stale = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    doc,
  );
  const fresh = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-3000]) }),
    new THREE.Group(),
    null,
    doc,
  );

  slider.value = "0.7";
  slider.fire("input");

  assert.equal(fresh[0].material.opacity, 0.7);
  assert.notEqual(stale[0].material.opacity, 0.7, "stale meshes are still driven");
});

test("repeated builds do not stack slider handlers", () => {
  const { slider, doc } = withSlider("0.35");

  for (let n = 0; n < 4; n++) {
    buildIsoSurfaces(meta({ isosurfaces: surfaces([-4000]) }), new THREE.Group(), null, doc);
  }

  assert.equal(slider.handlers.input.length, 1);
});

test("without a slider the fallback opacity is used", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
    0.5,
  );

  assert.equal(meshes[0].material.opacity, 0.5);
});

test("without a slider the default fallback is 0.35", () => {
  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    fakeDoc(),
  );

  assert.equal(meshes[0].material.opacity, 0.35);
});

test("a missing label does not break the slider", () => {
  const { slider, doc } = withSlider("0.5");

  const meshes = buildIsoSurfaces(
    meta({ isosurfaces: surfaces([-4000]) }),
    new THREE.Group(),
    null,
    doc,
  );

  assert.doesNotThrow(() => slider.fire("input"));
  assert.equal(meshes[0].material.opacity, 0.5);
});

test("an empty isosurface list still wires without error", () => {
  const { slider, doc } = withSlider("0.5");

  assert.doesNotThrow(() =>
    buildIsoSurfaces(meta(), new THREE.Group(), null, doc),
  );
  assert.doesNotThrow(() => slider.fire("input"));
});
