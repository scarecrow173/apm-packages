import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

for (const file of [
  "packages/steer-enterprise-web-research/README.md",
  "packages/steer-enterprise-web-research/README.ja.md",
]) {
  test(`${file} documents scripts-side ts source`, () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const body = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.equal(body.includes("scripts/steer-enterprise-web-research/src/research_audit.ts"), true);
    assert.equal(body.includes("packages/steer-enterprise-web-research/scripts/research_audit.js"), true);
  });
}