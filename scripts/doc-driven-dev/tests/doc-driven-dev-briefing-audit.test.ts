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

test("accepts a direct typed lineage relation between spec and adr", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derived-by": ["ADR-0001"] },
  }, SPEC_BODY);
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.deepEqual(report.findings, []);
  assert.equal(report.consistent, true);
});

test("pairs through a discovery that only lists derived-by", async () => {
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
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Acceptance Criteria\n\nCriteria are described in prose only.\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags a spec without an acceptance criteria section", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Scope\n\n- in scope\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("spec-acceptance-criteria"));
  assert.equal(report.consistent, false);
});

test("flags an adr with fewer than two considered options", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### Only One\n\n- detail\n");
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("adr-considered-options"));
  assert.equal(report.consistent, false);
});

test("rejects a spec/adr pair anchored to different discoveries", async () => {
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
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.equal(report.consistent, false);
});

test("does not pair a spec/adr that only refine the same discovery", async () => {
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
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("inconsistent-pairing"));
  assert.equal(report.consistent, false);
});

test("flags relation targets that do not resolve", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["docs/discovery/missing.md"] },
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
    relations: { "derives-from": ["DISC-0001"] },
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
    relations: { "derives-from": ["DISC-0001"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "draft", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
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
    relations: { "derives-from": ["DISC-0001"] },
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
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Anchor",
    relations: { "derived-by": ["SPEC-0001", "ADR-0001"] },
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
    relations: { "derives-from": ["SPEC-0001"] },
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
    relations: { "derives-from": ["ADR-0001", "DISC-0001"] },
  }, SPEC_BODY);
  fs.writeFileSync(path.join(repo, "ADR-0001"), "not the ADR");
  fs.unlinkSync(path.join(repo, "docs/discovery/0001-graph.md"));
  const report = await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md");
  assert.ok(codes(report).includes("broken-relation-link"));
  assert.equal(report.consistent, false);
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Discovery",
  }, "# Discovery\n");
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
    relations: { "derives-from": ["docs/adr/0001-graph.md"] },
  }, SPEC_BODY);
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "ADR",
  }, ADR_BODY);
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
});

test("does not pair a noncanonical discovery", async () => {
  const repo = pairedRepo();
  fs.mkdirSync(path.join(repo, "other"), { recursive: true });
  fs.renameSync(path.join(repo, "docs/discovery/0001-graph.md"), path.join(repo, "other/discovery.md"));
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, {
    id, type, status: "proposed", title: id, relations: { "derives-from": ["other/discovery.md"] },
  }, body);
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
});

test("uses typed design chains and rejects ambiguous or unrelated designs", async () => {
  const repo = pairedRepo();
  for (const [file, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", SPEC_BODY],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", ADR_BODY],
  ] as const) writeArtifact(repo, file, { id, type, status: "proposed", title: id }, body);
  const design = (file: string, refs: string[]) => writeArtifact(repo, file, {
    id: file, type: "design", status: "approved", title: "Design", relations: { "derives-from": refs },
  }, "# Design\n");
  design("docs/designs/a.md", ["SPEC-0001", "ADR-0001"]);
  assert.equal((await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).consistent, true);
  design("docs/designs/b.md", ["SPEC-0001", "ADR-0001"]);
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
  design("docs/designs/a.md", ["SPEC-0001"]);
  design("docs/designs/b.md", ["ADR-0001"]);
  assert.ok(codes(await auditBriefingPair(repo, "docs/specs/0001-graph.md", "docs/adr/0001-graph.md")).includes("inconsistent-pairing"));
});

test("fails closed on a selected discovery's malformed or missing relations", async () => {
  const repo = pairedRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Discovery",
    relations: { "derived-by": ["SPEC-0001", "ADR-0001", "MISSING"], related: [42] },
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
    relations: { "derives-from": ["DISC-0001"] },
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
