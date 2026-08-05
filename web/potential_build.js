// Pure slice-extraction and colormap helpers for the potential volume.
//
// No DOM, no WebGL, no three.js — importable under `node --test`, same as
// scene_build.js.

/**
 * INDEXING CONTRACT: `volume` is a Float32Array in C-order over (i, j, k):
 *
 *     value(i, j, k) = volume[(i * shape[1] + j) * shape[2] + k]
 *
 * Transposing this produces a plausible-looking but wrong image, so the
 * formula lives here and every accessor below goes through it.
 */
function valueAt(volume, shape, i, j, k) {
  return volume[(i * shape[1] + j) * shape[2] + k];
}

const AXES = new Set(["x", "y", "z"]);

/** Length of the volume along `axis`. */
function axisLength(shape, axis) {
  return shape[{ x: 0, y: 1, z: 2 }[axis]];
}

function checkAxisIndex(shape, axis, index) {
  if (!AXES.has(axis)) {
    throw new Error(`unknown axis ${axis}, expected "x", "y" or "z"`);
  }
  const limit = axisLength(shape, axis);
  if (!Number.isInteger(index) || index < 0 || index >= limit) {
    throw new Error(`slice index ${index} out of range for axis ${axis} (0..${limit - 1})`);
  }
}

/**
 * Extract the plane at `index` normal to `axis`.
 *
 * Returned values are row-major over (width, height): for a z slice that is
 * (i, j), for an x slice (j, k), for a y slice (i, k).
 */
export function extractSlice(volume, shape, axis, index) {
  checkAxisIndex(shape, axis, index);
  const [ni, nj, nk] = shape;

  let width;
  let height;
  let read;

  if (axis === "z") {
    width = ni;
    height = nj;
    read = (a, b) => valueAt(volume, shape, a, b, index);
  } else if (axis === "x") {
    width = nj;
    height = nk;
    read = (a, b) => valueAt(volume, shape, index, a, b);
  } else {
    width = ni;
    height = nk;
    read = (a, b) => valueAt(volume, shape, a, index, b);
  }

  const values = new Float32Array(width * height);
  for (let a = 0; a < width; a++) {
    for (let b = 0; b < height; b++) {
      values[a * height + b] = read(a, b);
    }
  }
  return { width, height, values };
}

/**
 * Perceptual ramp: dark blue -> cyan -> yellow as the value rises.
 *
 * Chosen because it is monotonic in lightness, so the eye reads the gradient
 * in the right direction, and it survives greyscale printing. Values outside
 * [vmin, vmax] clamp to the endpoints. Alpha is always 255.
 */
const RAMP = [
  [0.0, [12, 24, 92]], // dark blue
  [0.5, [42, 196, 208]], // cyan
  [1.0, [252, 240, 76]], // yellow
];

function rampColor(t) {
  for (let s = 0; s < RAMP.length - 1; s++) {
    const [t0, c0] = RAMP[s];
    const [t1, c1] = RAMP[s + 1];
    if (t <= t1 || s === RAMP.length - 2) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * Ramp colour at normalised position `t`, as [r, g, b] bytes.
 *
 * Exported so the colorbar and the isosurface materials draw from the same
 * ramp as the slice image and cannot drift apart.
 */
export function rampRGB(t) {
  return rampColor(Math.min(Math.max(t, 0), 1));
}

/** Normalised ramp position of `value` within [vmin, vmax]. */
export function rampPosition(value, vmin, vmax) {
  if (vmax === vmin) return 0;
  return Math.min(Math.max((value - vmin) / (vmax - vmin), 0), 1);
}

/** Map `values` through the ramp into RGBA bytes. */
export function valuesToRGBA(values, vmin, vmax) {
  const rgba = new Uint8Array(values.length * 4);
  const span = vmax - vmin;

  for (let n = 0; n < values.length; n++) {
    const raw = span === 0 ? 0 : (values[n] - vmin) / span;
    const t = Math.min(Math.max(raw, 0), 1); // clamp outside [vmin, vmax]
    const [r, g, b] = rampColor(t);
    rgba[n * 4] = r;
    rgba[n * 4 + 1] = g;
    rgba[n * 4 + 2] = b;
    rgba[n * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Per-axis stride, read in ONE place so no caller can miss an axis.
 *
 * Payloads carry a 3-tuple `stride`; older ones carry only the scalar
 * `zstride`, which covered z alone. The fallback keeps those working.
 */
export function metaStride(meta) {
  return meta.stride ?? [1, 1, meta.zstride ?? 1];
}

/**
 * Millimetre position of `index` along `axis`.
 *
 * Every axis carries its own stride: the volume holds every stride[k]-th
 * sample, so an index step is stride[k] * spacing[k] millimetres. Applying the
 * stride to z alone put x and y at half their true position whenever the export
 * used a transverse stride, as the weighting field does.
 */
function axisMm(axis, index, meta) {
  const [sx, sy, sz] = meta.spacing;
  const [tx, ty, tz] = metaStride(meta);
  const origin = meta.origin ?? [0, 0, 0];
  if (axis === "x") return origin[0] + index * tx * sx;
  if (axis === "y") return origin[1] + index * ty * sy;
  return origin[2] + index * tz * sz;
}

/**
 * Size, centre and rotation of the quad that displays this slice.
 *
 * Rotation is Euler XYZ in radians, applied to a plane that faces +z at rest.
 */
export function slicePlaneParams(axis, index, meta) {
  checkAxisIndex(meta.shape, axis, index);

  const [ni, nj, nk] = meta.shape;
  const [sx, sy, sz] = meta.spacing;
  const [tx, ty, tz] = metaStride(meta);
  const origin = meta.origin ?? [0, 0, 0];

  // Node (i,j,k) is the lower corner of its cell; spans are n*spacing to match
  // boundary.py and Grid.extent_mm. Each axis also carries its own stride, so a
  // strided volume still covers the full domain rather than a fraction of it.
  const spanX = ni * tx * sx;
  const spanY = nj * ty * sy;
  const spanZ = nk * tz * sz;

  const midX = origin[0] + spanX / 2;
  const midY = origin[1] + spanY / 2;
  const midZ = origin[2] + spanZ / 2;
  const at = axisMm(axis, index, meta);

  if (axis === "z") {
    return { width: spanX, height: spanY, center: [midX, midY, at], rotation: [0, 0, 0] };
  }
  if (axis === "x") {
    // extractSlice gives (j, k) as (width, height), so the plane must be
    // spanY across by spanZ tall. This Euler triple maps texture U to world +y
    // and texture V to world +z, with the normal along +x — verified against
    // the actual rotation matrix, since [0, PI/2, 0] instead sends U to -z.
    return {
      width: spanY,
      height: spanZ,
      center: [at, midY, midZ],
      rotation: [Math.PI / 2, Math.PI / 2, 0],
    };
  }
  // Face +y: rotate the +z-facing plane about x.
  return {
    width: spanX,
    height: spanZ,
    center: [midX, at, midZ],
    rotation: [Math.PI / 2, 0, 0],
  };
}

/** Human-readable slice position, e.g. ``z = 13.10 mm (index 131)``. */
export function sliceLabel(axis, index, meta) {
  checkAxisIndex(meta.shape, axis, index);
  return `${axis} = ${axisMm(axis, index, meta).toFixed(2)} mm (index ${index})`;
}
