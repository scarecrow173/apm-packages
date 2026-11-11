import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditDocuments } from "../src/skills/lib/doc_audit";
import { lintScope, MATERIALIZED_RULE_IDS } from "../src/skills/lib/doc_lint";
import type { AuditProfile } from "../src/skills/lib/doc_lint";
// Namespace import: Task 2 adds `profileGates` and the gate-name constants to
// doc_report; referencing them off the namespace keeps the suite loadable even
// before the implementation lands.
import * as docReport from "../src/skills/lib/doc_report";
import { scanRepository } from "../src/skills/lib/doc_repository";
import type { Finding } from "../src/skills/lib/doc_repository";

const tempDirs: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-profile-"));
  tempDirs.push(root);
  return root;
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

const IMPLEMENTS_IDEA = "relations:\n  implements: [IDEA-0001]\n";

function writeSpec(
  root: string,
  name: string,
  id: string,
  title: string,
  body: string,
  extraFrontMatter = "",
  status = "draft",
) {
  writeFile(
    root,
    `docs/specs/${name}.md`,
    `---\nid: ${id}\ntype: spec\nstatus: ${status}\ntitle: ${title}\ncreated: "2026-01-01"\nupdated: "2026-01-01"\nowners: [team]\n${extraFrontMatter}---\n${body}`,
  );
}

function writeIdea(root: string) {
  writeFile(
    root,
    "docs/ideas/idea-a.md",
    "---\nid: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Idea\ncreated: \"2026-01-01\"\nupdated: \"2026-01-01\"\nowners: [team]\n---\n# Idea\n",
  );
}

// Two specs that implement the same idea and link to each other: every
// artifact-surface invariant holds (valid front matter, declared upstream,
// inbound canonical links, a resolved outbound relation), so the only way to
// get a finding out of this fixture is index state.
function writeLinkedSpecPair(root: string) {
  writeIdea(root);
  writeSpec(root, "a", "SPEC-0001", "Spec A", "# Spec A\n\nSee [Spec B](b.md).\n", IMPLEMENTS_IDEA);
  writeSpec(root, "b", "SPEC-0002", "Spec B", "# Spec B\n\nSee [Spec A](a.md).\n", IMPLEMENTS_IDEA);
}

const indexRow = (id: string, title: string, status: string, file: string) =>
  `| ${id} | ${title} | ${status} | [${file}](./${file}) |`;

function writeSpecIndex(root: string, rows: string[]) {
  const header = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
  writeFile(
    root,
    "docs/specs/README.md",
    `---\ntype: index\nof: spec\nstatus: active\ntitle: Spec Index\ncreated: "2026-01-01"\n---\n# Spec Index\n\n${header}\n${rows.join("\n")}\n`,
  );
}

async function lint(root: string, profile?: AuditProfile, type = "spec", dir = "docs/specs"): Promise<Finding[]> {
  const model = await scanRepository({ cwd: root });
  return lintScope(model, type, dir, profile);
}

function codes(findings: Finding[]): string[] {
  return findings.map((finding) => finding.ruleId);
}

function materializedFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => MATERIALIZED_RULE_IDS.has(finding.ruleId));
}

test.afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("MATERIALIZED_RULE_IDS pins exactly the index-surface rule ids", () => {
  assert.deepEqual([...MATERIALIZED_RULE_IDS].sort(), [
    "index-duplicate-entry",
    "index-escapes-root",
    "index-metadata-mismatch",
    "index-missing-entry",
    "index-missing-overview",
    "index-ordering",
    "index-stale-entry",
    "index-tier-mismatch",
    "index-unparseable",
    "missing-index",
    "orphan-index",
  ]);
});

test("artifact profile emits no index findings; materialized reports missing-index", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(
    codes(artifact).filter((code) => MATERIALIZED_RULE_IDS.has(code)),
    [],
    "artifact must not evaluate index-surface rules",
  );

  const materialized = await lint(root, "materialized");
  const missing = materialized.find((finding) => finding.ruleId === "missing-index");
  assert.ok(missing, "materialized reports the absent README");
  assert.equal(missing.blocking, true);
});

test("artifact profile produces zero findings on a stale index; materialized reports index-missing-entry", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  // README exists but only lists a.md — b.md's row is missing.
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(codes(artifact), [], "stale index state is invisible to the artifact profile");

  const materialized = await lint(root, "materialized");
  const missingEntry = materialized.find((finding) => finding.ruleId === "index-missing-entry");
  assert.ok(missingEntry, "materialized reports the missing index row");
  assert.equal(missingEntry.path, "docs/specs/b.md");
});

test("inconsistent index emits lintIndexConsistency findings only under materialized", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  // The index has every member row but is internally inconsistent: a stale
  // row to a missing file plus a misordered pair exercises rules that live
  // exclusively inside lintIndexConsistency.
  writeSpecIndex(root, [
    indexRow("SPEC-0002", "Spec B", "draft", "b.md"),
    indexRow("SPEC-0001", "Spec A", "draft", "a.md"),
    indexRow("SPEC-9999", "Ghost", "draft", "ghost.md"),
  ]);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(materializedFindings(artifact), [], "artifact does not evaluate index consistency");

  const materialized = await lint(root, "materialized");
  const materializedCodes = codes(materialized);
  assert.ok(materializedCodes.includes("index-stale-entry"), "materialized reports the stale row");
  assert.ok(materializedCodes.includes("index-ordering"), "materialized reports the misordered rows");
});

test("status and tier drift between front matter and index rows is materialized-only", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  writeSpec(root, "old", "SPEC-0003", "Old Spec", "# Old\n\nSee [a](a.md).\n", IMPLEMENTS_IDEA, "superseded");
  // Two drift forms: a.md's status cell disagrees with its front matter, and
  // the settled SPEC-0003 is ordered ahead of the in-flight rows (it belongs
  // under `## Settled`, so expected order puts it last).
  writeSpecIndex(root, [
    indexRow("SPEC-0003", "Old Spec", "superseded", "old.md"),
    indexRow("SPEC-0001", "Spec A", "approved", "a.md"),
    indexRow("SPEC-0002", "Spec B", "draft", "b.md"),
  ]);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(materializedFindings(artifact), [], "index drift is invisible to the artifact profile");

  const materialized = await lint(root, "materialized");
  const materializedCodes = codes(materialized);
  assert.ok(materializedCodes.includes("index-metadata-mismatch"), "materialized reports the stale status cell");
  assert.ok(materializedCodes.includes("index-ordering"), "materialized reports the settled row ordered ahead of in-flight rows");
});

test("artifact profile still catches canonical-document defects", async () => {
  const root = fixture();
  writeIdea(root);
  // duplicate-id: two artifacts share SPEC-0001.
  writeSpec(root, "dup-a", "SPEC-0001", "Dup A", "# Dup A\n\nSee [dup-b](dup-b.md).\n", IMPLEMENTS_IDEA);
  writeSpec(root, "dup-b", "SPEC-0001", "Dup B", "# Dup B\n\nSee [dup-a](dup-a.md).\n", IMPLEMENTS_IDEA);
  // invalid-status + broken-relation-link.
  writeSpec(
    root,
    "bad",
    "SPEC-0002",
    "Bad",
    "# Bad\n\nSee [dup-a](dup-a.md).\n",
    "relations:\n  implements: [SPEC-9999]\n",
    "bogus-status",
  );

  const specFindings = await lint(root, "artifact");
  const specCodes = codes(specFindings);
  assert.ok(specCodes.includes("duplicate-id"), "duplicate-id is an artifact defect");
  assert.ok(specCodes.includes("invalid-status"), "invalid-status is an artifact defect");
  assert.ok(specCodes.includes("broken-relation-link"), "broken-relation-link is an artifact defect");

  // missing-overview: a design directory without the required overview.md is a
  // canonical required-file finding and stays in both profiles.
  writeFile(
    root,
    "docs/designs/widget.md",
    "---\nid: DESIGN-0001\ntype: design\nstatus: draft\ntitle: Widget\ncreated: \"2026-01-01\"\nupdated: \"2026-01-01\"\nowners: [team]\n---\n# Widget\n",
  );
  const artifactDesign = await lint(root, "artifact", "design", "docs/designs");
  assert.ok(
    codes(artifactDesign).includes("missing-overview"),
    "missing-overview stays an artifact finding",
  );
  const materializedDesign = await lint(root, "materialized", "design", "docs/designs");
  assert.ok(
    codes(materializedDesign).includes("missing-overview"),
    "missing-overview stays a materialized finding too",
  );
});

test("orphan split: index membership is materialized-only; canonical orphans stay in artifact", async () => {
  const root = fixture();
  // listed.md is in the index but unreachable through canonical links or
  // relations. unlisted.md is absent from the index entirely.
  writeSpec(root, "listed", "SPEC-0001", "Listed", "# Listed\n");
  writeSpec(root, "unlisted", "SPEC-0002", "Unlisted", "# Unlisted\n");
  writeSpecIndex(root, [indexRow("SPEC-0001", "Listed", "draft", "listed.md")]);

  const orphansFor = (findings: Finding[], file: string) =>
    findings.filter((finding) => finding.path === file).map((finding) => finding.ruleId);

  const artifact = await lint(root, "artifact");
  const listedArtifact = orphansFor(artifact, "docs/specs/listed.md");
  assert.ok(listedArtifact.includes("orphan-navigation"), "index-only reachability does not count under artifact");
  assert.ok(listedArtifact.includes("orphan-relation"));
  assert.ok(!listedArtifact.includes("orphan-index"), "orphan-index is suppressed under artifact");

  const unlistedArtifact = orphansFor(artifact, "docs/specs/unlisted.md");
  assert.ok(unlistedArtifact.includes("orphan-navigation"));
  assert.ok(unlistedArtifact.includes("orphan-relation"));
  assert.ok(!unlistedArtifact.includes("orphan-index"), "orphan-index is suppressed under artifact");
  assert.deepEqual(materializedFindings(artifact), [], "no index-surface findings leak into artifact");

  const materialized = await lint(root, "materialized");
  const listedMaterialized = orphansFor(materialized, "docs/specs/listed.md");
  assert.ok(!listedMaterialized.includes("orphan-navigation"), "index README link counts as inbound under materialized");
  assert.ok(listedMaterialized.includes("orphan-relation"), "relation orphans still fire under materialized");
  assert.ok(!listedMaterialized.includes("orphan-index"), "indexed docs are not index orphans");

  const unlistedMaterialized = orphansFor(materialized, "docs/specs/unlisted.md");
  assert.ok(unlistedMaterialized.includes("orphan-index"), "materialized flags docs missing from the index");
});

test("omitting the profile behaves exactly like explicit materialized", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const model = await scanRepository({ cwd: root });
  const implicitProfile = lintScope(model, "spec", "docs/specs");
  const explicitMaterialized = lintScope(model, "spec", "docs/specs", "materialized");
  assert.deepEqual(implicitProfile, explicitMaterialized);
  assert.ok(codes(implicitProfile).includes("index-missing-entry"), "default keeps materialized index checks");
});

// ---------------------------------------------------------------------------
// Collection layer + CLI threading (Issue #195, Task 2)
// ---------------------------------------------------------------------------

const MATERIALIZED_GATE_NAMES = [
  "index-consistency",
  "index-membership",
  "index-presence",
  "orphan-index-membership",
];

test("profileGates reports ran/skipped check groups per profile", () => {
  assert.equal(typeof docReport.profileGates, "function", "doc_report exports profileGates");
  assert.ok(Array.isArray(docReport.ARTIFACT_GATES), "doc_report exports ARTIFACT_GATES");
  assert.ok(Array.isArray(docReport.MATERIALIZED_ONLY_GATES), "doc_report exports MATERIALIZED_ONLY_GATES");
  assert.deepEqual([...docReport.MATERIALIZED_ONLY_GATES].sort(), MATERIALIZED_GATE_NAMES);
  assert.deepEqual(docReport.profileGates("artifact"), {
    ran: [...docReport.ARTIFACT_GATES],
    skipped: [...docReport.MATERIALIZED_ONLY_GATES],
  });
  assert.deepEqual(docReport.profileGates("materialized"), {
    ran: [...docReport.ARTIFACT_GATES, ...docReport.MATERIALIZED_ONLY_GATES],
    skipped: [],
  });
});

test("collectFindings threads the query profile and reports gates", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const artifact = await docReport.collectFindings(root, { type: "spec", profile: "artifact" });
  assert.equal(artifact.profile, "artifact");
  assert.deepEqual(codes(artifact.findings), [], "artifact run sees no index findings without a README");
  assert.deepEqual([...artifact.gates.skipped].sort(), MATERIALIZED_GATE_NAMES);

  const materialized = await docReport.collectFindings(root, { type: "spec" });
  assert.equal(materialized.profile, "materialized", "unspecified profile stays materialized");
  assert.deepEqual(materialized.gates.skipped, []);
  assert.ok(materialized.gates.ran.includes("index-presence"));
  assert.ok(codes(materialized.findings).includes("missing-index"));
});

test("auditDocuments reports profile and gates on the report envelope", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const artifact = await auditDocuments(root, "spec", undefined, { profile: "artifact" });
  assert.equal(artifact.profile, "artifact");
  assert.deepEqual([...artifact.gates.skipped].sort(), MATERIALIZED_GATE_NAMES);
  assert.deepEqual(artifact.findings, []);

  const materialized = await auditDocuments(root, "spec");
  assert.equal(materialized.profile, "materialized");
  assert.deepEqual(materialized.gates.skipped, []);
  assert.ok(materialized.findings.some((finding) => finding.code === "missing-index"));
});

// --- CLI-level: the generated bundles accept --profile ----------------------

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function runCli(name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, "doc-status", "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(dir, full), fs.readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return files;
}

test("doc_status lint --profile artifact skips index gates; default stays materialized", () => {
  const root = fixture();
  writeLinkedSpecPair(root); // valid canonical docs, NO README in docs/specs

  const artifact = runCli("doc_status.js", ["lint", "--type", "spec", "--json", "--profile", "artifact"], root);
  assert.equal(artifact.status, 0, artifact.stderr);
  const artifactReport = JSON.parse(artifact.stdout);
  assert.equal(artifactReport.command, "lint");
  assert.equal(artifactReport.profile, "artifact");
  assert.equal(artifactReport.blocking, 0);
  assert.deepEqual(artifactReport.findings, []);
  assert.deepEqual([...artifactReport.gates.skipped].sort(), MATERIALIZED_GATE_NAMES);

  const materialized = runCli("doc_status.js", ["lint", "--type", "spec", "--json"], root);
  assert.equal(materialized.status, 0, materialized.stderr);
  const materializedReport = JSON.parse(materialized.stdout);
  assert.equal(materializedReport.profile, "materialized");
  assert.deepEqual(materializedReport.gates.skipped, []);
  assert.ok(
    materializedReport.findings.some((finding: { ruleId: string }) => finding.ruleId === "missing-index"),
    "default lint still reports the missing README",
  );

  const human = runCli("doc_status.js", ["lint", "--type", "spec", "--profile", "artifact"], root);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /profile: artifact/);
});

test("doc_status audit --profile artifact reports profile and gates", () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const result = runCli("doc_status.js", ["audit", "--type", "spec", "--json", "--profile", "artifact"], root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, "audit");
  assert.equal(report.profile, "artifact");
  assert.equal(report.blocking, 0);
  assert.ok(report.gates.ran.includes("front-matter"));
  assert.ok(report.gates.skipped.includes("index-consistency"));
});

test("doc_status health --profile artifact drops the orphan-index roll-up", () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  // The index lists only a.md: under materialized b.md is an orphan-index;
  // under artifact the index contributes nothing and b.md has no orphan.
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const artifact = runCli("doc_status.js", ["health", "--type", "spec", "--json", "--profile", "artifact"], root);
  assert.equal(artifact.status, 0, artifact.stderr);
  const report = JSON.parse(artifact.stdout);
  assert.equal(report.profile, "artifact");
  assert.ok(report.gates.skipped.includes("orphan-index-membership"));
  assert.equal(report.orphans.total, 0);
  assert.ok(!("orphan-index" in report.orphans.byRule), "artifact roll-up has no orphan-index bucket");

  const materialized = runCli("doc_status.js", ["health", "--type", "spec", "--json"], root);
  assert.equal(materialized.status, 0, materialized.stderr);
  const materializedReport = JSON.parse(materialized.stdout);
  assert.equal(materializedReport.orphans.byRule["orphan-index"], 1);
});

test("doc_status list accepts --profile without applying it", () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  const result = runCli("doc_status.js", ["list", "--type", "spec", "--profile", "artifact"], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a\.md/);
});

test("audit_docs --profile artifact reports profile; default keeps missing-index", () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const artifact = runCli("audit_docs.js", ["--type", "spec", "--json", "--profile", "artifact"], root);
  assert.equal(artifact.status, 0, artifact.stderr);
  const report = JSON.parse(artifact.stdout);
  assert.equal(report.profile, "artifact");
  assert.ok(report.gates.skipped.includes("index-presence"));
  assert.deepEqual(report.findings, []);

  const materialized = runCli("audit_docs.js", ["--type", "spec", "--json"], root);
  assert.equal(materialized.status, 0, materialized.stderr);
  const materializedReport = JSON.parse(materialized.stdout);
  assert.equal(materializedReport.profile, "materialized");
  assert.ok(
    materializedReport.findings.some((finding: { code: string }) => finding.code === "missing-index"),
    "default audit_docs still reports the missing README",
  );
});

test("audit_docs --type all --profile artifact merges a uniform profile envelope", () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const result = runCli("audit_docs.js", ["--type", "all", "--json", "--profile", "artifact"], root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.profile, "artifact");
  assert.deepEqual([...report.gates.skipped].sort(), MATERIALIZED_GATE_NAMES);
  assert.ok(
    !report.findings.some((finding: { code: string }) => MATERIALIZED_RULE_IDS.has(finding.code)),
    "merged --type all report carries no index-surface findings under artifact",
  );
});

test("explicit --profile materialized matches the omitted-profile output", () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const explicit = runCli("doc_status.js", ["lint", "--type", "spec", "--json", "--profile", "materialized"], root);
  const omitted = runCli("doc_status.js", ["lint", "--type", "spec", "--json"], root);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(omitted.status, 0, omitted.stderr);
  assert.deepEqual(JSON.parse(explicit.stdout), JSON.parse(omitted.stdout));
});

test("--profile rejects an unknown value on both CLIs", () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const lint = runCli("doc_status.js", ["lint", "--type", "spec", "--profile", "bogus"], root);
  assert.notEqual(lint.status, 0, "doc_status rejects --profile bogus");
  assert.match(lint.stderr, /--profile/);

  const audit = runCli("audit_docs.js", ["--type", "spec", "--profile", "bogus"], root);
  assert.notEqual(audit.status, 0, "audit_docs rejects --profile bogus");
  assert.match(audit.stderr, /--profile/);
});

test("--profile runs are read-only under both profiles", () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const before = snapshot(root);
  for (const args of [
    ["lint", "--type", "spec", "--profile", "artifact"],
    ["lint", "--type", "spec"],
    ["audit", "--type", "spec", "--profile", "artifact"],
    ["health", "--type", "spec", "--profile", "artifact"],
  ]) {
    const result = runCli("doc_status.js", args, root);
    assert.equal(result.status, 0, `doc_status ${args.join(" ")}: ${result.stderr}`);
  }
  const auditDocs = runCli("audit_docs.js", ["--type", "spec", "--json", "--profile", "artifact"], root);
  assert.equal(auditDocs.status, 0, auditDocs.stderr);
  assert.deepEqual(snapshot(root), before);
});
