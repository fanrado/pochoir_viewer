// Static checks on viewer.js's induced-current wiring (cdb2b76).
//
// viewer.js cannot be imported under node -- top-level-await fetch, WebGL at
// module scope -- so this follows viewer_static.test.js and reads the source.
// These cannot tell you the wiring WORKS; they tell you the ids and modules it
// reaches for exist, and that the field-switch branch does what its own
// comment says it does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const source = readFileSync(join(WEB_DIR, "viewer.js"), "utf8");
const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");

/** The body of `async function selectField`, where all of this lives. */
function selectField() {
  const start = source.indexOf("async function selectField");
  assert.ok(start > 0, "viewer.js no longer defines selectField");
  // Up to the next top-level declaration.
  const rest = source.slice(start);
  const end = rest.search(/\n(?:async )?function |\nconst |\nlet /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The branch guarded by `if (currentPanel)`. */
function panelBranch() {
  const body = selectField();
  const start = body.indexOf("if (currentPanel)");
  assert.ok(start > 0, "the current-panel branch is gone");
  return body.slice(start, body.indexOf("if (hasPaths)", start));
}

// --- what it imports ---------------------------------------------------------

test("the current modules are imported", () => {
  assert.match(source, /import \{ fetchCurrent \} from "\.\/current_build\.js"/);
  assert.match(source, /import \{ createCurrentView \} from "\.\/current_view\.js"/);
});

test("every id the wiring reaches for exists in the markup", () => {
  // A rename on either side is the breakage this class of test is for.
  for (const id of ["current-panel", "current-play"]) {
    assert.ok(
      source.includes(`"${id}"`),
      `viewer.js no longer references ${id}`,
    );
    assert.ok(html.includes(`id="${id}"`), `index.html has no ${id}`);
  }
});

// --- the missing payload is a normal state -----------------------------------

test("a missing current.json does not break the page", () => {
  // Same opt-in treatment the potential payload gets: not every dataset has
  // been exported with export-current.
  assert.match(selectField(), /try \{[\s\S]*fetchCurrent\(\)[\s\S]*\} catch/);
});

test("the failure path names the command that fixes it", () => {
  const body = selectField();

  assert.match(body, /export-current/);
  assert.match(body, /disable\("current-play"/);
});

test("a failed load clears the view rather than leaving the last one", () => {
  assert.match(selectField(), /catch[\s\S]{0,120}currentView = null/);
});

// --- the weighting domain ----------------------------------------------------

test("the panel is disabled for a field with no drift paths", () => {
  const branch = panelBranch();

  assert.match(branch, /hasPaths \? "" : why/);
  assert.match(branch, /play\.disabled = !hasPaths/);
});

test("the disabled state explains itself", () => {
  // Dimming alone reads as a rendering glitch; the tooltip is the only thing
  // that says why.
  assert.match(panelBranch(), /no drift paths in the weighting domain/);
});

test("the weighting branch clears the drift traces it is meant to hide", () => {
  // The commit's own stated intent: the panel is disabled "rather than left
  // showing drift's traces under a weighting scene". Dimming to opacity 0.5
  // and disabling the play button does not repaint the four canvases, so the
  // drift curves stay on screen -- fainter, but still drawn over a weighting
  // scene they do not belong to. Clearing needs currentView to be dropped and
  // the panels redrawn (or blanked) on the no-paths branch.
  const branch = panelBranch();

  assert.ok(
    /currentView\s*=\s*null/.test(branch) || /setSelection\(\[\]\)/.test(branch),
    "the no-paths branch neither drops currentView nor empties the selection, "
      + "so the previous field's curves remain painted",
  );
});

// --- the initial selection ---------------------------------------------------

test("a freshly loaded payload opens on a path in the central quarter", () => {
  // tracesForPath throws outside [0, 5), so an out-of-quarter default would
  // turn a successful load into the catch branch.
  const match = selectField().match(/setSelection\(\[\{ i: (\d+), j: (\d+) \}\]\)/);

  assert.ok(match, "no initial selection is made");
  for (const n of [Number(match[1]), Number(match[2])]) {
    assert.ok(n >= 0 && n < 5, `initial selection component ${n} is outside the central quarter`);
  }
});

test("the view is only built for a field that has paths", () => {
  // Building it for the weighting domain would mean fetching a payload whose
  // starts do not describe that scene.
  const body = selectField();
  const guard = body.indexOf("if (hasPaths)");
  const build = body.indexOf("createCurrentView");

  assert.ok(guard > 0 && build > guard, "createCurrentView is not inside the hasPaths guard");
});

// --- the shared tick loop (2dd9436) -----------------------------------------
//
// Still static, and this is where that hurts most: a frame loop is exactly the
// kind of thing only a browser can really exercise. What can be checked is the
// structure the comments claim -- ONE counter feeding both consumers, a stop
// at the end rather than a wrap, and a teardown that cannot leave a loop
// running against disposed objects.

/** The body of a named top-level function in viewer.js. */
function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `viewer.js no longer defines ${name}`);
  const rest = source.slice(start);
  const open = rest.indexOf("{");
  let depth = 0;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}" && --depth === 0) return rest.slice(open, i + 1);
  }
  assert.fail(`${name} is unbalanced`);
}

test("one tick counter feeds both the dots and the plot cursor", () => {
  // The stated point of the feature: two counters could drift apart and show
  // an electron at a position its own current trace disagrees with.
  const step = functionBody("stepCurrent");

  assert.match(step, /driftAnim\?\.setTick\(tick\)/);
  assert.match(step, /currentView\?\.setCursor\(tick\)/);
});

test("only one variable is ever advanced", () => {
  // A second counter incremented anywhere would defeat the above.
  const step = functionBody("stepCurrent");
  const advanced = [...step.matchAll(/(\w+)\s*\+=/g)].map((m) => m[1]);

  assert.deepEqual([...new Set(advanced)], ["tick"]);
});

test("the loop stops at the end instead of wrapping", () => {
  // Looping back to t=0 would imply a periodicity the response does not have.
  const step = functionBody("stepCurrent");

  assert.match(step, /tick >= nTicks - 1/);
  assert.match(step, /pauseCurrent\(\)/);
  assert.equal(/tick = 0/.test(step), false, "the loop resets the tick and wraps");
});

test("the tick count comes from the payload, not a constant", () => {
  // 3999 is this dataset's; another export has a different T.
  assert.match(functionBody("stepCurrent"), /currentView\?\.nTicks/);
  assert.match(selectField(), /nTicks = data\.meta\.shape\[2\]/);
});

test("pausing releases the frame handle and is safe when not playing", () => {
  const pause = functionBody("pauseCurrent");

  assert.match(pause, /if \(playHandle !== null\)/);
  assert.match(pause, /cancelAnimationFrame\(playHandle\)/);
  assert.match(pause, /playHandle = null/);
});

test("the button's label and pressed state track the loop", () => {
  // The only on-screen indication of which state it is in.
  const pause = functionBody("pauseCurrent");

  assert.match(pause, /aria-pressed", "false"/);
  assert.match(pause, /textContent = "play"/);
  assert.match(source, /aria-pressed", "true"/);
  assert.match(source, /textContent = "pause"/);
});

test("a field switch pauses before disposing what the loop touches", () => {
  // A loop left running would call setTick against a disposed geometry.
  const body = selectField();
  const paused = body.indexOf("pauseCurrent()");
  const disposed = body.indexOf("driftAnim.points.geometry.dispose()");

  assert.ok(paused >= 0, "selectField does not pause the loop");
  assert.ok(disposed > paused, "disposal happens before the pause");
});

test("a field switch disposes the dots rather than leaking them", () => {
  const body = selectField();

  assert.match(body, /sceneRoot\.remove\(driftAnim\.points\)/);
  assert.match(body, /driftAnim\.points\.geometry\.dispose\(\)/);
  assert.match(body, /driftAnim\.points\.material\.dispose\(\)/);
  assert.match(body, /driftAnim = null/);
});

test("a field switch rewinds the tick", () => {
  // Otherwise the new field's dots would appear mid-drift.
  assert.match(selectField(), /pauseCurrent\(\);\s*\n\s*tick = 0/);
});

test("the dots ride the same z-compressed root as the paths", () => {
  // A dot added to the world instead would leave its own path the moment the
  // z-compression slider moves.
  assert.match(selectField(), /sceneRoot\.add\(driftAnim\.points\)/);
});

test("the dots are built with the payload's tick count", () => {
  // driftAnim and currentView must agree on T or the dot and the cursor
  // describe different instants.
  assert.match(selectField(), /createDriftAnim\(sceneData\.paths, data\.meta\.shape\[2\]\)/);
});

test("a second click at the end replays instead of doing nothing", () => {
  assert.match(source, /if \(tick >= \(currentView\?\.nTicks \?\? 0\) - 1\) tick = 0/);
});

test("clicking while playing pauses", () => {
  const handler = source.slice(source.indexOf('playButton?.addEventListener'));

  assert.match(handler.slice(0, 400), /if \(playHandle !== null\) \{\s*\n\s*pauseCurrent\(\);\s*\n\s*return;/);
});

test("the no-paths branch now drops the view, closing pochoir_viewer-6zr3", () => {
  // cdb2b76 dimmed the panel but left the drift curves painted; 2dd9436
  // added the clear. Kept as a regression pin rather than folded into the
  // earlier test, which is what caught it.
  const body = selectField();
  const branch = body.slice(body.indexOf("if (!hasPaths)"));

  assert.match(branch.slice(0, 300), /currentView\?\.setSelection\(\[\]\)/);
  assert.match(branch.slice(0, 300), /currentView = null/);
});
