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
