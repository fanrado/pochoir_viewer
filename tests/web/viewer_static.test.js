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
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
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
 *
 * Scanned across ALL of web/, not just viewer.js. The first version covered
 * viewer.js only, on the reasoning that it is the module no behavioural test can
 * reach. That leaves a residual hole: an importable module could gain a dynamic
 * id and, if nobody happened to write a behavioural test for it, nothing would
 * catch a mismatch. Scanning everything costs one registry entry.
 */
const DYNAMIC_IDS = {
  "field-${field}": ["field-drift", "field-weight"], // the CLI --field choices
  "mode-${mode}": ["mode-image", "mode-contours", "mode-both"], // SLICE_MODES
};

/** Every web module, including the browser-only entry point. */
function allModules() {
  return readdirSync(WEB_DIR).filter((f) => f.endsWith(".js")).sort();
}

test("dynamically-built getElementById ids are registered and present", () => {
  const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");

  // Template-literal lookups: getElementById(`...`), anywhere under web/.
  const found = new Map(); // pattern -> file that uses it
  for (const file of allModules()) {
    const text = readFileSync(join(WEB_DIR, file), "utf8");
    for (const m of text.matchAll(/getElementById\(`([^`]+)`\)/g)) {
      found.set(m[1], file);
    }
  }
  const patterns = [...found.keys()];

  const unregistered = patterns.filter((p) => !(p in DYNAMIC_IDS));
  assert.deepEqual(
    unregistered,
    [],
    `these ids are built dynamically and are not in DYNAMIC_IDS: ` +
      unregistered.map((p) => `${p} (${found.get(p)})`).join(", ") +
      `. Add them with the ids they expand to, or the literal check ignores them.`,
  );

  // Registry entries must correspond to real code, so a stale one cannot linger
  // and give the impression of coverage.
  const stale = Object.keys(DYNAMIC_IDS).filter((p) => !patterns.includes(p));
  assert.deepEqual(stale, [], `DYNAMIC_IDS lists patterns no web module uses: ${stale}`);

  const missing = patterns
    .flatMap((p) => DYNAMIC_IDS[p])
    .filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(
    missing,
    [],
    `web/ builds ids absent from index.html: ${missing.join(", ")}. ` +
      `These would be null at runtime.`,
  );
});
