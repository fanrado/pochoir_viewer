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
