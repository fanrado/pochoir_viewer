// Navigation aids for the orbit pivot.
//
// OrbitControls rotates about an invisible controls.target that right-drag pan
// moves, which is how the center of rotation gets lost. These helpers draw it,
// move it, and report it.

import * as THREE from "three";

/**
 * Apparent pivot RADIUS, in pixels, held constant at every zoom level.
 *
 * The sphere geometry has radius 1, so updatePivot's scale factor is a radius:
 * 6 here draws a 12 px wide dot.
 */
const PIVOT_PX = 6;

/**
 * Add the pivot marker to `scene`.
 *
 * Deliberately parented to the scene and NOT to sceneRoot: the z-compression
 * applied to sceneRoot would otherwise squash the sphere into an ellipsoid.
 */
export function createPivot(scene) {
  const pivot = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false }),
  );
  pivot.name = "pivot";
  pivot.renderOrder = 999; // never hidden inside the translucent boundary planes
  scene.add(pivot);
  return pivot;
}

/**
 * Report the pivot position in TRUE mm.
 *
 * controls.target lives in compressed scene space, so z is divided back out by
 * sceneRoot.scale.z; x and y are unscaled. Without this the cathode would read
 * 16.0 mm at z x10 instead of 160.1 mm.
 */
export function updatePivotReadout(element, controls, sceneRoot) {
  const { x, y, z } = controls.target;
  const trueZ = z / sceneRoot.scale.z;
  element.textContent =
    `pivot (${x.toFixed(2)}, ${y.toFixed(2)}, ${trueZ.toFixed(2)}) mm` +
    ` - double-click geometry to move it`;
}

/** Keys 1..6 map to the axis views in the view cube's face order. */
const AXIS_KEYS = {
  1: [1, 0, 0],
  2: [-1, 0, 0],
  3: [0, 1, 0],
  4: [0, -1, 0],
  5: [0, 0, 1],
  6: [0, 0, -1],
};

/** Tags whose own key handling must win over these shortcuts. */
const TYPING_TAGS = new Set(["INPUT", "BUTTON", "SELECT"]);

/**
 * Bind the viewer's keyboard shortcuts.
 *
 * `handlers.axisView` receives a unit THREE.Vector3; the others take no
 * arguments. `handlers.pivotUnderCursor` receives the last known pointer
 * position, so F acts on whatever the cursor is over.
 *
 * `target` defaults to the window. Outside a browser there is none, so it must
 * be passed explicitly; binding to nothing is a programming error rather than
 * something to silently ignore, since a caller that forgot it would appear to
 * work while no shortcut ever fired.
 */
export function enableKeyboardShortcuts(handlers, target = globalThis.window) {
  if (!target?.addEventListener) {
    throw new TypeError(
      "enableKeyboardShortcuts needs an event target: there is no global " +
        "window here, so pass one explicitly",
    );
  }

  const cursor = { x: 0, y: 0, seen: false };

  target.addEventListener("pointermove", (event) => {
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    cursor.seen = true;
  });

  target.addEventListener("keydown", (event) => {
    // Never hijack a focused slider: arrow keys and Home/End belong to it.
    // globalThis.document, not a bare document: this module is imported under node.
    if (TYPING_TAGS.has(globalThis.document?.activeElement?.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const axis = AXIS_KEYS[event.key];
    if (axis) {
      handlers.axisView?.(new THREE.Vector3(...axis));
      return;
    }

    switch (event.key.toLowerCase()) {
      case "f":
        if (cursor.seen) handlers.pivotUnderCursor?.(cursor.x, cursor.y);
        break;
      case "c":
        handlers.centerOnDomain?.();
        break;
      case "r":
        handlers.resetView?.();
        break;
      default:
        return; // leave every other key alone
    }
  });
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Glide the orbit pivot to `point` without disturbing the view.
 *
 * The camera is translated by the same delta as the target on every frame, so
 * view direction and camera distance are preserved — only the pivot moves.
 */
export function recenterOn(point, camera, controls, ms = 300) {
  const from = controls.target.clone();
  const to = point.clone();
  const cursor = new THREE.Vector3();
  const delta = new THREE.Vector3();
  let started = null;

  function step(now) {
    started ??= now;
    const t = ms > 0 ? Math.min((now - started) / ms, 1) : 1;

    cursor.lerpVectors(from, to, easeOut(t));
    delta.subVectors(cursor, controls.target);
    camera.position.add(delta);
    controls.target.copy(cursor);
    controls.update();

    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/** Park the pivot on controls.target and hold its on-screen size fixed. */
export function updatePivot(pivot, camera, controls) {
  pivot.position.copy(controls.target);

  // globalThis.window, not a bare window: this module is imported under node.
  const heightPx =
    controls.domElement?.clientHeight || globalThis.window?.innerHeight;

  // No viewport to measure against (only reachable outside a browser): hide the
  // marker rather than scaling it by NaN.
  if (!heightPx) {
    pivot.scale.setScalar(0);
    return;
  }
  const d = camera.position.distanceTo(controls.target);
  const s =
    (d * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
    heightPx *
    PIVOT_PX;
  pivot.scale.setScalar(s);
}
