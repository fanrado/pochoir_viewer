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
  // turn a successful load into the catch branch. 6ed3d79 moved the default
  // from a literal setSelection into the selector's seed key.
  const match = source.match(/if \(selectedPaths\.size === 0\) selectedPaths\.add\("(\d+),(\d+)"\)/);

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

// --- the fail-safe click handler (c75d7c2) -----------------------------------
//
// The invariant is that the button state and the model never disagree with
// what was actually drawn. A cell left looking pressed after a failed draw is
// the worst outcome here: it reports a selection the panels never showed.

test("a failed draw does not escape the click handler", () => {
  const body = functionBody("applyPathSelection");

  assert.match(body, /try \{\s*\n\s*currentView\?\.setSelection\(picks\)/);
  assert.match(body, /catch/);
});

test("applyPathSelection reports success or failure", () => {
  // The button state depends on knowing which happened.
  const body = functionBody("applyPathSelection");

  assert.match(body, /return false/);
  assert.match(body, /return true/);
});

test("a failure does not blame the export", () => {
  // Reporting 'run export-current' is what disguised pochoir_viewer-x1i0 as a
  // missing file; the payload is loaded by this point.
  const body = functionBody("applyPathSelection");
  const catchBlock = body.slice(body.indexOf("catch"));
  // Comments stripped: the block explains that it deliberately does NOT use
  // the export message, so the phrase legitimately appears in prose there.
  const code = catchBlock.replace(/\/\/[^\n]*/g, "");

  assert.equal(/export-current/.test(code), false, "the failure still blames the export");
  assert.match(code, /could not be drawn/);
});

test("the failure names the selection that could not be drawn", () => {
  assert.match(functionBody("applyPathSelection"), /JSON\.stringify\(picks\)/);
});

test("a failed draw leaves the animation alone", () => {
  // The early return sits before setSelected and the tick reset, so a failed
  // selection cannot move the dots to match a plot that was never drawn.
  const body = functionBody("applyPathSelection");
  const failed = body.indexOf("return false");

  assert.ok(failed > 0);
  assert.ok(body.indexOf("driftAnim?.setSelected") > failed, "the dots move before the guard");
  assert.ok(body.indexOf("tick = 0") > failed, "the tick resets before the guard");
});

test("the cell is painted from the result, not before the attempt", () => {
  // Flipping aria-pressed up front is what left a cell looking selected when
  // the draw failed.
  const handler = source.slice(source.indexOf("cell.addEventListener"));
  const applied = handler.indexOf("applyPathSelection()");
  const painted = handler.indexOf("cell.setAttribute");

  assert.ok(applied > 0 && painted > applied, "aria-pressed is set before the draw is attempted");
});

test("a failed toggle rolls the model back", () => {
  // Otherwise the set and the button disagree, and the next click computes
  // the wrong toggle.
  const handler = source.slice(source.indexOf("cell.addEventListener"));
  const branch = handler.slice(handler.indexOf("} else {"), handler.indexOf("});"));

  assert.match(branch, /wasSelected \? selectedPaths\.add\(key\) : |if \(wasSelected\) selectedPaths\.add\(key\)/);
  assert.match(branch, /selectedPaths\.delete\(key\)/);
  assert.match(branch, /String\(wasSelected\)/);
});

test("clear all rolls back too", () => {
  // The same invariant for the bulk control: a failed clear must not leave
  // the set empty while the buttons still look pressed.
  const handler = source.slice(source.indexOf('getElementById("path-clear")'));

  assert.match(handler.slice(0, 600), /const previous = new Set\(selectedPaths\)/);
  assert.match(handler.slice(0, 600), /for \(const key of previous\) selectedPaths\.add\(key\)/);
});

test("clear all only repaints the cells once the clear succeeded", () => {
  const handler = source.slice(source.indexOf('getElementById("path-clear")'), source.indexOf('getElementById("path-clear")') + 600);
  const applied = handler.indexOf("applyPathSelection()");
  const painted = handler.indexOf('setAttribute("aria-pressed", "false")');

  assert.ok(applied > 0 && painted > applied, "the cells are cleared before the draw is attempted");
});

test("every in-block start is now selectable, so the guard is a backstop", () => {
  // Worth stating: after 94799a9 nothing in the 10x10 grid should throw. The
  // try/catch is defence against a future narrowing, not a live filter --
  // pochoir_viewer-u9ht is fixed by the generalisation, not by this.
  const body = functionBody("applyPathSelection");

  assert.equal(/i < 5|PIXEL_OFFSET/.test(body), false, "the handler filters cells instead");
});

// --- temporal dead zone at module evaluation (3cc9bf5) -----------------------
//
// viewer.js does `await selectField("drift")` at module scope, so everything
// selectField reaches runs DURING module evaluation. Function declarations
// hoist, but const and let do not: a binding declared below that call is still
// in its temporal dead zone when the call runs, and touching it throws
// ReferenceError. 3cc9bf5 hit exactly this -- selectedPaths sat beside the
// selector functions, so wirePathSelector threw and no click listener was ever
// attached. The selector rendered perfectly and did nothing.
//
// Nothing else in the suite can see this: the functions parse, the ids all
// exist, and the static checks above pass either way. So the ordering is
// checked directly.

/** Line number of the module-scope `await selectField(...)`. */
function moduleEvalLine() {
  const lines = source.split("\n");
  const n = lines.findIndex((line) => /^await selectField\(/.test(line));
  assert.ok(n > 0, "viewer.js no longer calls selectField at module scope");
  return n + 1;
}

/** Top-level `const`/`let` bindings, as name -> 1-based declaration line. */
function topLevelBindings() {
  const found = new Map();
  source.split("\n").forEach((line, n) => {
    const match = line.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)/);
    if (match) found.set(match[1], n + 1);
  });
  return found;
}

/** Functions reached while selectField runs. */
const EVALUATION_PATH = [
  "selectField",
  "buildPotential",
  "wirePathSelector",
  "applyPathSelection",
  "applySliceVisibility",
  "setPressed",
  "pathIdFor",
  "pathCells",
  "pauseCurrent",
];

test("every binding touched during module evaluation is declared before it", () => {
  // The general form of the 3cc9bf5 bug, not just the one symbol it hit.
  const evalLine = moduleEvalLine();
  const bindings = topLevelBindings();

  const late = [];
  for (const name of EVALUATION_PATH) {
    const body = functionBody(name);
    for (const [binding, line] of bindings) {
      if (line > evalLine && new RegExp(`\\b${binding}\\b`).test(body)) {
        late.push(`${binding} (line ${line}) used by ${name}, evaluated at line ${evalLine}`);
      }
    }
  }

  assert.deepEqual(late, [], `temporal dead zone at module evaluation:\n${late.join("\n")}`);
});

test("selectedPaths specifically is declared with the module state", () => {
  // The symbol that actually broke, kept as its own check so a regression
  // names it directly.
  const bindings = topLevelBindings();

  assert.ok(bindings.has("selectedPaths"), "selectedPaths is no longer top-level");
  assert.ok(
    bindings.get("selectedPaths") < moduleEvalLine(),
    "selectedPaths is declared after the module-scope selectField call again",
  );
});

test("it sits with the other current-view state, not with the selector functions", () => {
  // Where it is matters as much as that it works: the next person to tidy
  // these functions together would reintroduce the bug.
  const bindings = topLevelBindings();
  const selectedPaths = bindings.get("selectedPaths");

  assert.ok(
    Math.abs(selectedPaths - bindings.get("driftAnim")) < 20,
    "selectedPaths drifted away from driftAnim and the rest of the module state",
  );
});

test("the reason it must stay put is recorded next to it", () => {
  // A bare `const selectedPaths = new Set()` invites being moved back.
  const declaration = source.indexOf("const selectedPaths = new Set()");
  const preceding = source.slice(Math.max(0, declaration - 700), declaration);

  assert.match(preceding, /temporal dead zone|TDZ/i);
});
