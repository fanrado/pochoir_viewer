// Marching squares over a 2-D slice.
//
// Pure and DOM-free, importable under `node --test` like scene_build.js and
// potential_build.js.

/**
 * INDEXING CONTRACT, identical to extractSlice: `values` is row-major with
 * `height` elements per row, i.e.
 *
 *     value(a, b) = values[a * height + b]
 *
 * for (a, b) over (width, height). Transposing this yields plausible but wrong
 * contours — see the Phase 9 x-axis bug.
 */
function valueAt(values, height, a, b) {
  return values[a * height + b];
}

/** Where `level` crosses between two corner values, as a 0..1 fraction. */
function crossing(va, vb, level) {
  const span = vb - va;
  // Guard the degenerate case: a flat edge has no unique crossing point.
  return span === 0 ? 0.5 : (level - va) / span;
}

/**
 * Contour `level` across a `width` x `height` grid of `values`.
 *
 * Returns a flat Float32Array of segment endpoints [x0,y0,x1,y1, ...] in
 * normalised UV over [0,1], so the caller can map them onto a slice plane
 * without knowing its size in mm. Edge crossings use linear interpolation
 * rather than midpoint stepping, so the contours are smooth.
 */
export function contourSegments(values, width, height, level) {
  const out = [];

  // Normalise a cell-local position into UV. Cell (a, b) spans one sample step,
  // and there are (width - 1) steps across, (height - 1) up.
  const spanA = width > 1 ? width - 1 : 1;
  const spanB = height > 1 ? height - 1 : 1;
  const push = (a0, b0, a1, b1) => {
    out.push(a0 / spanA, b0 / spanB, a1 / spanA, b1 / spanB);
  };

  for (let a = 0; a < width - 1; a++) {
    for (let b = 0; b < height - 1; b++) {
      // Corners, counter-clockwise from the cell's lower-left.
      const v00 = valueAt(values, height, a, b);
      const v10 = valueAt(values, height, a + 1, b);
      const v11 = valueAt(values, height, a + 1, b + 1);
      const v01 = valueAt(values, height, a, b + 1);

      // Bit per corner: set when the corner is at or above the level.
      let code = 0;
      if (v00 >= level) code |= 1;
      if (v10 >= level) code |= 2;
      if (v11 >= level) code |= 4;
      if (v01 >= level) code |= 8;
      if (code === 0 || code === 15) continue; // wholly below or above

      // Crossing points on each edge, in cell-local coordinates.
      const bottom = [a + crossing(v00, v10, level), b];
      const right = [a + 1, b + crossing(v10, v11, level)];
      const top = [a + crossing(v01, v11, level), b + 1];
      const left = [a, b + crossing(v00, v01, level)];

      switch (code) {
        case 1:
        case 14:
          push(...left, ...bottom);
          break;
        case 2:
        case 13:
          push(...bottom, ...right);
          break;
        case 3:
        case 12:
          push(...left, ...right);
          break;
        case 4:
        case 11:
          push(...right, ...top);
          break;
        case 6:
        case 9:
          push(...bottom, ...top);
          break;
        case 7:
        case 8:
          push(...left, ...top);
          break;
        case 5:
        case 10: {
          // SADDLE. Cases 5 and 10 are ambiguous: the two crossings can be
          // joined either way. Resolved here by the CELL-CENTRE AVERAGE of the
          // four corners — if the centre is on the same side as the corner
          // pair, the contour separates the opposite pair, and vice versa.
          // This is the one place marching-squares implementations legitimately
          // differ, so the choice is recorded rather than left implicit.
          const centre = (v00 + v10 + v11 + v01) / 4;
          const centreAbove = centre >= level;
          if (code === 5) {
            // Corners 00 and 11 are above.
            if (centreAbove) {
              push(...left, ...top);
              push(...bottom, ...right);
            } else {
              push(...left, ...bottom);
              push(...right, ...top);
            }
          } else {
            // Corners 10 and 01 are above.
            if (centreAbove) {
              push(...left, ...bottom);
              push(...right, ...top);
            } else {
              push(...left, ...top);
              push(...bottom, ...right);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return new Float32Array(out);
}

/** Contour a slice from extractSlice at each of `levels`. */
export function contourAt(slice, levels) {
  return levels.map((level) => ({
    level,
    segments: contourSegments(slice.values, slice.width, slice.height, level),
  }));
}
