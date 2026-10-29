import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { auditBriefingPair } from "../src/skills/briefing-flow/scripts/lib/briefing_audit";

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

function pairedRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-audit-"));
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, ADR_BODY);
  return repo;
}

function codes(report: ReturnType<typeof auditBriefingPair>): string[] {
  return report.findings.map((finding) => finding.code);
}

test("accepts a spec/adr pair anchored to the same discovery", () => {
  const repo = pairedRepo();
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.equal(report.spec, "docs/specs/0001-graph.md");
  assert.equal(report.adr, "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("accepts a direct typed lineage relation between spec and adr", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derived-by": ["ADR-0001"] },
  }, SPEC_BODY);
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("pairs through a discovery that only lists derived-by", () => {
  const repo = pairedRepo();
  for (const [relativePath, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) {
    writeArtifact(repo, relativePath, { id, type, status: "proposed", title: id }, body);
  }
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.equal(report.consistent, true);
});

test("flags a spec whose acceptance criteria section has no items", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Acceptance Criteria\n\nCriteria are described in prose only.\n");
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags a spec without an acceptance criteria section", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Scope\n\n- in scope\n");
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags an adr with fewer than two considered options", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### Only One\n\n- detail\n");
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("adr-considered-options"));
  assert.equal(report.consistent, false);
});

test("rejects a spec/adr pair anchored to different discoveries", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/discovery/0002-other.md", {
    id: "DISC-0002", type: "discovery", status: "confirmed", title: "Other Discovery",
    relations: { "derived-by": ["ADR-0001"] },
  }, "# Other Discovery\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0002"] },
  }, ADR_BODY);
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.equal(report.consistent, false);
});

test("does not pair a spec/adr that only refine the same discovery", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
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
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.equal(report.consistent, false);
});

test("flags relation targets that do not resolve", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["docs/discovery/missing.md"] },
  }, SPEC_BODY);
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  const finding = report.findings.find((entry) => entry.code === "broken-relation-link");
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.equal(finding.file, "docs/specs/0001-graph.md");
  assert.equal(report.consistent, false);
});

test("reports placeholders as warnings without breaking consistency", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n\nTODO: tighten wording\n");
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  const finding = report.findings.find((entry) => entry.code === "unresolved-placeholder");
  assert.ok(finding);
  assert.equal(finding.severity, "warning");
  assert.equal(report.consistent, true);
});

test("flags statuses outside the briefing contract", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "draft", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "draft", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, ADR_BODY);
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-status"));
  assert.ok(codes(report).includes("adr-status"));
  assert.equal(report.consistent, false);
});

test("flags documents with the wrong declared type", () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "IDEA-0001", type: "idea", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, SPEC_BODY);
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-type"));
  assert.equal(report.consistent, false);
});

test("flags unparseable front matter", () => {
  const repo = pairedRepo();
  fs.writeFileSync(path.join(repo, "docs/specs/0001-graph.md"), "---\nid: [unclosed\n---\n# Graph\n", "utf8");
  const report = auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("unparseable-front-matter"));
  assert.equal(report.consistent, false);
});

test("flags missing input files", () => {
  const repo = pairedRepo();
  const report = auditBriefingPair(repo, "docs/specs/missing.md", "docs/adr/0001-graph.md");
  assert.equal(report.spec, null);
  assert.ok(codes(report).includes("missing-file"));
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
