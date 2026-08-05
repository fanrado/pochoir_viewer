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

const sceneRoot = new THREE.Group();
sceneRoot.name = "sceneRoot";
scene.add(sceneRoot);

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

sceneRoot.add(boundaryGroup);

// All 100 paths live in one buffer: 100 Line objects would be 100 draw calls,
// and one buffer also gives the hover raycast a single target.
const COLOR_FAR = new THREE.Color(0x2222ff); // at z = extent_mm[2]
const COLOR_NEAR = new THREE.Color(0xffff22); // at z = 0
const EXTENT_Z = scene_data.meta.extent_mm[2];

const pathRanges = []; // {start, count} in vertices, indexed by path

let vertexTotal = 0;
for (const path of scene_data.paths) {
  const segments = Math.max(path.points.length / 3 - 1, 0);
  pathRanges.push({ start: vertexTotal, count: segments * 2 });
  vertexTotal += segments * 2;
}

const linePositions = new Float32Array(vertexTotal * 3);
const lineColors = new Float32Array(vertexTotal * 3);
const scratch = new THREE.Color();

scene_data.paths.forEach((path, p) => {
  const pts = path.points;
  let w = pathRanges[p].start * 3;

  for (let i = 0; i + 5 < pts.length; i += 3) {
    // Emit the consecutive pair (i, i+1) as one segment.
    for (const base of [i, i + 3]) {
      linePositions[w] = pts[base];
      linePositions[w + 1] = pts[base + 1];
      linePositions[w + 2] = pts[base + 2];

      scratch.copy(COLOR_NEAR).lerp(COLOR_FAR, pts[base + 2] / EXTENT_Z);
      lineColors[w] = scratch.r;
      lineColors[w + 1] = scratch.g;
      lineColors[w + 2] = scratch.b;
      w += 3;
    }
  }
});

const pathGeometry = new THREE.BufferGeometry();
pathGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
pathGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));

const pathLines = new THREE.LineSegments(
  pathGeometry,
  new THREE.LineBasicMaterial({ vertexColors: true }),
);
pathLines.name = "pathLines";
sceneRoot.add(pathLines);

/** Vertex offset just past path N-1, i.e. the draw count showing N paths. */
function offsetOfPath(n) {
  if (n <= 0) return 0;
  if (n >= pathRanges.length) return vertexTotal;
  return pathRanges[n - 1].start + pathRanges[n - 1].count;
}

const npathsInput = document.getElementById("npaths");
npathsInput.addEventListener("input", () => {
  // Draw-range only: never rebuild or reallocate the geometry here.
  pathGeometry.setDrawRange(0, offsetOfPath(Number(npathsInput.value)));
});
pathGeometry.setDrawRange(0, offsetOfPath(Number(npathsInput.value)));

// The domain is 36:1 (160.1 mm drift vs 4.4 mm transverse) and unviewable at
// true scale, but compressing z misrepresents drift angles — so whatever
// scaling is applied is always stated on screen and undone in one click.
const [EXTENT_X, EXTENT_Y] = scene_data.meta.extent_mm;
const zscaleInput = document.getElementById("zscale");
const scaleNote = document.getElementById("scale-note");

const fmt = (v) => v.toFixed(1);

function currentFactor() {
  return Number(zscaleInput.value);
}

/** The box as displayed, i.e. with z divided by the current factor. */
function displayedExtent() {
  return [EXTENT_X, EXTENT_Y, EXTENT_Z / currentFactor()];
}

function frameView() {
  const extent = displayedExtent();
  const center = new THREE.Vector3(...extent.map((v) => v / 2));
  const radius = 0.5 * Math.hypot(...extent);
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

  // Look in along a diagonal so all three axes are legible.
  const direction = new THREE.Vector3(1, 1, 0.6).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function updateScaleNote() {
  const factor = currentFactor();
  const trueDims = `${fmt(EXTENT_X)} x ${fmt(EXTENT_Y)} x ${fmt(EXTENT_Z)} mm`;
  if (factor === 1) {
    scaleNote.textContent = `z x1 (true scale) - ${trueDims}`;
    return;
  }
  const shown = displayedExtent().map(fmt).join(" x ");
  scaleNote.textContent =
    `z x${factor} - true domain ${trueDims}, shown as ${shown} mm`;
}

function applyScale() {
  sceneRoot.scale.z = 1 / currentFactor();
  updateScaleNote();
}

zscaleInput.addEventListener("input", applyScale);

document.getElementById("reset-scale").addEventListener("click", () => {
  zscaleInput.value = "1";
  applyScale();
  frameView();
});

document.getElementById("reset-view").addEventListener("click", frameView);

applyScale();
frameView();

// Hover a trajectory to identify it, so the bundle is inspectable rather than
// decorative.
const readout = document.getElementById("readout");
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.05;
const pointer = new THREE.Vector2();

/** Path owning a given vertex index, or -1. */
function pathOfVertex(index) {
  for (let p = 0; p < pathRanges.length; p++) {
    const { start, count } = pathRanges[p];
    if (index >= start && index < start + count) return p;
  }
  return -1;
}

const trim = (v) => String(Number(v.toFixed(2)));
const triple = (xyz) => xyz.map(trim).join(", ");

window.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(pathLines, false)[0];
  const id = hit ? pathOfVertex(hit.index) : -1;
  const shown = offsetOfPath(Number(npathsInput.value));

  if (id < 0 || pathRanges[id].start >= shown) {
    readout.textContent = "";
    return;
  }

  const s = scene_data.summaries[id];
  readout.textContent =
    `path ${s.id} - start (${triple(s.start)}) -> end (${triple(s.end)}), ` +
    `dz ${trim(s.z_travel)} mm, ${s.n_steps} steps`;
});

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
