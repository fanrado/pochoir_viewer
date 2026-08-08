import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildBoundaryMesh,
  buildPathBuffers,
  offsetOfPath as offsetOfPathIn,
  pathOfVertex as pathOfVertexIn,
} from "./scene_build.js";
import {
  createPivot,
  recenterOn,
  updatePivot,
  updatePivotReadout,
  enableKeyboardShortcuts,
} from "./nav.js";
import { createViewCube, enableViewCubePicking } from "./viewcube.js";
import {
  createColorbar,
  createContourView,
  createSliceView,
  fetchPotential,
  renderPayloadInfo,
  wireScaleControls,
  wireSliceModes,
  uvToVoxel,
  voxelReading,
  wireSliceControls,
} from "./potential_view.js";
import { fetchCurrent } from "./current_build.js";
import { createCurrentView } from "./current_view.js";
import { createDriftAnim } from "./drift_anim.js";

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

const sceneRoot = new THREE.Group();
sceneRoot.name = "sceneRoot";
scene.add(sceneRoot);

const boundaryGroup = new THREE.Group();
boundaryGroup.name = "boundaryGroup";

const groupsPanel = document.getElementById("groups");

/** Rebuild the boundary meshes and their checkboxes for a scene payload. */
function rebuildBoundary(sceneData) {
  for (const mesh of [...boundaryGroup.children]) {
    mesh.geometry.dispose();
    mesh.material.dispose();
    boundaryGroup.remove(mesh);
  }
  groupsPanel.replaceChildren();

  sceneData.boundary.forEach((group, index) => {
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
}

rebuildBoundary(scene_data);

sceneRoot.add(boundaryGroup);

// Mutable: the weighting domain is 22.0 mm across, the drift one 4.4 mm.
let extentMm = [...scene_data.meta.extent_mm];
const EXTENT_Z = extentMm[2];

const { linePositions, lineColors, pathRanges, vertexTotal } = buildPathBuffers(
  scene_data.paths,
  EXTENT_Z,
);

const pathGeometry = new THREE.BufferGeometry();
pathGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
pathGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));

const pathLines = new THREE.LineSegments(
  pathGeometry,
  new THREE.LineBasicMaterial({ vertexColors: true }),
);
pathLines.name = "pathLines";
sceneRoot.add(pathLines);

const offsetOfPath = (n) => offsetOfPathIn(n, pathRanges, vertexTotal);

const npathsInput = document.getElementById("npaths");
npathsInput.addEventListener("input", () => {
  // Draw-range only: never rebuild or reallocate the geometry here.
  pathGeometry.setDrawRange(0, offsetOfPath(Number(npathsInput.value)));
});
pathGeometry.setDrawRange(0, offsetOfPath(Number(npathsInput.value)));

// The domain is 36:1 (160.1 mm drift vs 4.4 mm transverse) and unviewable at
// true scale, but compressing z misrepresents drift angles — so whatever
// scaling is applied is always stated on screen and undone in one click.
const zscaleInput = document.getElementById("zscale");
const scaleNote = document.getElementById("scale-note");

const fmt = (v) => v.toFixed(1);

function currentFactor() {
  return Number(zscaleInput.value);
}

/** The box as displayed, i.e. with z divided by the current factor. */
function displayedExtent() {
  return [extentMm[0], extentMm[1], extentMm[2] / currentFactor()];
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
  const trueDims = `${fmt(extentMm[0])} x ${fmt(extentMm[1])} x ${fmt(extentMm[2])} mm`;
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

/** Center of the domain as displayed, i.e. in compressed scene space. */
function domainCenter() {
  return new THREE.Vector3(...displayedExtent().map((v) => v / 2));
}

document.getElementById("center-domain").addEventListener("click", () => {
  recenterOn(domainCenter(), camera, controls);
});

applyScale();
frameView();

// Draw the orbit pivot, so the center of rotation is never a mystery.
const pivot = createPivot(scene);
const pivotReadout = document.getElementById("pivot-readout");

// Orientation gizmo. Takes over clearing, so the main pass clears explicitly.
const viewCube = createViewCube(renderer, camera);

// setFromObject picks up sceneRoot's live z scale, so canonical views frame
// the compressed geometry the user is actually looking at.
const cubePick = enableViewCubePicking(viewCube, renderer, camera, controls, () =>
  new THREE.Box3().setFromObject(sceneRoot),
);

// Hover a trajectory to identify it, so the bundle is inspectable rather than
// decorative.
const readout = document.getElementById("readout");
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.05;
const pointer = new THREE.Vector2();

const pathOfVertex = (index) => pathOfVertexIn(index, pathRanges);

const trim = (v) => String(Number(v.toFixed(2)));
const triple = (xyz) => xyz.map(trim).join(", ");

window.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Voltage readout: only when the slice is actually on screen.
  if (sliceView?.mesh.visible) {
    const slice = raycaster.intersectObject(sliceView.mesh, false)[0];
    if (slice?.uv) {
      const axis = sliceControls.getAxis();
      const index = Number(document.getElementById("slice-idx").value);
      const [i, j, k] = uvToVoxel(slice.uv.x, slice.uv.y, axis, index, potentialMeta);
      const { value, mm } = voxelReading(potentialVolume, potentialMeta, i, j, k);
      voltReadout.textContent =
        `(${mm.map((v) => v.toFixed(2)).join(", ")}) mm = ${value.toFixed(1)} V`;
      colorbar.setTick(value);
    } else {
      voltReadout.textContent = "";
      colorbar.setTick(null);
    }
  }

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

/** Move the pivot to the geometry under a screen position, if any. */
function pivotUnderCursor(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(
    [pathLines, ...boundaryGroup.children],
    false,
  );
  if (hits.length > 0) recenterOn(hits[0].point, camera, controls);
}

// The box center is ~75 mm from the anode region worth inspecting, so let the
// user put the pivot on whatever they double-click.
canvas.addEventListener("dblclick", (event) => {
  pivotUnderCursor(event.clientX, event.clientY);
});

// --- optional potential payload ------------------------------------------
//
// The potential export is opt-in, so a missing payload disables its layer
// button rather than breaking the page.
const potentialControls = document.getElementById("potential-controls");
const voltReadout = document.getElementById("volt-readout");
let sliceView = null;
let sliceControls = null;
let contourView = null;
let potentialVolume = null;
let potentialMeta = null;
let colorbar = null;
let sliceModes = null;
let scaleControls = null;

/** Payload URLs per field. Drift keeps the Phase 8 names. */
const FIELD_FILES = {
  drift: { scene: "data/scene.json", potential: "potential.json" },
  weight: { scene: "data/scene_weight.json", potential: "potential_weight.json" },
};

// Each URL is fetched at most once per page load.
const sceneCache = { drift: scene_data };
const potentialCache = {};

async function loadScene(field) {
  if (!sceneCache[field]) {
    const response = await fetch(FIELD_FILES[field].scene);
    if (!response.ok) {
      throw new Error(`${FIELD_FILES[field].scene}: HTTP ${response.status}`);
    }
    sceneCache[field] = await response.json();
  }
  return sceneCache[field];
}

async function loadPotential(field) {
  potentialCache[field] ??= await fetchPotential("data", FIELD_FILES[field].potential);
  return potentialCache[field];
}

/** Tear down the previous field's potential objects before building the next. */
function disposePotential() {
  for (const object of [sliceView?.mesh, contourView?.group].filter(Boolean)) {
    object.parent?.remove(object);
    object.traverse?.((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
  }
  document.getElementById("contour-legend").replaceChildren();
  sliceView = null;
  sliceControls = null;
  contourView = null;
}

/** Build the slice, colorbar and contours for one field. */
function buildPotential(meta, volume) {
  potentialMeta = meta;
  potentialVolume = volume;
  sliceView = createSliceView(meta, volume, sceneRoot);
  contourView = createContourView(meta, volume, sceneRoot);
  sliceControls = wireSliceControls(sliceView, document, (axis, index) =>
    contourView.update(axis, index),
  );
  colorbar = createColorbar(meta);
  // extentMm is already the new field's domain here (selectField refreshes it
  // before loading the potential), so a cropped payload is caught on switch too.
  renderPayloadInfo(meta, extentMm);
  // Honour whatever the layer buttons currently say, then let the display mode
  // decide between image, contours, or both.
  sliceView.mesh.visible = pressed("layer-slice");
  contourView.group.visible = pressed("layer-contours");
  sliceModes = wireSliceModes(sliceView, contourView);

  // Colour scale, decades and contour count. Log is the weighting default and
  // is disabled for the signed drift potential.
  scaleControls = wireScaleControls(meta, {
    onScale: (opts) => {
      sliceView.setScale(opts);
      contourView.setScale(opts);
      colorbar.setScale(opts);
    },
    onLevels: (levels) => contourView.setLevels(levels),
  });
  scaleControls.refresh();
}

function pressed(id) {
  return document.getElementById(id).getAttribute("aria-pressed") === "true";
}

function disable(id, title) {
  const button = document.getElementById(id);
  button.disabled = true;
  button.title = title;
}

let currentField = "drift";

/** The induced-current view, or null while its payload is absent. */
let currentView = null;

/** The drifting-electron dots, or null for a domain without paths. */
let driftAnim = null;

/**
 * Selected cells, keyed "i,j" so the set survives a repaint of the grid.
 *
 * MUST be declared here, with the other module state, and NOT beside the
 * selector functions further down. selectField() runs during module evaluation
 * and reaches wirePathSelector, which reads this set; a const declared below
 * that call is still in the temporal dead zone at that point and throws
 * ReferenceError, so no click listener ever gets attached. The functions
 * around it hoist and hid the problem.
 */
const selectedPaths = new Set();

/**
 * ONE tick counter drives both the dots and the plot cursor.
 *
 * That is the whole point of the feature: two counters could drift apart and
 * show an electron at a position its current trace disagrees with.
 */
let tick = 0;
let playHandle = null;

/**
 * Ticks advanced per animation frame.
 *
 * One per frame at ~60 fps plays the full 3999-tick response in about a
 * minute, which reads as a drift rather than a flicker. Raise it if that turns
 * out to be too slow to watch.
 */
const TICKS_PER_FRAME = 1;

/** Stop the loop and release the frame handle. Safe to call when not playing. */
function pauseCurrent() {
  if (playHandle !== null) {
    cancelAnimationFrame(playHandle);
    playHandle = null;
  }
  const play = document.getElementById("current-play");
  if (play) {
    play.setAttribute("aria-pressed", "false");
    play.textContent = "play";
  }
}

function stepCurrent() {
  const nTicks = currentView?.nTicks ?? 0;
  driftAnim?.setTick(tick);
  currentView?.setCursor(tick);

  // Stop at the end rather than wrapping: the response has a physical end, and
  // looping back to t=0 would imply a periodicity the data does not have.
  if (tick >= nTicks - 1) {
    pauseCurrent();
    return;
  }
  tick += TICKS_PER_FRAME;
  playHandle = requestAnimationFrame(stepCurrent);
}

/**
 * Swap every field-dependent object.
 *
 * The two domains differ — 4.4 x 4.4 x 160.1 mm for drift against
 * 22.0 x 22.0 x 160.1 mm for weight — so the camera is refitted and the scale
 * note recomputed from the new extent; stale framing would leave the geometry
 * off-screen and a stale note would state the wrong size.
 */
async function selectField(field) {
  // A loop left running would keep calling setTick against objects this
  // function is about to dispose.
  pauseCurrent();
  tick = 0;
  if (driftAnim) {
    sceneRoot.remove(driftAnim.points);
    driftAnim.points.geometry.dispose();
    driftAnim.points.material.dispose();
    driftAnim = null;
  }

  const sceneData = await loadScene(field);

  disposePotential();
  rebuildBoundary(sceneData);
  extentMm = [...sceneData.meta.extent_mm];

  // The weighting domain has no drift paths.
  const hasPaths = (sceneData.meta.n_paths ?? 0) > 0;
  const pathsButton = document.getElementById("layer-paths");
  pathsButton.disabled = !hasPaths;
  pathsButton.title = hasPaths ? "" : "no drift paths in the weighting domain";
  pathLines.visible = hasPaths && pressed("layer-paths");

  // Induced current is meaningless without drift paths, so the whole panel is
  // disabled for the weighting domain rather than left showing drift's traces
  // under a weighting scene. Mirrors the layer-paths treatment above.
  const currentPanel = document.getElementById("current-panel");
  if (currentPanel) {
    const why = "no drift paths in the weighting domain";
    currentPanel.title = hasPaths ? "" : why;
    // Dimmed inline rather than via a CSS class so this step stays inside
    // viewer.js; the tooltip is what actually explains the state.
    currentPanel.style.opacity = hasPaths ? "" : "0.5";
    const play = document.getElementById("current-play");
    if (play) {
      play.disabled = !hasPaths;
      play.title = hasPaths ? "" : why;
    }
  }

  if (!hasPaths) {
    // Drop the view outright. Leaving it alive would keep the previous field's
    // curves painted under a weighting scene they have nothing to do with.
    currentView?.setSelection([]);
    currentView = null;
  }

  if (hasPaths) {
    // Same opt-in-absent handling as the potential payload: a missing
    // current.json is a normal state for a dataset that has not been exported
    // with export-current, not an error worth breaking the page over.
    try {
      const data = await fetchCurrent();
      currentView = createCurrentView(data);
      currentView.nTicks = data.meta.shape[2];
      currentView.meta = data.meta;

      driftAnim = createDriftAnim(sceneData.paths, data.meta.shape[2]);
      sceneRoot.add(driftAnim.points);
      wirePathSelector(data.meta);
      applyPathSelection();
    } catch (error) {
      currentView = null;
      console.warn(
        `induced-current panel unavailable (${error.message}); ` +
          "run: python -m pochoir_viewer export-current",
      );
      disable("current-play", "run: python -m pochoir_viewer export-current");
    }
  }

  try {
    const { meta, volume } = await loadPotential(field);
    buildPotential(meta, volume);
  } catch (error) {
    console.warn(
      `potential layers unavailable for ${field} (${error.message}); ` +
        "run: python -m pochoir_viewer export-potential",
    );
    disable("layer-slice", "run: python -m pochoir_viewer export-potential");
  }

  currentField = field;
  applyScale(); // recomputes #scale-note from the new extent
  frameView();
}

// Probe the weighting payload once so its selector can be disabled up front
// rather than failing on first click.
try {
  await loadScene("weight");
} catch (error) {
  console.warn(
    `weighting field unavailable (${error.message}); run: ` +
      "python -m pochoir_viewer export --field weight and export-potential --field weight",
  );
  disable(
    "field-weight",
    "run: python -m pochoir_viewer export --field weight and export-potential --field weight",
  );
}

for (const field of ["drift", "weight"]) {
  document.getElementById(`field-${field}`).addEventListener("change", (event) => {
    if (event.target.checked) selectField(field);
  });
}

await selectField("drift");

// --- layer toggles --------------------------------------------------------

/** Bind a layer button to a visibility setter. Never moves the camera. */
function wireLayer(id, apply) {
  const button = document.getElementById(id);
  button.addEventListener("click", () => {
    if (button.disabled) return;
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("active", on);
    apply(on);
  });
}

wireLayer("layer-paths", (on) => { pathLines.visible = on; });
wireLayer("layer-boundary", (on) => { boundaryGroup.visible = on; });
wireLayer("layer-slice", (on) => {
  if (sliceView) sliceView.mesh.visible = on;
  potentialControls.hidden = !on;
});

enableKeyboardShortcuts({
  axisView: (dir) => cubePick.goTo(dir),
  pivotUnderCursor,
  centerOnDomain: () => recenterOn(domainCenter(), camera, controls),
  resetView: frameView,
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewCube.onResize();
});

/**
 * Path id for grid cell (i, j).
 *
 * The block is (M, M, T) in C order and write_current emits `starts` in that
 * same order, so cell (i, j) is path i*M + j. Deriving it keeps the selector,
 * the dots and the traces reading one indexing rule.
 */
function pathIdFor(i, j, m) {
  return i * m + j;
}

function pathCells() {
  return [...document.querySelectorAll(".path-cell")];
}

/**
 * Push the current selection to both consumers.
 *
 * Returns true on success. A throw out of setSelection is caught and reported
 * rather than propagating: it reaches this code from a click handler, where an
 * escaping error would abort the handler mid-way and leave the button state
 * describing a selection that was never drawn.
 */
function applyPathSelection() {
  const meta = currentView?.meta;
  const m = meta?.shape?.[0] ?? 10;

  const picks = [...selectedPaths].map((key) => {
    const [i, j] = key.split(",").map(Number);
    return { i, j };
  });

  try {
    currentView?.setSelection(picks);
  } catch (error) {
    // Deliberately NOT the 'run export-current' message: the payload loaded
    // fine, and blaming the export is what disguised pochoir_viewer-x1i0 as a
    // missing file.
    console.warn(`path selection ${JSON.stringify(picks)} could not be drawn`, error);
    return false;
  }

  driftAnim?.setSelected(picks.map(({ i, j }) => pathIdFor(i, j, m)));

  // Back to the start on any change: a newly selected electron would otherwise
  // pop into view mid-drift, at a tick it was never animated through.
  pauseCurrent();
  tick = 0;
  driftAnim?.setTick(0);
  currentView?.setCursor(0);
  return true;
}

/**
 * Attach the selector handlers and complete the cell titles.
 *
 * The static markup can only name {i, j}; the start position in mm lives in
 * the payload, so it is appended here once that payload is known.
 */
function wirePathSelector(meta) {
  const m = meta.shape[0];

  // Open on one path rather than an empty panel: four blank canvases give no
  // clue that anything is meant to appear in them.
  if (selectedPaths.size === 0) selectedPaths.add("0,0");
  for (const cell of pathCells()) {
    const i = Number(cell.dataset.i);
    const j = Number(cell.dataset.j);
    const start = meta.starts?.[pathIdFor(i, j, m)];
    if (start) {
      const mm = start.map((v) => v.toFixed(2)).join(", ");
      cell.title = `path (${i}, ${j}) — start ${mm} mm`;
    }
    cell.setAttribute("aria-pressed", String(selectedPaths.has(`${i},${j}`)));

    cell.addEventListener("click", () => {
      // Apply FIRST, then reflect the result in the button. Flipping
      // aria-pressed up front leaves the cell looking selected even when the
      // selection could not be drawn.
      const key = `${i},${j}`;
      const wasSelected = selectedPaths.has(key);
      if (wasSelected) selectedPaths.delete(key);
      else selectedPaths.add(key);

      if (applyPathSelection()) {
        cell.setAttribute("aria-pressed", String(!wasSelected));
      } else {
        // Roll the model back so the set and the button agree again.
        if (wasSelected) selectedPaths.add(key);
        else selectedPaths.delete(key);
        cell.setAttribute("aria-pressed", String(wasSelected));
      }
    });
  }

  document.getElementById("path-clear")?.addEventListener("click", () => {
    const previous = new Set(selectedPaths);
    selectedPaths.clear();
    if (applyPathSelection()) {
      for (const cell of pathCells()) cell.setAttribute("aria-pressed", "false");
    } else {
      selectedPaths.clear();
      for (const key of previous) selectedPaths.add(key);
    }
  });
}

const playButton = document.getElementById("current-play");
playButton?.addEventListener("click", () => {
  if (playHandle !== null) {
    pauseCurrent();
    return;
  }
  // Restart from the beginning once the response has played out, so a second
  // click replays rather than doing nothing at the final tick.
  if (tick >= (currentView?.nTicks ?? 0) - 1) tick = 0;
  playButton.setAttribute("aria-pressed", "true");
  playButton.textContent = "pause";
  playHandle = requestAnimationFrame(stepCurrent);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updatePivot(pivot, camera, controls);
  updatePivotReadout(pivotReadout, controls, sceneRoot);
  renderer.clear(); // autoClear is off for the gizmo pass
  renderer.render(scene, camera);
  viewCube.render();
}
animate();
