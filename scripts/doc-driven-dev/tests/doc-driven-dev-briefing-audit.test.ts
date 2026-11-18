import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { auditBriefingPair, type BriefingAuditReport } from "../src/skills/briefing-flow/scripts/lib/briefing_audit";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-13",
    updated: "2026-08-13",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

const SPEC_BODY = "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n";
const ADR_BODY = "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n";

// Knowledge Relations v1 pair evidence: a discovery/brainstorm anchor whose
// stored `motivates`/`informs` edges reach BOTH artifacts pairs a spec with
// an ADR; the direct pre-design pair is the stored `adr.decides-for → spec`
// edge. Legacy spellings (`derives-from`, `derived-by`, `refines`,
// `refined-by`) are migration-domain findings, never evidence.
function pairedRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-audit-"));
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, ADR_BODY);
  return repo;
}

function codes(report: BriefingAuditReport): string[] {
  return report.findings.map((finding) => finding.code);
}

test("accepts a spec/adr pair anchored to the same discovery", async () => {
  const repo = pairedRepo();
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.equal(report.spec, "docs/specs/0001-graph.md");
  assert.equal(report.adr, "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("accepts the canonical adr decides-for spec direct pair", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "decides-for": ["SPEC-0001"] },
  }, ADR_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("accepts a brainstorm anchor that motivates both artifacts", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  writeArtifact(repo, "docs/discovery/0001-brainstorm.md", {
    id: "STORM-0001", type: "brainstorm", status: "confirmed", title: "Graph Brainstorm",
    relations: { motivates: ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Brainstorm\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("legacy derives-from spellings never satisfy pair evidence", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["ADR-0001"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["SPEC-0001"] },
  }, ADR_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.ok(codes(report).includes("invalid-relation"));
  assert.equal(report.consistent, false);
});

test("pairs through a discovery that only stores motivates/informs", async () => {
  const repo = pairedRepo();
  for (const [relativePath, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) {
    writeArtifact(repo, relativePath, { id, type, status: "proposed", title: id }, body);
  }
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.equal(report.consistent, true);
});

test("flags a spec whose acceptance criteria section has no items", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\nCriteria are described in prose only.\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags a spec without an acceptance criteria section", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Scope\n\n- in scope\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags an adr with fewer than two considered options", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### Only One\n\n- detail\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("adr-considered-options"));
  assert.equal(report.consistent, false);
});

test("accepts a spec/adr pair authored with localized section headings", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## 受け入れ基準\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n## 検討した選択肢\n\n### 案A\n\n### 案B\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("a fenced ## Acceptance Criteria section does not satisfy the spec check", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n```md\n## Acceptance Criteria\n\n- [ ] fake\n```\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("a fenced ## Considered Options section does not satisfy the adr check", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n```md\n## Considered Options\n\n### A\n\n### B\n```\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("adr-considered-options"));
  assert.equal(report.consistent, false);
});

test("a localized-but-undeclared heading still fails the spec check closed", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## 受入条件\n\n- [ ] graph state\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("rejects a spec/adr pair anchored to different discoveries", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/discovery/0002-other.md", {
    id: "DISC-0002", type: "discovery", status: "resolved", title: "Other Discovery",
    relations: { informs: ["ADR-0001"] },
  }, "# Other Discovery\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.equal(report.consistent, false);
});

test("does not pair a spec/adr that only refine the same discovery", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Graph Discovery",
  }, "# Graph Discovery\n");
  for (const [relativePath, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) {
    writeArtifact(repo, relativePath, {
      id, type, status: "proposed", title: id,
      relations: { refines: ["DISC-0001"] },
    }, body);
  }
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.ok(codes(report).includes("invalid-relation"));
  assert.equal(report.consistent, false);
});

test("flags relation targets that do not resolve", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { supersedes: ["SPEC-MISSING"] },
  }, SPEC_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  const finding = report.findings.find((entry) => entry.code === "broken-relation-link");
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.equal(finding.file, "docs/specs/0001-graph.md");
  assert.equal(report.consistent, false);
});

test("reports placeholders as warnings without breaking consistency", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n\nTODO: tighten wording\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  const finding = report.findings.find((entry) => entry.code === "unresolved-placeholder");
  assert.ok(finding);
  assert.equal(finding.severity, "warning");
  assert.equal(report.consistent, true);
});

test("flags statuses outside the briefing contract", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "draft", title: "Graph",
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "draft", title: "Graph ADR",
  }, ADR_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-status"));
  assert.ok(codes(report).includes("adr-status"));
  assert.equal(report.consistent, false);
});

test("flags documents with the wrong declared type", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "IDEA-0001", type: "idea", status: "proposed", title: "Graph",
  }, SPEC_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-type"));
  assert.equal(report.consistent, false);
});

test("flags unparseable front matter", async () => {
  const repo = pairedRepo();
  fs.writeFileSync(path.join(repo, "docs/specs/0001-graph.md"), "---\nid: [unclosed\n---\n# Graph\n", "utf8");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("unparseable-front-matter"));
  assert.equal(report.consistent, false);
});

test("flags missing input files", async () => {
  const repo = pairedRepo();
  const report = await auditBriefingPair(repo, "docs/specs/missing.md", "docs/adr/0001-graph.md");
  assert.equal(report.spec, null);
  assert.ok(codes(report).includes("missing-file"));
  assert.equal(report.consistent, false);
});

test("uses graph records for discovery in any canonical directory and multiple references", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  writeArtifact(repo, "docs/ideas/anchor.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Anchor",
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001"] },
  }, "# Anchor\n");
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, { id, type, status: "proposed", title: id }, body);
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
});

test("rejects duplicate IDs even if a matching file path exists", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/duplicate.md", { id: "SPEC-0001", type: "spec", status: "proposed", title: "Duplicate" }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "ADR",
    relations: { "decides-for": ["SPEC-0001"] },
  }, ADR_BODY);
  fs.writeFileSync(path.join(repo, "SPEC-0001"), "not an artifact");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("duplicate-id"));
  assert.ok(codes(report).includes("broken-relation-link"));
  assert.equal(report.consistent, false);
});

test("resolves exact ID before a same-named local path and checks every relation", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Spec",
    relations: { supersedes: ["SPEC-0002"] },
  }, SPEC_BODY);
  fs.writeFileSync(path.join(repo, "SPEC-0002"), "not a spec");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("invalid-relation"));
  assert.equal(report.consistent, false);
  writeArtifact(repo, "docs/specs/0002-other.md", {
    id: "SPEC-0002", type: "spec", status: "approved", title: "Other Spec",
  }, "# Other Spec\n\n## Acceptance Criteria\n\n- [ ] other\n");
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
});

test("an ID that looks like the ADR path resolves to its actual owner, not the ADR", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  writeArtifact(repo, "docs/ideas/other.md", {
    id: "docs/adr/0001-graph.md", type: "idea", status: "proposed", title: "Other",
  }, "# Other\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Spec",
    relations: { supersedes: ["docs/adr/0001-graph.md"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "ADR",
  }, ADR_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.ok(codes(report).includes("invalid-relation"));
});

test("does not pair a noncanonical discovery", async () => {
  const repo = pairedRepo();
  fs.mkdirSync(path.join(repo, "other"), { recursive: true });
  fs.renameSync(path.join(repo, "docs/discovery/0001-graph.md"), path.join(repo, "other/discovery.md"));
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, {
    id, type, status: "proposed", title: id,
  }, body);
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
});

test("accepts multiple supporting designs but rejects designs connecting only one document each", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, { id, type, status: "proposed", title: id }, body);
  const design = (file: string) => writeArtifact(repo, file, {
    id: file, type: "design", status: "approved", title: "Design", relations: { realizes: ["SPEC-0001"] },
  }, "# Design\n");
  const adrDecisions = (targets: string[]) => writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "decides-for": targets },
  }, ADR_BODY);
  design("docs/designs/a.md");
  adrDecisions(["docs/designs/a.md"]);
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
  design("docs/designs/b.md");
  adrDecisions(["docs/designs/a.md", "docs/designs/b.md"]);
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
  // Each design now claims only one artifact: `a` realizes the spec without a
  // decision edge, `b` is decided-for but realizes nothing — neither closes
  // the spec/ADR/design chain, and the unassigned-spec anchor search is
  // skipped because a design still realizes the spec.
  adrDecisions(["docs/designs/b.md"]);
  writeArtifact(repo, "docs/designs/b.md", {
    id: "docs/designs/b.md", type: "design", status: "approved", title: "Design",
  }, "# Design\n");
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
});

test("legacy plan/task/test-spec Markdown never enters the pair audit", async () => {
  const repo = pairedRepo();
  for (const [file, id, type] of [
    ["docs/plans/PLAN-1.md", "PLAN-1", "plan"],
    ["docs/tasks/TASK-1.md", "TASK-1", "task"],
    ["docs/test-specs/TS-1.md", "TS-1", "test-spec"],
  ] as const) {
    writeArtifact(repo, file, {
      id, type, status: "approved", title: id,
      relations: { "derives-from": ["SPEC-0001", "MISSING"], related: [42] },
    }, "# Legacy\n");
  }
  // The durable-corpus scan never reads execution-bound or legacy dirs, so
  // malformed legacy relations cannot contaminate the pair audit — their
  // findings belong to migration tooling, not briefing.
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
});

test("direct pair evidence survives separate downstream designs", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "ADR",
    relations: { "decides-for": ["SPEC-0001", "docs/designs/B.md"] },
  }, ADR_BODY);
  writeArtifact(repo, "docs/designs/A.md", {
    id: "A", type: "design", status: "approved", title: "A", relations: { realizes: ["SPEC-0001"] },
  }, "# Design\n");
  writeArtifact(repo, "docs/designs/B.md", {
    id: "B", type: "design", status: "approved", title: "B",
  }, "# Design\n");
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
});

test("checks all supporting designs when pair evidence depends on designs", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, { id, type, status: "proposed", title: id }, body);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "decides-for": ["docs/designs/A.md", "docs/designs/B.md"] },
  }, ADR_BODY);
  for (const [id, extra] of [["A", []], ["B", ["MISSING"]]] as const) writeArtifact(repo, `docs/designs/${id}.md`, {
    id, type: "design", status: "approved", title: id,
    relations: { realizes: ["SPEC-0001", ...extra], related: id === "B" ? [42] : [] },
  }, "# Design\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("broken-relation-link"));
  assert.ok(codes(report).includes("invalid-relation"));
  assert.equal(report.consistent, false);
});

test("rejects duplicate IDs in any supporting design", async () => {
  const repo = pairedRepo();
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, { id, type, status: "proposed", title: id }, body);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "decides-for": ["docs/designs/A.md", "docs/designs/B.md"] },
  }, ADR_BODY);
  for (const name of ["A", "B"]) writeArtifact(repo, `docs/designs/${name}.md`, {
    id: "DESIGN-DUP", type: "design", status: "approved", title: name,
    relations: { realizes: ["SPEC-0001"] },
  }, "# Design\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("duplicate-id"));
  assert.equal(report.consistent, false);
});

test("fails closed on a selected discovery's malformed or missing relations", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001", "MISSING"], related: [42] },
  }, "# Discovery\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("invalid-relation"));
  assert.ok(codes(report).includes("broken-relation-link"));
  assert.equal(report.consistent, false);
});

test("checks local Markdown destinations but not external URLs, fragments or code", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Spec",
  }, `${SPEC_BODY}\n[bad](missing.md#heading) ![image](no.png) [ref][x]\n\n[x]: ./absent.md\n\n[external](https://example.invalid/x) [fragment](#none) \`[code](fake.md)\`\n`);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.equal(report.findings.filter((f) => f.code === "broken-local-link").length, 3);
  assert.equal(report.consistent, false);
});

test("audit_briefing CLI exits non-zero on error findings and prints json", () => {
  const repo = pairedRepo();
  const script = path.join(skillRoot, "briefing-flow", "scripts", "audit_briefing.js");
  const ok = spawnSync(
    process.execPath,
    [script, "--spec", "docs/specs/0001-graph.md", "--adr", "docs/adr/0001-graph.md", "--cwd", repo, "--json"],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.consistent, true);
  const bad = spawnSync(
    process.execPath,
    [script, "--spec", "docs/specs/missing.md", "--adr", "docs/adr/0001-graph.md", "--cwd", repo],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  assert.equal(bad.status, 1);
});
