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

  const pickables = [];

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
