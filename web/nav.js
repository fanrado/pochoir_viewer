// Navigation aids for the orbit pivot.
//
// OrbitControls rotates about an invisible controls.target that right-drag pan
// moves, which is how the center of rotation gets lost. These helpers draw it,
// move it, and report it.

import * as THREE from "three";

/** Apparent pivot diameter, in pixels, held constant at every zoom level. */
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

  const heightPx = controls.domElement?.clientHeight || window.innerHeight;
  const d = camera.position.distanceTo(controls.target);
  const s =
    (d * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
    heightPx *
    PIVOT_PX;
  pivot.scale.setScalar(s);
}
