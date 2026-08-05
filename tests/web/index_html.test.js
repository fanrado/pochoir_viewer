// Static checks on web/index.html itself.
//
// viewer_static.test.js checks viewer.js against index.html (every
// getElementById has a matching id). This file checks the page's own
// declarations, and the one cross-file version dependency nothing else covers:
// the browser loads three via the index.html import map, while every JS test
// runs against the package.json devDependency. If those drift, the whole JS
// suite validates behaviour against a three the browser never loads.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Every three.js version pinned in the import map. */
function importMapVersions() {
  return [...html.matchAll(/three@([\d.]+)\//g)].map((m) => m[1]);
}

// --- the version the browser loads vs the version the tests run against -----

test("the import map pins at least one three.js version", () => {
  assert.ok(importMapVersions().length > 0, "no three@<version> found in index.html");
});

test("every three.js URL in the import map pins the same version", () => {
  // "three" and "three/addons/" must not drift apart, or addons load against a
  // different core than the bare specifier.
  assert.equal(new Set(importMapVersions()).size, 1, importMapVersions().join(", "));
});

test("the import map version matches the tested devDependency", () => {
  // The browser gets the import-map version; `npm test` gets this one. A drift
  // means every JS test here proves nothing about what actually ships.
  const declared = pkg.devDependencies?.three;
  assert.ok(declared, "package.json has no three devDependency");
  assert.equal(
    importMapVersions()[0],
    declared.replace(/^[\^~]/, ""),
    "index.html import map and package.json devDependency disagree on three",
  );
});

test("the devDependency is pinned exactly, not a range", () => {
  // A caret would let npm install a three the import map does not pin.
  assert.match(pkg.devDependencies.three, /^\d+\.\d+\.\d+$/);
});

// --- import map wiring ------------------------------------------------------

test("the import map declares both specifiers viewer.js uses", () => {
  const viewer = readFileSync(join(ROOT, "web", "viewer.js"), "utf8");
  const bare = [...viewer.matchAll(/from\s+"([^".][^"]*)"/g)].map((m) => m[1]);
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);

  for (const spec of new Set(bare)) {
    const covered =
      spec in map.imports ||
      Object.keys(map.imports).some((k) => k.endsWith("/") && spec.startsWith(k));
    assert.ok(covered, `viewer.js imports "${spec}", absent from the import map`);
  }
});

test("the import map is valid JSON", () => {
  const block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(block, "no import map in index.html");
  assert.doesNotThrow(() => JSON.parse(block[1]));
});

test("the page loads viewer.js as a module", () => {
  // A plain <script> would reject the import statements outright.
  assert.match(html, /<script type="module" src="viewer\.js">/);
});

// --- the documented shortcuts match what nav.js implements ------------------

test("every key listed in the shortcuts panel is handled by nav.js", () => {
  // The panel is the only place most users learn these; a key advertised but
  // not handled is a silent lie.
  const nav = readFileSync(join(ROOT, "web", "nav.js"), "utf8");
  const listed = [...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);

  const digits = listed.filter((k) => /^\d$/.test(k));
  assert.deepEqual(digits, ["1", "6"], "panel advertises a different digit range");
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    assert.match(nav, new RegExp(`^\\s*${digit}:\\s*\\[`, "m"), `AXIS_KEYS lacks ${digit}`);
  }

  for (const letter of listed.filter((k) => /^[A-Za-z]$/.test(k))) {
    assert.match(
      nav,
      new RegExp(`case "${letter.toLowerCase()}":`),
      `panel advertises ${letter}, which nav.js does not handle`,
    );
  }
});

test("the shortcuts panel advertises F, C and R", () => {
  // Pins the panel's contents so a silent deletion is caught too.
  const listed = [...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);

  assert.deepEqual(listed.filter((k) => /^[A-Za-z]$/.test(k)).sort(), ["C", "F", "R"]);
});

// --- controls the page promises --------------------------------------------

test("every control viewer.js drives is declared once", () => {
  const viewer = readFileSync(join(ROOT, "web", "viewer.js"), "utf8");
  const ids = [...viewer.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);

  for (const id of new Set(ids)) {
    const occurrences = html.split(`id="${id}"`).length - 1;
    assert.equal(occurrences, 1, `id="${id}" declared ${occurrences} times in index.html`);
  }
});

test("the canvas viewer.js renders into exists", () => {
  assert.match(html, /<canvas id="view">/);
});
