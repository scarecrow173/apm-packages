import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// `.apm/skills/setup-pstack-devin/` is a byte-for-byte copy of the overlay
// source: APM deploys `.apm/` primitives independently of the generated
// devin-plugin tree, so both trees ship the same skill. The overlay path is
// the edit authority — a divergence means one side was edited without
// re-copying.
const OVERLAY_DIR = join(
  __dirname,
  "../../../packages/pstack-devin/overlay/skills/setup-pstack-devin",
);
const APM_DIR = join(
  __dirname,
  "../../../packages/pstack-devin/.apm/skills/setup-pstack-devin",
);

const SYNC_HINT =
  "edit the overlay source and re-copy, or sync .apm — " +
  "the .apm tree must stay byte-identical to " +
  "packages/pstack-devin/overlay/skills/setup-pstack-devin/";

/** Recursive rel-path list (forward slashes, sorted). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const dirents = readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const de of dirents) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(join(abs, de.name), r);
      } else if (de.isFile()) {
        out.push(r);
      }
    }
  };
  walk(dir, "");
  return out;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

test(".apm skill tree mirrors the overlay file set exactly", () => {
  const overlayFiles = listFiles(OVERLAY_DIR);
  const apmFiles = listFiles(APM_DIR);
  assert.deepEqual(
    apmFiles,
    overlayFiles,
    `file sets diverge: ${SYNC_HINT}`,
  );
  assert.ok(overlayFiles.length > 0, "overlay skill dir is empty");
});

test("every .apm skill file is byte-identical to its overlay source", () => {
  for (const rel of listFiles(OVERLAY_DIR)) {
    const o = sha256(join(OVERLAY_DIR, rel));
    const a = sha256(join(APM_DIR, rel));
    assert.equal(a, o, `divergent file: ${rel} — ${SYNC_HINT}`);
  }
});
