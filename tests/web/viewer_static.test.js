// Static checks for web/viewer.js, the one browser-only module.
//
// viewer.js cannot be imported under node: it does a top-level-await fetch and
// constructs a WebGLRenderer at module scope. So it is exempt from the
// bare-globals guard and from every behavioural test -- which left a real hole.
// Verified before writing this: appending outright gibberish to viewer.js kept
// the entire suite green. A syntax error in the entry point would ship.
//
// These checks cannot tell you the viewer WORKS -- only a browser can (see
// pochoir_viewer-6k5). They tell you it parses and that the modules and DOM ids
// it depends on actually exist, which is the class of breakage a rename causes.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const VIEWER = join(WEB_DIR, "viewer.js");

const source = () => readFileSync(VIEWER, "utf8");

test("viewer.js parses as an ES module", () => {
  // node --check infers CommonJS for .js, which rejects top-level await and
  // import statements; the .mjs copy is what makes the check meaningful.
  const dir = mkdtempSync(join(tmpdir(), "viewer-parse-"));
  const copy = join(dir, "viewer.mjs");
  writeFileSync(copy, source());

  try {
    execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" });
  } catch (err) {
    assert.fail(`viewer.js does not parse:\n${err.stderr?.toString() ?? err.message}`);
  }
});

test("every relative import in viewer.js resolves to a real file", () => {
  const specifiers = [...source().matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "expected viewer.js to import local modules");

  for (const spec of specifiers) {
    const resolved = join(WEB_DIR, spec);
    assert.ok(existsSync(resolved), `viewer.js imports ${spec}, which does not exist`);
  }
});

test("every named import in viewer.js is actually exported", async () => {
  // Catches a rename on either side of the boundary -- the failure mode that
  // would otherwise surface only as a blank page in the browser.
  const blocks = [...source().matchAll(/import\s*\{([^}]+)\}\s*from\s+"(\.[^"]+)"/g)];
  assert.ok(blocks.length > 0, "expected at least one named-import block");

  for (const [, names, spec] of blocks) {
    const mod = await import(new URL(spec, new URL("../../web/", import.meta.url)));
    for (const raw of names.split(",")) {
      // Handle `x as y`: the imported name is what must exist in the module.
      const imported = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!imported) continue;
      assert.ok(
        imported in mod,
        `viewer.js imports { ${imported} } from ${spec}, which does not export it`,
      );
    }
  }
});

test("every getElementById in viewer.js has a matching id in index.html", () => {
  const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");
  const ids = [...source().matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "expected viewer.js to look up DOM elements");

  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(
    missing,
    [],
    `viewer.js looks up ids absent from index.html: ${missing.join(", ")}. ` +
      `These would be null at runtime.`,
  );
});

/**
 * Ids built with a template literal, which the literal-string check above
 * cannot see. Each pattern must be listed here with the ids it expands to, and
 * an unlisted pattern is a failure rather than a silent skip -- that silence is
 * exactly the blind spot this registry exists to close.
 */
const DYNAMIC_IDS = {
  "field-${field}": ["field-drift", "field-weight"], // the CLI --field choices
};

test("dynamically-built getElementById ids are registered and present", () => {
  const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");
  // Template-literal lookups: getElementById(`...`)
  const patterns = [...source().matchAll(/getElementById\(`([^`]+)`\)/g)].map((m) => m[1]);

  const unregistered = patterns.filter((p) => !(p in DYNAMIC_IDS));
  assert.deepEqual(
    unregistered,
    [],
    `viewer.js builds these ids dynamically and they are not in DYNAMIC_IDS: ` +
      `${unregistered.join(", ")}. Add them with the ids they expand to, or the ` +
      `literal check silently ignores them.`,
  );

  // Registry entries must correspond to real code, so a stale one cannot linger
  // and give the impression of coverage.
  const stale = Object.keys(DYNAMIC_IDS).filter((p) => !patterns.includes(p));
  assert.deepEqual(stale, [], `DYNAMIC_IDS lists patterns viewer.js no longer uses: ${stale}`);

  const missing = patterns
    .flatMap((p) => DYNAMIC_IDS[p])
    .filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(
    missing,
    [],
    `viewer.js builds ids absent from index.html: ${missing.join(", ")}. ` +
      `These would be null at runtime.`,
  );
});
