// Tests for the Image / Contours / Both slice display modes.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SLICE_MODES, wireSliceModes } from "../../web/potential_view.js";

function fakeButton(pressed = false) {
  const attrs = { "aria-pressed": String(pressed) };
  const classes = new Set(pressed ? ["layer", "active"] : ["layer"]);
  return {
    handlers: {},
    attrs,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    getAttribute: (name) => attrs[name],
    setAttribute(name, value) { attrs[name] = value; },
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); },
    click() { for (const fn of this.handlers.click ?? []) fn(); },
  };
}

/** Buttons with `initial` pressed, plus stand-ins for the two views. */
function rig({ initial = "both", slice = true, contour = true } = {}) {
  const buttons = Object.fromEntries(
    SLICE_MODES.map((mode) => [mode, fakeButton(mode === initial)]),
  );
  const doc = { getElementById: (id) => buttons[id.replace("mode-", "")] ?? null };

  const sliceView = slice ? { mesh: { visible: true } } : null;
  const contourView = contour ? { group: { visible: true } } : null;
  const modes = wireSliceModes(sliceView, contourView, doc);

  return { buttons, sliceView, contourView, modes };
}

const shown = ({ sliceView, contourView }) => [
  sliceView.mesh.visible,
  contourView.group.visible,
];

// --- the three modes --------------------------------------------------------

test("the mode list is exactly image, contours, both", () => {
  assert.deepEqual(SLICE_MODES, ["image", "contours", "both"]);
});

test("Both shows the plane and the contours", () => {
  const r = rig({ initial: "both" });

  assert.deepEqual(shown(r), [true, true]);
});

test("Image shows the plane only", () => {
  const r = rig();

  r.buttons.image.click();

  assert.deepEqual(shown(r), [true, false]);
});

test("Contours HIDES the plane outright rather than fading it", () => {
  // The README is explicit: nothing may bleed through from behind.
  const r = rig();

  r.buttons.contours.click();

  assert.deepEqual(shown(r), [false, true]);
});

test("every mode is reachable from every other", () => {
  const r = rig();

  for (const from of SLICE_MODES) {
    for (const to of SLICE_MODES) {
      r.buttons[from].click();
      r.buttons[to].click();
      assert.equal(r.modes.getMode(), to, `${from} -> ${to}`);
    }
  }
});

test("no mode hides both layers at once", () => {
  const r = rig();

  for (const mode of SLICE_MODES) {
    r.buttons[mode].click();
    const [plane, contours] = shown(r);
    assert.ok(plane || contours, `${mode} left the panel blank`);
  }
});

// --- pressed state ----------------------------------------------------------

test("the default mode is Both", () => {
  assert.equal(rig().modes.getMode(), "both");
});

test("the initial mode is read from the pressed button", () => {
  assert.equal(rig({ initial: "contours" }).modes.getMode(), "contours");
});

test("with no button pressed it falls back to Both", () => {
  const buttons = Object.fromEntries(SLICE_MODES.map((m) => [m, fakeButton(false)]));
  const doc = { getElementById: (id) => buttons[id.replace("mode-", "")] ?? null };

  const modes = wireSliceModes({ mesh: {} }, { group: {} }, doc);

  assert.equal(modes.getMode(), "both");
});

test("exactly one button is pressed at a time", () => {
  const r = rig();

  for (const mode of SLICE_MODES) {
    r.buttons[mode].click();
    const on = SLICE_MODES.filter(
      (m) => r.buttons[m].getAttribute("aria-pressed") === "true",
    );
    assert.deepEqual(on, [mode]);
  }
});

test("the pressed button is also the active one", () => {
  // aria-pressed and the visual .active class must not diverge.
  const r = rig();

  r.buttons.image.click();

  for (const mode of SLICE_MODES) {
    const pressed = r.buttons[mode].getAttribute("aria-pressed") === "true";
    assert.equal(r.buttons[mode].classList.contains("active"), pressed, mode);
  }
});

test("the initial state is applied to the buttons, not just recorded", () => {
  const r = rig({ initial: "image" });

  assert.equal(r.buttons.image.getAttribute("aria-pressed"), "true");
  assert.equal(r.buttons.both.getAttribute("aria-pressed"), "false");
});

test("the initial state is applied to the views", () => {
  const r = rig({ initial: "contours" });

  assert.deepEqual(shown(r), [false, true]);
});

// --- idempotence and repeat clicks ------------------------------------------

test("clicking the current mode again changes nothing", () => {
  const r = rig();
  r.buttons.image.click();
  const before = shown(r);

  r.buttons.image.click();

  assert.deepEqual(shown(r), before);
  assert.equal(r.modes.getMode(), "image");
});

test("apply is idempotent", () => {
  const r = rig();
  r.buttons.contours.click();
  const before = shown(r);

  r.modes.apply();
  r.modes.apply();

  assert.deepEqual(shown(r), before);
});

test("returning to Both restores both layers", () => {
  const r = rig();

  r.buttons.contours.click();
  r.buttons.image.click();
  r.buttons.both.click();

  assert.deepEqual(shown(r), [true, true]);
});

// --- what the mode switch must NOT touch ------------------------------------

test("switching modes does not disturb anything but visibility", () => {
  // The README promises the camera is not moved and the contour selection is
  // not reset. Both live outside this function; the guarantee here is that it
  // touches only mesh.visible and group.visible.
  const sliceView = { mesh: { visible: true, position: { z: 1.5 } }, extra: "kept" };
  const contourView = { group: { visible: true, children: [1, 2, 3] }, levels: [0.5] };
  const buttons = Object.fromEntries(
    SLICE_MODES.map((m) => [m, fakeButton(m === "both")]),
  );
  const doc = { getElementById: (id) => buttons[id.replace("mode-", "")] ?? null };

  wireSliceModes(sliceView, contourView, doc);
  buttons.contours.click();

  assert.equal(sliceView.mesh.position.z, 1.5);
  assert.equal(sliceView.extra, "kept");
  assert.deepEqual(contourView.group.children, [1, 2, 3]);
  assert.deepEqual(contourView.levels, [0.5]);
});

// --- missing pieces ---------------------------------------------------------

test("a missing slice view does not break the modes", () => {
  const r = rig({ slice: false });

  assert.doesNotThrow(() => r.buttons.contours.click());
  assert.equal(r.contourView.group.visible, true);
});

test("a missing contour view does not break the modes", () => {
  const r = rig({ contour: false });

  assert.doesNotThrow(() => r.buttons.image.click());
  assert.equal(r.sliceView.mesh.visible, true);
});

test("missing buttons do not break wiring", () => {
  // The potential panel is absent until a payload loads.
  const doc = { getElementById: () => null };

  assert.doesNotThrow(() => wireSliceModes({ mesh: {} }, { group: {} }, doc));
});

test("with no buttons the default mode still applies to the views", () => {
  const sliceView = { mesh: { visible: false } };
  const contourView = { group: { visible: false } };

  wireSliceModes(sliceView, contourView, { getElementById: () => null });

  assert.equal(sliceView.mesh.visible, true);
  assert.equal(contourView.group.visible, true);
});

test("a partially present button set still works", () => {
  const image = fakeButton(false);
  const doc = { getElementById: (id) => (id === "mode-image" ? image : null) };
  const sliceView = { mesh: { visible: true } };
  const contourView = { group: { visible: true } };

  wireSliceModes(sliceView, contourView, doc);
  image.click();

  assert.equal(sliceView.mesh.visible, true);
  assert.equal(contourView.group.visible, false);
});
