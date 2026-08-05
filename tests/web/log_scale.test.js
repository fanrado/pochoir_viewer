// Tests for logarithmic colour scaling of the slice image.
//
// The weighting potential spans ~39.5 orders of magnitude, so a linear ramp
// renders everything past the pad region as one flat colour. Log scaling makes
// the far field legible; the hazards are log10(0) = -Infinity and the drift
// potential's negative values, both of which must never reach the ramp.
import assert from "node:assert/strict";
import { test } from "node:test";

import { scalePosition, valuesToRGBA } from "../../web/potential_build.js";

const LOG = { scale: "log", decades: 8 };
const rgbAt = (rgba, n) => [rgba[n * 4], rgba[n * 4 + 1], rgba[n * 4 + 2]];
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/** The ramp endpoints, from potential_build's RAMP. */
const DARK = [12, 24, 92];
const YELLOW = [252, 240, 76];

// --- linear is unchanged ----------------------------------------------------

test("the default is linear", () => {
  assert.equal(scalePosition(0.5, 0, 1), 0.5);
});

test("linear scaling is byte-identical to the unscaled call", () => {
  // The commit promises unchanged behaviour for linear; a regression here would
  // silently recolour every drift slice.
  const values = new Float32Array([-8000, -4000, -1000, 0]);

  const implicit = valuesToRGBA(values, -8000, 0);
  const explicit = valuesToRGBA(values, -8000, 0, { scale: "linear" });

  assert.deepEqual([...implicit], [...explicit]);
});

test("linear still clamps outside the range", () => {
  assert.equal(scalePosition(-99, 0, 1, { scale: "linear" }), 0);
  assert.equal(scalePosition(99, 0, 1, { scale: "linear" }), 1);
});

test("a zero linear span does not divide by zero", () => {
  assert.equal(scalePosition(5, 5, 5, { scale: "linear" }), 0);
});

// --- log scaling: the arithmetic --------------------------------------------

test("vmax maps to the top of the ramp", () => {
  assert.ok(close(scalePosition(1, 0, 1, LOG), 1));
});

test("each decade below the max is an equal step", () => {
  // 8 decades across the ramp: one decade is exactly 1/8.
  for (const [value, expected] of [[1, 1], [0.1, 7 / 8], [0.01, 6 / 8], [1e-4, 4 / 8]]) {
    assert.ok(close(scalePosition(value, 0, 1, LOG), expected, 1e-9), `${value}`);
  }
});

test("the decade count is configurable", () => {
  assert.ok(close(scalePosition(0.1, 0, 1, { scale: "log", decades: 4 }), 0.75));
  assert.ok(close(scalePosition(0.1, 0, 1, { scale: "log", decades: 2 }), 0.5));
});

test("the floor is vmax scaled down by the decade count", () => {
  // Exactly at the floor pins to the ramp start.
  assert.equal(scalePosition(1e-8, 0, 1, LOG), 0);
});

test("anything below the floor also pins to the start", () => {
  for (const tiny of [1e-9, 1e-20, 3.4e-40, Number.MIN_VALUE]) {
    assert.equal(scalePosition(tiny, 0, 1, LOG), 0, `${tiny}`);
  }
});

test("log positions rise monotonically", () => {
  const values = [1e-8, 1e-6, 1e-4, 1e-2, 0.1, 0.5, 1];

  let previous = -1;
  for (const value of values) {
    const t = scalePosition(value, 0, 1, LOG);
    assert.ok(t >= previous, `${value} fell to ${t}`);
    previous = t;
  }
});

test("log spreads the far field that linear collapses", () => {
  // The stated motivation: on a 0..1 field, values well below the pad all read
  // as the same colour under a linear ramp.
  const faint = [1e-3, 1e-5, 1e-7];

  const linear = faint.map((v) => scalePosition(v, 0, 1, { scale: "linear" }));
  const log = faint.map((v) => scalePosition(v, 0, 1, LOG));

  assert.ok(Math.max(...linear) - Math.min(...linear) < 1e-2, "linear already spread");
  assert.ok(Math.max(...log) - Math.min(...log) > 0.4, "log did not spread the tail");
});

test("values above vmax clamp to the top", () => {
  assert.equal(scalePosition(10, 0, 1, LOG), 1);
});

test("the scale works for a vmax other than one", () => {
  // Positions are relative to vmax, not to an absolute magnitude.
  assert.ok(close(scalePosition(1000, 0, 1000, LOG), 1));
  assert.ok(close(scalePosition(100, 0, 1000, LOG), 7 / 8));
});

// --- the zero and negative hazards ------------------------------------------

test("an exact zero pins to the ramp start rather than reaching log10", () => {
  // log10(0) is -Infinity; the volume holds exact zeros past z = 1599.
  assert.equal(scalePosition(0, 0, 1, LOG), 0);
});

test("no log position is ever NaN or infinite", () => {
  for (const value of [0, 1e-40, 1e-8, 0.5, 1, 10, -0]) {
    const t = scalePosition(value, 0, 1, LOG);
    assert.ok(Number.isFinite(t), `${value} gave ${t}`);
    assert.ok(t >= 0 && t <= 1, `${value} gave ${t}`);
  }
});

test("negative vmin is rejected outright", () => {
  // The drift potential runs -9500..0 V; log10 of a negative is undefined, so
  // failing loudly beats painting NaN colours.
  assert.throws(() => scalePosition(-1, -9500, 0, LOG), /non-negative/);
});

test("the negative-data message names the linear alternative", () => {
  assert.throws(() => scalePosition(0, -9500, 0, LOG), /linear scale for signed fields/);
});

test("a non-positive vmax is rejected", () => {
  assert.throws(() => scalePosition(0, 0, 0, LOG), /positive vmax/);
  assert.throws(() => scalePosition(0, 0, -1, LOG), /positive vmax/);
});

test("an unknown scale name is rejected", () => {
  assert.throws(() => scalePosition(0.5, 0, 1, { scale: "sqrt" }), /unknown scale/);
});

test("a non-positive decade count is rejected", () => {
  for (const bad of [0, -3]) {
    assert.throws(() => scalePosition(0.5, 0, 1, { scale: "log", decades: bad }),
      /positive finite/);
  }
});

test("a non-finite decade count is rejected", () => {
  for (const bad of [NaN, Infinity]) {
    assert.throws(() => scalePosition(0.5, 0, 1, { scale: "log", decades: bad }),
      /positive finite/);
  }
});

test("validation happens before any value is mapped", () => {
  // A bad option must fail on the first call, not paint a slice and then throw.
  assert.throws(() => valuesToRGBA(new Float32Array([1, 2]), -1, 1, LOG), /non-negative/);
});

// --- valuesToRGBA under log scaling -----------------------------------------

test("log scaling reaches both ramp endpoints", () => {
  const rgba = valuesToRGBA(new Float32Array([0, 1]), 0, 1, LOG);

  assert.deepEqual(rgbAt(rgba, 0), DARK);
  assert.deepEqual(rgbAt(rgba, 1), YELLOW);
});

test("log and linear colour the same data differently", () => {
  const values = new Float32Array([1e-6, 1e-3, 0.1]);

  const linear = valuesToRGBA(values, 0, 1, { scale: "linear" });
  const log = valuesToRGBA(values, 0, 1, LOG);

  assert.notDeepEqual([...linear], [...log]);
});

test("under linear the faint tail is one flat colour", () => {
  // The problem log scaling exists to solve, pinned so the motivation is real.
  const rgba = valuesToRGBA(new Float32Array([1e-6, 1e-5, 1e-4]), 0, 1, { scale: "linear" });

  assert.deepEqual(rgbAt(rgba, 0), rgbAt(rgba, 1));
  assert.deepEqual(rgbAt(rgba, 1), rgbAt(rgba, 2));
});

test("under log the same tail is three distinct colours", () => {
  const rgba = valuesToRGBA(new Float32Array([1e-6, 1e-5, 1e-4]), 0, 1, LOG);

  assert.notDeepEqual(rgbAt(rgba, 0), rgbAt(rgba, 1));
  assert.notDeepEqual(rgbAt(rgba, 1), rgbAt(rgba, 2));
});

test("alpha stays opaque under log scaling", () => {
  const rgba = valuesToRGBA(new Float32Array([0, 1e-9, 0.5, 1]), 0, 1, LOG);

  for (let n = 0; n < 4; n++) assert.equal(rgba[n * 4 + 3], 255);
});

test("every log byte is a valid channel value", () => {
  const values = new Float32Array([0, 1e-40, 1e-8, 1e-4, 0.5, 1, 5]);

  for (const byte of valuesToRGBA(values, 0, 1, LOG)) {
    assert.ok(Number.isInteger(byte) && byte >= 0 && byte <= 255);
  }
});

test("an empty slice is empty under log scaling too", () => {
  assert.equal(valuesToRGBA(new Float32Array(0), 0, 1, LOG).length, 0);
});

test("colour depends on value alone under log scaling", () => {
  const rgba = valuesToRGBA(new Float32Array([1e-4, 1, 1e-4]), 0, 1, LOG);

  assert.deepEqual(rgbAt(rgba, 0), rgbAt(rgba, 2));
});

// --- the colorbar shares the arithmetic -------------------------------------

test("scalePosition is the same function the image uses", () => {
  // Exported so tick placement cannot drift from the painted image.
  const values = new Float32Array([1e-6, 1e-3, 0.1, 1]);
  const rgba = valuesToRGBA(values, 0, 1, LOG);

  for (let n = 0; n < values.length; n++) {
    const t = scalePosition(values[n], 0, 1, LOG);
    const expected = valuesToRGBA(new Float32Array([values[n]]), 0, 1, LOG);
    assert.deepEqual(rgbAt(rgba, n), rgbAt(expected, 0), `t=${t}`);
  }
});

test("a real weighting range spreads across the ramp", () => {
  // 1.0 at the pad down to the 2.5e-3 documented at z = 150.
  const positions = [1.0, 0.115, 2.5e-3].map((v) => scalePosition(v, 0, 1, LOG));

  assert.ok(close(positions[0], 1));
  for (let n = 1; n < positions.length; n++) {
    assert.ok(positions[n] < positions[n - 1], "not descending");
    assert.ok(positions[n] > 0, "collapsed onto the floor");
  }
});
