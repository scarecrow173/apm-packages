import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditTree, VOCABULARY } from "../src/compat-audit.js";

function fixture(files: Record<string, string>): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), "compat-audit-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return { root, files: Object.keys(files) };
}

test("known tokens classify, no unknowns", () => {
  const { root, files } = fixture({
    "skills/x/SKILL.md": 'Use Task with subagent_type: generalPurpose and readonly: true\nRun /deslop first.\n',
  });
  const r = auditTree(root, files);
  assert.equal(r.unknowns.length, 0);
  const labels = r.findings.map((f) => f.label);
  assert.ok(labels.includes("tool:Task") && labels.includes("extskill:deslop"));
});

test("unknown API-shaped token fails audit", () => {
  const { root, files } = fixture({
    "skills/x/SKILL.md": "Spawn with subagent_type: megaReviewer\n",
  });
  const r = auditTree(root, files);
  assert.equal(r.unknowns.length, 1);
  assert.match(r.unknowns[0].match, /megaReviewer/);
});

test("cloud environment requirement classified error", () => {
  const { root, files } = fixture({
    "skills/y/SKILL.md": 'spawn: { environment: "cloud" }\n',
  });
  const r = auditTree(root, files);
  assert.equal(r.findings.find((f) => f.label === "field:environment:cloud")?.cls, "error");
});
