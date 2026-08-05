// A self-contained orientation gizmo, rendered as a second pass into the
// top-right corner of the main canvas.
//
// It keeps its own scene and orthographic camera so nothing about the main
// scene — z-compression included — can distort it.

import * as THREE from "three";

const SIZE_PX = 96;
const INSET_PX = 12;

/** Face labels are domain-specific: the reader cares about anode vs cathode. */
const FACES = [
  { dir: [1, 0, 0], label: "+X" },
  { dir: [-1, 0, 0], label: "-X" },
  { dir: [0, 1, 0], label: "+Y" },
  { dir: [0, -1, 0], label: "-Y" },
  { dir: [0, 0, 1], label: "+Z cathode" },
  { dir: [0, 0, -1], label: "-Z anode" },
];

const BASE_COLOR = "#3d4757";

/** Index into FACES (and so into the material array) for an axis direction. */
function faceIndexFor(x, y, z) {
  if (x !== 0) return x > 0 ? 0 : 1;
  if (y !== 0) return y > 0 ? 2 : 3;
  return z > 0 ? 4 : 5;
}

function labelTexture(label) {
  const px = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BASE_COLOR;
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = "#8a97a8";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, px - 4, px - 4);

  ctx.fillStyle = "#f0f4f8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // "+Z cathode" needs to fit the same 128 px face as "+X".
  ctx.font = `${label.length > 3 ? 18 : 34}px system-ui, sans-serif`;
  ctx.fillText(label, px / 2, px / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Build the gizmo. Returns its scene, camera, cube, an (initially empty)
 * pickables array, and the rect/render/resize helpers viewer.js needs.
 */
export function createViewCube(renderer, mainCamera) {
  renderer.autoClear = false; // set once: the gizmo is a second pass

  const scene = new THREE.Scene();

  // BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z — the order of FACES.
  const materials = FACES.map((f) => new THREE.MeshBasicMaterial({ map: labelTexture(f.label) }));
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
  scene.add(cube);

  // Orthographic so the cube reads the same whatever the main camera is doing.
  const camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  // 26 invisible pick helpers: 6 faces, 12 edges, 8 corners. Each carries the
  // unit direction the main camera should move to.
  const pickables = [];
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const rank = Math.abs(x) + Math.abs(y) + Math.abs(z);
        if (rank === 0) continue; // the cube's own center is not pickable

        // Faces get a broad pad; edges and corners smaller ones, so a face
        // click near an edge still reads as the face.
        const span = [0, 0.5, 0.3, 0.24][rank];
        const size = (v) => (v === 0 ? 0.62 : span);

        const helper = new THREE.Mesh(
          new THREE.BoxGeometry(size(x), size(y), size(z)),
          pickMaterial,
        );
        helper.position.set(x * 0.5, y * 0.5, z * 0.5);
        helper.userData.dir = new THREE.Vector3(x, y, z).normalize();
        helper.userData.faceIndex = rank === 1 ? faceIndexFor(x, y, z) : -1;
        cube.add(helper);
        pickables.push(helper);
      }
    }
  }

  let rect = { left: 0, top: 0, width: SIZE_PX, height: SIZE_PX, x: 0, y: 0 };

  function onResize() {
    const canvas = renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // CSS rect (y from the top) for pointer maths...
    rect = {
      left: w - SIZE_PX - INSET_PX,
      top: INSET_PX,
      width: SIZE_PX,
      height: SIZE_PX,
      // ...and the GL viewport origin, which is measured from the BOTTOM.
      x: w - SIZE_PX - INSET_PX,
      y: h - SIZE_PX - INSET_PX,
    };
  }
  onResize();

  const getRect = () => rect;

  function render() {
    // Mirror the main view's orientation.
    cube.quaternion.copy(mainCamera.getWorldQuaternion(new THREE.Quaternion()).invert());

    const canvas = renderer.domElement;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setViewport(rect.x, rect.y, SIZE_PX, SIZE_PX);
    renderer.setScissor(rect.x, rect.y, SIZE_PX, SIZE_PX);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  return { scene, camera, cube, pickables, getRect, render, onResize, materials };
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Distance along `dir` at which `box` exactly fits the camera frustum.
 *
 * The box must already carry sceneRoot's z scale, so a +Z view fits the
 * 4.4 x 4.4 mm pad plane while a +X view fits the tall 4.4 x 16.0 mm slab.
 */
export function fitDistance(box, dir, camera, margin = 1.06) {
  const up = Math.abs(dir.z) > 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const viewUp = new THREE.Vector3().crossVectors(dir, right).normalize();

  const center = box.getCenter(new THREE.Vector3());
  const min = box.min;
  const max = box.max;

  let halfW = 0;
  let halfH = 0;
  let halfD = 0;
  const corner = new THREE.Vector3();
  for (const cx of [min.x, max.x]) {
    for (const cy of [min.y, max.y]) {
      for (const cz of [min.z, max.z]) {
        corner.set(cx, cy, cz).sub(center);
        halfW = Math.max(halfW, Math.abs(corner.dot(right)));
        halfH = Math.max(halfH, Math.abs(corner.dot(viewUp)));
        halfD = Math.max(halfD, Math.abs(corner.dot(dir)));
      }
    }
  }

  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const forHeight = halfH / tan;
  const forWidth = halfW / (tan * camera.aspect);
  return (Math.max(forHeight, forWidth) + halfD) * margin;
}

/**
 * Make the cube clickable: faces, edges and corners jump the main camera to
 * canonical views. controls.target never moves.
 */
export function enableViewCubePicking(gizmo, renderer, mainCamera, controls, getScaledBox) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let highlighted = -1;

  /** Gizmo-viewport NDC — NOT canvas NDC, which is the classic bug here. */
  function toGizmoNdc(event) {
    const rect = gizmo.getRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return ndc;
  }

  function insideRect(event) {
    const rect = gizmo.getRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.left + rect.width &&
      event.clientY >= rect.top &&
      event.clientY <= rect.top + rect.height
    );
  }

  function pick(event) {
    raycaster.setFromCamera(toGizmoNdc(event), gizmo.camera);
    return raycaster.intersectObjects(gizmo.pickables, false)[0]?.object ?? null;
  }

  function setHighlight(faceIndex) {
    if (faceIndex === highlighted) return;
    if (highlighted >= 0) gizmo.materials[highlighted].color.setHex(0xffffff);
    if (faceIndex >= 0) gizmo.materials[faceIndex].color.setHex(0x9fc4ff);
    highlighted = faceIndex;
  }

  /** Glide the main camera to `dir`, leaving the pivot alone. */
  function goTo(dir, ms = 400) {
    const from = mainCamera.position.clone();
    const distance = fitDistance(getScaledBox(), dir, mainCamera);
    const to = controls.target.clone().addScaledVector(dir, distance);
    let started = null;

    function step(now) {
      started ??= now;
      const t = ms > 0 ? Math.min((now - started) / ms, 1) : 1;
      mainCamera.position.lerpVectors(from, to, easeOut(t));
      mainCamera.lookAt(controls.target);
      controls.update();
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!insideRect(event)) return setHighlight(-1);
    setHighlight(pick(event)?.userData.faceIndex ?? -1);
  });

  renderer.domElement.addEventListener("pointerleave", () => setHighlight(-1));

  // A drag on the gizmo orbits the main view; anything under DRAG_PX stays a
  // click, so the canonical views remain reachable.
  const DRAG_PX = 4;
  const RAD_PER_PX = 0.01;
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();

  let drag = null;

  function orbitBy(dx, dy) {
    offset.subVectors(mainCamera.position, controls.target);
    spherical.setFromVector3(offset);
    spherical.theta -= dx * RAD_PER_PX;
    spherical.phi -= dy * RAD_PER_PX;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.01, Math.PI - 0.01);
    mainCamera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    mainCamera.lookAt(controls.target);
    controls.update();
  }

  function endDrag(event) {
    if (!drag) return;
    // Never moved far enough to be a drag, so honour it as a click.
    if (!drag.exceeded && drag.hit) goTo(drag.hit.userData.dir.clone());
    try {
      renderer.domElement.releasePointerCapture?.(drag.id);
    } catch {
      // capture may already be gone; releasing twice is not an error worth surfacing
    }
    controls.enabled = drag.controlsWere;
    drag = null;
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!insideRect(event)) return;
    // Claim the gesture so OrbitControls does not also act on it.
    event.preventDefault();
    event.stopPropagation();
    // OrbitControls listens on this same element and registered first, so
    // stopPropagation cannot reach it — mute it for the duration instead,
    // otherwise a gizmo drag would orbit the camera twice.
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      exceeded: false,
      hit: pick(event),
      controlsWere: controls.enabled,
    };
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.exceeded && Math.hypot(dx, dy) < DRAG_PX) return;

    drag.exceeded = true;
    orbitBy(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });

  renderer.domElement.addEventListener("pointerup", endDrag);
  renderer.domElement.addEventListener("pointercancel", endDrag);
  // Releasing after the pointer has left the window must not strand the drag.
  // globalThis.window, not a bare window: this module is imported under node.
  globalThis.window?.addEventListener("pointerup", endDrag);
  globalThis.window?.addEventListener("blur", endDrag);

  return { goTo, insideRect, isDragging: () => Boolean(drag?.exceeded) };
}
