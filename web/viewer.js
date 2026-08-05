import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const scene_data = await (await fetch("data/scene.json")).json();
console.log(scene_data.meta);

const canvas = document.getElementById("view");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2029);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
);
camera.position.set(20, 20, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(1, 1, 1);
scene.add(sun);

// Display labels, not physics claims — they come from the exporter's z ordering.
const GROUP_COLORS = { anode: 0xff8844, grid: 0x44ccff, cathode: 0x88ff88 };
const FALLBACK_COLORS = [0xcc99ff, 0xffcc44, 0x99ffcc, 0xff99cc];

function buildBoundaryMesh(group, index) {
  // One mesh per group: every quad contributes two +z-facing triangles.
  const positions = new Float32Array(group.quads.length * 18);
  const normals = new Float32Array(group.quads.length * 18);
  const z = (group.z_min_mm + group.z_max_mm) / 2;

  group.quads.forEach(([x0, y0, x1, y1], q) => {
    const corners = [
      x0, y0, z, x1, y0, z, x1, y1, z,
      x0, y0, z, x1, y1, z, x0, y1, z,
    ];
    positions.set(corners, q * 18);
    for (let v = 0; v < 6; v++) normals.set([0, 0, 1], q * 18 + v * 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const material = new THREE.MeshLambertMaterial({
    color: GROUP_COLORS[group.name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = group.name;
  return mesh;
}

const boundaryGroup = new THREE.Group();
boundaryGroup.name = "boundaryGroup";

const groupsPanel = document.getElementById("groups");

scene_data.boundary.forEach((group, index) => {
  const mesh = buildBoundaryMesh(group, index);
  boundaryGroup.add(mesh);

  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  box.addEventListener("change", () => { mesh.visible = box.checked; });
  label.append(box, ` ${group.name} (z ${group.z_min_mm}–${group.z_max_mm} mm)`);
  groupsPanel.append(label);
});

scene.add(boundaryGroup);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
