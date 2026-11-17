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
  // Registry 3: a non-settled design must declare `realizes` — it is the one
  // durable type carrying an expected-upstream contract (Issue #234).
  writeDoc(root, "docs/designs", "widget", [
    'id: DESIGN-0001',
    'type: design',
    'status: draft',
    'title: Widget',
    'created: 2026-01-01',
    'owners: [team]',
    'relations: {}',
  ].join("\n") + "\n");

  const report = await auditDocuments(root, "design");
  assert.ok(codes(report).includes("traceability-missing-upstream"));
});

test("suppresses missing-upstream when an upstream relation is declared", async () => {
  const root = fixture();
  writeDoc(root, "docs/specs", "checkout", 'id: SPEC-0001\ntype: spec\nstatus: approved\ntitle: Checkout\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/designs", "widget", [
    'id: DESIGN-0001',
    'type: design',
    'status: draft',
    'title: Widget',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  realizes: [SPEC-0001]',
  ].join("\n") + "\n");

  const report = await auditDocuments(root, "design");
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
  // A settled design no longer owes a realizes declaration.
  writeDoc(root, "docs/designs", "old-design", [
    'id: DESIGN-0001',
    'type: design',
    'status: superseded',
    'title: Old design',
    'created: 2026-01-01',
    'owners: [team]',
    'relations: {}',
  ].join("\n") + "\n");

  const ideaReport = await auditDocuments(root, "idea");
  assert.ok(!codes(ideaReport).includes("traceability-missing-upstream"));

  const specReport = await auditDocuments(root, "spec");
  assert.ok(!codes(specReport).includes("traceability-missing-upstream"));

  const designReport = await auditDocuments(root, "design");
  assert.ok(!codes(designReport).includes("traceability-missing-upstream"));
});

test("flags stale-upstream for in-flight work on dead upstreams (Issue #166)", async () => {
  const root = fixture();
  // Dead upstreams: a superseded spec and a rejected design.
  writeDoc(root, "docs/specs", "old-spec", 'id: SPEC-0001\ntype: spec\nstatus: superseded\ntitle: Old spec\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/designs", "dead-design", 'id: DESIGN-0002\ntype: design\nstatus: rejected\ntitle: Dead design\ncreated: 2026-01-01\nrelations: {}\n');
  // In-flight documents riding on them: an approved design realizing the
  // superseded spec, a proposed ADR deciding-for the rejected design.
  writeDoc(root, "docs/designs", "stale-design", [
    'id: DESIGN-0001',
    'type: design',
    'status: approved',
    'title: Stale design',
    'created: 2026-01-01',
    'relations:',
    '  realizes: [SPEC-0001]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/adr", "riding-adr", [
    'id: ADR-0002',
    'type: adr',
    'status: proposed',
    'title: Riding ADR',
    'created: 2026-01-01',
    'relations:',
    '  decides-for: [DESIGN-0002]',
  ].join("\n") + "\n");

  const designReport = await auditDocuments(root, "design");
  const designStale = designReport.findings.filter((item) => item.code === "stale-upstream");
  assert.equal(designStale.length, 1);
  assert.equal(designStale[0].file, "stale-design.md");
  assert.ok(designStale[0].message.includes("superseded") && designStale[0].message.includes("SPEC-0001"));
  assert.equal(designStale[0].severity, "warning");
  assert.equal(designStale[0].blocking, false);

  const adrReport = await auditDocuments(root, "adr");
  const adrStale = adrReport.findings.filter((item) => item.code === "stale-upstream");
  assert.equal(adrStale.length, 1);
  assert.ok(adrStale[0].message.includes("rejected") && adrStale[0].message.includes("DESIGN-0002"));
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
  writeDoc(root, "docs/designs", "design", [
    'id: DESIGN-0001',
    'type: design',
    'status: approved',
    'title: Design',
    'created: 2026-01-01',
    'relations:',
    '  realizes: [SPEC-0001]',
  ].join("\n") + "\n");
  // An in-flight design on an approved spec and an in-flight spec refining an
  // implemented spec: upstreams are alive, so nothing is stale.
  writeDoc(root, "docs/specs", "revision", [
    'id: SPEC-0003',
    'type: spec',
    'status: draft',
    'title: Revision',
    'created: 2026-01-01',
    'relations:',
    '  refines: [SPEC-0002]',
  ].join("\n") + "\n");
  // Settled sources never flag even on a dead upstream: a superseded design
  // realizing the (also superseded) spec is finished history, not leftover.
  writeDoc(root, "docs/specs", "old-spec", 'id: SPEC-0004\ntype: spec\nstatus: superseded\ntitle: Old spec\ncreated: 2026-01-01\nrelations: {}\n');
  writeDoc(root, "docs/designs", "old-design", [
    'id: DESIGN-0002',
    'type: design',
    'status: superseded',
    'title: Old design',
    'created: 2026-01-01',
    'relations:',
    '  realizes: [SPEC-0004]',
  ].join("\n") + "\n");
  // Unresolved upstream targets report broken-relation-link, never stale.
  writeDoc(root, "docs/designs", "ghost", [
    'id: DESIGN-0003',
    'type: design',
    'status: draft',
    'title: Ghost',
    'created: 2026-01-01',
    'relations:',
    '  realizes: [SPEC-9999]',
  ].join("\n") + "\n");

  const report = await auditAllDocuments(root);
  assert.ok(!codes(report).includes("stale-upstream"));
});

test("verification findings use the generic relation rules without type-specific duplication", async () => {
  const root = fixture();
  // Registry 3: verification is the durable verification-surface type whose
  // only stored relation is `supersedes` (Check→Claim is derived, #239). A
  // resolvable supersedes is clean; a missing one trips the generic
  // broken-relation-link exactly once — no retired test-spec rule ids.
  writeDoc(root, "docs/verification", "old", [
    'id: VD-0002',
    'type: verification',
    'status: superseded',
    'title: Old verification',
    'created: 2026-01-01',
    'owners: [team]',
    'relations: {}',
  ].join("\n") + "\n");
  writeDoc(root, "docs/verification", "checkout", [
    'id: VD-0001',
    'type: verification',
    'status: draft',
    'title: Checkout verification',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  supersedes: [VD-0002]',
  ].join("\n") + "\n");
  writeDoc(root, "docs/verification", "ghost", [
    'id: VD-0003',
    'type: verification',
    'status: draft',
    'title: Ghost verification',
    'created: 2026-01-01',
    'owners: [team]',
    'relations:',
    '  supersedes: ["missing.md"]',
  ].join("\n") + "\n");

  const report = await auditDocuments(root, "verification");
  const broken = report.findings.filter((item) => item.code === "broken-relation-link");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].file, "ghost.md");
  assert.equal(
    report.findings.filter((item) => item.file === "checkout.md" && item.category === "relation").length,
    0,
    "a resolvable verification supersedes produces no relation finding",
  );
});
