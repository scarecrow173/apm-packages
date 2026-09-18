import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditDocuments } from "../src/skills/lib/doc_audit";

const tempDirs: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-provenance-"));
  tempDirs.push(root);
  return root;
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeDoc(root: string, dir: string, name: string, frontMatter: string, body = "# Doc\n") {
  writeFile(root, `${dir}/${name}.md`, `---\n${frontMatter}---\n${body}`);
}

function codes(report: { findings: Array<{ code: string }> }) {
  return report.findings.map((finding) => finding.code);
}

test.afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("flags unresolved local source as provenance finding, not relation finding", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["./evidence/missing.pdf"]',
    '  implements: [IDEA-AAA]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("provenance-unresolved-local-source"));
  assert.ok(!codes(report).includes("broken-relation-link"));
});

test("accepts resolvable local file and external URL sources", async () => {
  const root = fixture();
  writeFile(root, "evidence/report.pdf", "pdf");
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["../../evidence/report.pdf", "https://example.com/research"]',
    '  implements: [IDEA-AAA]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("provenance-unresolved-local-source"));
  assert.ok(!codes(report).includes("provenance-invalid-source"));
});

test("flags root-escaping source as invalid", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["../../../outside/evidence.pdf"]',
    '  implements: [IDEA-AAA]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  const finding = report.findings.find((item) => item.code === "provenance-invalid-source");
  assert.ok(finding);
});

test("flags missing source evidence for discovery documents", async () => {
  const root = fixture();
  writeDoc(root, "docs/discovery", "research", [
    'id: DISC-AAA',
    'type: discovery',
    'status: draft',
    'title: Research',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: []',
  ].join("\n") + "\n");

  const report = await auditDocuments(root, "discovery");
  assert.ok(codes(report).includes("provenance-missing-source"));
});

test("does not flag missing source for types without the contract requirement", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: []',
    '  implements: [IDEA-AAA]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("provenance-missing-source"));
});

test("flags missing upstream for types with expected traceability", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations: {}',
  ].join("\n") + "\n");

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("traceability-missing-upstream"));
});

test("suppresses missing-upstream when an upstream relation is declared", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-AAA',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  implements: [IDEA-AAA]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("traceability-missing-upstream"));
});

test("does not flag missing upstream for root-eligible or terminal-status docs", async () => {
  const root = fixture();
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-AAA\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/specs", "legacy", [
    'id: SPEC-OLD',
    'type: spec',
    'status: superseded',
    'title: Legacy',
    'created: 2026-01-01',
    'owners: [team]',
    'relations: {}',
  ].join("\n") + "\n");

  const ideaReport = await auditDocuments(root, "idea");
  assert.ok(!codes(ideaReport).includes("traceability-missing-upstream"));

  const specReport = await auditDocuments(root, "spec");
  assert.ok(!codes(specReport).includes("traceability-missing-upstream"));
});

test("verification findings use the traceability category rules without duplication", async () => {
  const root = fixture();
  writeDoc(root, "docs/test-specs", "checkout", [
    'id: TEST-SPEC-AAA',
    'type: test-spec',
    'status: draft',
    'title: Checkout tests',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  verifies: [TASK-BBB]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/tasks", "work", 'id: TASK-BBB\ntype: task\nstatus: todo\ntitle: Work\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "test-spec");
  const invalid = report.findings.filter((item) => item.code === "test-spec-invalid-verifies-target");
  assert.equal(invalid.length, 1);
  assert.ok(!codes(report).includes("invalid-relation-target-type"));
});
