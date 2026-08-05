// Guard against the bare-window/bare-document pattern, which has now been
// fixed three times: nav.js in 0fddf68, viewcube.js in a9b2d7e, and
// enableKeyboardShortcuts after that. Each instance imported fine under node
// and then threw "ReferenceError: window is not defined" when called.
//
// The rule: modules under web/ that are meant to be imported must reach the
// host environment through `globalThis.window` / `globalThis.document`, never
// through the bare global. viewer.js is exempt -- it is the browser-only entry
// point (top-level await fetch, WebGLRenderer) and is never imported here.
//
// This is a source check rather than a behavioural one on purpose: catching the
// pattern does not require constructing a scene, and it fails on the NEXT
// instance instead of waiting for someone to call the offending function.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

/** viewer.js is the browser-only entry point and never imported under node. */
const EXEMPT = new Set(["viewer.js"]);

/**
 * `document` in viewcube.js's labelTexture is a genuine requirement, not a
 * safety net: the face labels are canvas textures. Optional-chaining it would
 * silently produce broken textures instead of failing loudly, so it stays bare
 * and its callers stub `document`. Pinned here so the exemption is deliberate.
 */
const ALLOWED = [{ file: "viewcube.js", line: 'document.createElement("canvas")' }];

function importableModules() {
  return readdirSync(WEB_DIR)
    .filter((f) => f.endsWith(".js") && !EXEMPT.has(f))
    .sort();
}

// A bare `window`/`document` not preceded by `.` (property access) or a word
// character, and not part of `globalThis.window`.
const BARE = /(?<![.\w$])(window|document)\b/g;

/**
 * Strip everything that can mention these words without referencing the global:
 * comments, and string literals (an error message may legitimately say "window").
 */
function codeOnly(text) {
  return text
    .replace(/\/\/.*$/, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/globalThis\.(window|document)/g, "");
}

function offendingLines(source) {
  return source
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    // Comments and docstrings mention these words freely; only code matters.
    .filter(({ text }) => !text.trim().startsWith("//") && !text.trim().startsWith("*"))
    .filter(({ text }) => {
      BARE.lastIndex = 0; // the regex is global: reset between tests
      return BARE.test(codeOnly(text));
    })
    .filter(({ text }) => !ALLOWED.some((a) => text.includes(a.line)));
}

test("there is at least one importable module to check", () => {
  assert.ok(importableModules().length > 0, "web/ has no importable .js modules");
});

for (const file of importableModules()) {
  test(`${file} reaches the host environment via globalThis`, () => {
    const source = readFileSync(join(WEB_DIR, file), "utf8");
    const bad = offendingLines(source);
    assert.deepEqual(
      bad,
      [],
      `${file} uses a bare window/document:\n` +
        bad.map((b) => `  line ${b.line}: ${b.text.trim()}`).join("\n") +
        `\nUse globalThis.window / globalThis.document instead.`,
    );
  });
}

test("the allowed-bare-document exemption is still real", () => {
  // If labelTexture stops needing document, drop the exemption rather than
  // letting it quietly cover a new offender.
  const source = readFileSync(join(WEB_DIR, "viewcube.js"), "utf8");
  assert.ok(
    source.includes(ALLOWED[0].line),
    "viewcube.js no longer contains the exempted document.createElement call; " +
      "remove it from ALLOWED",
  );
});
