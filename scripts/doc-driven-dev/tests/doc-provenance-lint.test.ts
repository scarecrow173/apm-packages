import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditAllDocuments, auditDocuments } from "../src/skills/lib/doc_audit";

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
    'id: SPEC-0001',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["./evidence/missing.pdf"]',
    '  implements: [IDEA-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("provenance-unresolved-local-source"));
  assert.ok(!codes(report).includes("broken-relation-link"));
});

test("accepts resolvable local file and external URL sources", async () => {
  const root = fixture();
  writeFile(root, "evidence/report.pdf", "pdf");
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-0001',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["../../evidence/report.pdf", "https://example.com/research"]',
    '  implements: [IDEA-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("provenance-unresolved-local-source"));
  assert.ok(!codes(report).includes("provenance-invalid-source"));
});

test("flags root-escaping source as invalid", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-0001',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: ["../../../outside/evidence.pdf"]',
    '  implements: [IDEA-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  const finding = report.findings.find((item) => item.code === "provenance-invalid-source");
  assert.ok(finding);
});

test("flags missing source evidence for discovery documents", async () => {
  const root = fixture();
  writeDoc(root, "docs/discovery", "research", [
    'id: DISC-0001',
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
    'id: SPEC-0001',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  source: []',
    '  implements: [IDEA-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("provenance-missing-source"));
});

test("flags missing upstream for types with expected traceability", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", [
    'id: SPEC-0001',
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
    'id: SPEC-0001',
    'type: spec',
    'status: draft',
    'title: Checkout',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  implements: [IDEA-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("traceability-missing-upstream"));
});

test("does not flag missing upstream for root-eligible or terminal-status docs", async () => {
  const root = fixture();
  writeDoc(root, "docs/ideas", "spark", 'id: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/specs", "legacy", [
    'id: SPEC-0002',
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

test("flags stale-upstream for in-flight work on dead upstreams (Issue #166)", async () => {
  const root = fixture();
  // Dead upstreams: a completed plan, a superseded spec, a deprecated ADR.
  writeDoc(root, "docs/plans", "done-plan", 'id: PLAN-0001\ntype: plan\nstatus: completed\ntitle: Done plan\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/specs", "old-spec", 'id: SPEC-0001\ntype: spec\nstatus: superseded\ntitle: Old spec\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/adr", "old-adr", 'id: ADR-0001\ntype: adr\nstatus: deprecated\ntitle: Old ADR\ncreated: 2026-01-01\nrelations: {}\n');
  // In-flight documents riding on them.
  writeDoc(root, "docs/tasks", "leftover", [
    'id: TASK-0001',
    'type: task',
    'status: todo',
    'title: Leftover',
    'created: 2026-01-01',
    'relations:',
    '  implements: [PLAN-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/designs", "stale-design", [
    'id: DESIGN-0001',
    'type: design',
    'status: approved',
    'title: Stale design',
    'created: 2026-01-01',
    'relations:',
    '  derives-from: [SPEC-0001, ADR-0001]',
  ].join("\n") + "\n");

  const taskReport = await auditDocuments(root, "task");
  const taskStale = taskReport.findings.filter((item) => item.code === "stale-upstream");
  assert.equal(taskStale.length, 1);
  assert.equal(taskStale[0].file, "leftover.md");
  assert.ok(taskStale[0].message.includes("completed"));
  assert.equal(taskStale[0].severity, "warning");
  assert.equal(taskStale[0].blocking, false);

  // One finding per dead upstream edge: superseded spec + deprecated ADR.
  const designReport = await auditDocuments(root, "design");
  const designStale = designReport.findings.filter((item) => item.code === "stale-upstream");
  assert.equal(designStale.length, 2);
  assert.ok(designStale.some((item) => item.message.includes("superseded") && item.message.includes("SPEC-0001")));
  assert.ok(designStale.some((item) => item.message.includes("deprecated") && item.message.includes("ADR-0001")));
});

test("stale-upstream does not fire on live upstreams or settled documents", async () => {
  const root = fixture();
  // Live upstreams: approved spec + accepted ADR are normative baselines,
  // resolved discovery is settled evidence — none are dead.
  writeDoc(root, "docs/specs", "spec", 'id: SPEC-0001\ntype: spec\nstatus: approved\ntitle: Spec\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/specs", "shipped", 'id: SPEC-0002\ntype: spec\nstatus: implemented\ntitle: Shipped\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/adr", "adr", 'id: ADR-0001\ntype: adr\nstatus: accepted\ntitle: ADR\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/discovery", "research", [
    'id: DISC-0001',
    'type: discovery',
    'status: resolved',
    'title: Research',
    'created: 2026-01-01',
    'relations:',
    '  source: ["https://example.com/r"]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/plans", "plan", [
    'id: PLAN-0001',
    'type: plan',
    'status: approved',
    'title: Plan',
    'created: 2026-01-01',
    'relations:',
    '  derives-from: [DESIGN-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/designs", "design", [
    'id: DESIGN-0001',
    'type: design',
    'status: approved',
    'title: Design',
    'created: 2026-01-01',
    'relations:',
    '  derives-from: [SPEC-0001, ADR-0001, DISC-0001]',
  ].join("\n") + "\n");
  // A todo task on an approved plan and an in-flight spec on an implemented
  // spec: upstreams are alive, so nothing is stale.
  writeDoc(root, "docs/tasks", "work", [
    'id: TASK-0001',
    'type: task',
    'status: todo',
    'title: Work',
    'created: 2026-01-01',
    'relations:',
    '  implements: [PLAN-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/specs", "revision", [
    'id: SPEC-0003',
    'type: spec',
    'status: draft',
    'title: Revision',
    'created: 2026-01-01',
    'relations:',
    '  refines: [SPEC-0002]',
  ].join("\n") + "\n");
  // Settled sources never flag even on a dead upstream: a done task on the
  // (separately planted) completed plan is finished evidence, not leftover.
  writeDoc(root, "docs/plans", "done-plan", 'id: PLAN-0002\ntype: plan\nstatus: completed\ntitle: Finished\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/tasks", "shipped-task", [
    'id: TASK-0002',
    'type: task',
    'status: done',
    'title: Shipped task',
    'created: 2026-01-01',
    'relations:',
    '  implements: [PLAN-0002]',
  ].join("\n") + "\n");
  // Unresolved upstream targets report broken-relation-link, never stale.
  writeDoc(root, "docs/tasks", "ghost", [
    'id: TASK-0003',
    'type: task',
    'status: todo',
    'title: Ghost',
    'created: 2026-01-01',
    'relations:',
    '  implements: [PLAN-9999]',
  ].join("\n") + "\n");

  const report = await auditAllDocuments(root);
  assert.ok(!codes(report).includes("stale-upstream"));
});

test("verification findings use the traceability category rules without duplication", async () => {
  const root = fixture();
  writeDoc(root, "docs/test-specs", "checkout", [
    'id: TEST-SPEC-0001',
    'type: test-spec',
    'status: draft',
    'title: Checkout tests',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  verifies: [TASK-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/tasks", "work", 'id: TASK-0001\ntype: task\nstatus: todo\ntitle: Work\ncreated: 2026-01-01\nrelations: {}\n');

  const report = await auditDocuments(root, "test-spec");
  const invalid = report.findings.filter((item) => item.code === "test-spec-invalid-verifies-target");
  assert.equal(invalid.length, 1);
  assert.ok(!codes(report).includes("invalid-relation-target-type"));
});
