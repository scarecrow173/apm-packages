import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("apm.yml audit-research script uses node runtime", () => {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const yml = fs.readFileSync(path.join(repoRoot, "packages", "steer-enterprise-web-research", "apm.yml"), "utf8");
  assert.equal(yml.includes('audit-research: "node scripts/research_audit.js research"'), true);
});