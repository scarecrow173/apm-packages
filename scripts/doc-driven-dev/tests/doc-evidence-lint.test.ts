import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectFindings } from "../src/skills/lib/doc_report";
import { lintEvidenceStore, lintTrackedExecutionDocs } from "../src/skills/lib/doc_evidence_lint";
import { scanRepository } from "../src/skills/lib/doc_repository";
import { documentRevisionOf, putImmutable, StoreError } from "../src/skills/lib/evidence_store";
import type { EvidenceInput } from "../src/skills/lib/evidence_store";
import { initStateRoot } from "../src/skills/lib/execution_store";
import { projectKnowledgeGraph, resolveCheckReference } from "../src/skills/lib/knowledge_graph";
import type { KnowledgeGraph } from "../src/skills/lib/knowledge_graph";

// Issue #246 — repo-level authorities in doc-status.
//
// Two check families no per-type scope can express:
//   * lintTrackedExecutionDocs — Git-resident plan/task/legacy Markdown under
//     migration-owned dirs is migration inventory, never runtime state;
//   * lintEvidenceStore — Evidence Store records re-assessed against the live
//     Knowledge Graph and the checkout's HEAD subject, reported one finding
//     per failed axis.
//
// Both fire only on repo-wide queries: a --type/--dir-narrowed run audits its
// scope, not the store.

const FIXED_NOW = "2026-02-01T00:00:00.000Z";

function sha256Of(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function tempRepo(prefix = "doc-evidence-lint-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function gitOut(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

function writeFile(repo: string, relPath: string, content: string): void {
  const file = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function writeDoc(repo: string, relPath: string, data: Record<string, unknown>, body = "# Doc\n"): void {
  writeFile(repo, relPath, matter.stringify(body, {
    created: "2026-01-01",
    updated: "2026-01-01",
    owners: [],
    relations: {},
    ...data,
  }));
}

function writeSpec(repo: string, claims = ["R-01"], id = "SPEC-abcd"): void {
  writeDoc(repo, "docs/specs/spec.md", {
    id, type: "spec", status: "approved", title: "Spec",
  }, ["# Spec", "", ...claims.map((claim) => `<!-- claim:${claim} --> Requirement ${claim}`), ""].join("\n"));
}

// A verification document with a real `checks:` inventory — CHK-01 targets
// the spec's R-01 claim by default.
function writeVerification(repo: string, checks: { id: string; target: string; required?: boolean }[] = [
  { id: "CHK-01", target: "SPEC-abcd::R-01" },
], id = "VD-efgh"): void {
  const entries = checks.map((check) => ({
    id: check.id,
    target: check.target,
    method: "unit",
    implementation: "pnpm test",
    preconditions: ["spec exists"],
    passCriteria: { kind: "unit", expect: `criterion for ${check.id}` },
    limitations: [],
    required: check.required ?? true,
  }));
  writeDoc(repo, "docs/verification/vd.md", {
    id, type: "verification", status: "approved", title: "Design", checks: entries,
  }, "# Verification Design\n\n## Checks\n");
}

function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);
}

// A durable corpus plus an initialized (git-ignored) state root, committed
// so HEAD exists for commit-subject assessment.
function knowledgeRepo(): string {
  const repo = tempRepo();
  writeSpec(repo);
  writeVerification(repo);
  git(repo, ["init", "-q"]);
  initStateRoot(repo);
  commitAll(repo);
  return repo;
}

async function modelFor(repo: string) {
  return scanRepository({ cwd: repo, roots: ["docs"] });
}

async function graphFor(repo: string): Promise<KnowledgeGraph> {
  return projectKnowledgeGraph(await modelFor(repo));
}

function specRevision(repo: string): string {
  return documentRevisionOf(fs.readFileSync(path.join(repo, "docs/specs/spec.md"), "utf8"));
}

function checkRevision(graph: KnowledgeGraph, ref: string): string {
  const resolution = resolveCheckReference(graph, ref);
  assert.equal(resolution.status, "resolved", `${ref} must resolve in the fixture graph`);
  return resolution.check.designRevision;
}

// A record pinned to the LIVE graph and a commit subject — the well-formed
// baseline every drift test perturbs one field of.
async function recordFor(repo: string, commitOid: string, overrides: Partial<EvidenceInput> = {}): Promise<EvidenceInput> {
  const graph = await graphFor(repo);
  return {
    evidenceId: `EVID-${crypto.randomBytes(4).toString("hex")}`,
    claim: { ref: "SPEC-abcd::R-01", documentRevision: specRevision(repo) },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkRevision(graph, "VD-efgh::CHK-01") },
    subject: { kind: "commit", commit: commitOid },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: "RUN-0001",
    environment: { runner: "local" },
    outcome: "passed",
    retention: "release",
    artifacts: [{
      uri: "file:logs/unit.txt",
      sha256: sha256Of("unit-log"),
      availability: "available",
      retention: "release",
      expiresAt: null,
    }],
    ...overrides,
  };
}

async function evidenceRuleIds(repo: string): Promise<string[]> {
  const findings = await lintEvidenceStore(repo, await modelFor(repo), { now: FIXED_NOW });
  return findings.map((finding) => finding.ruleId).sort();
}

// ---------------------------------------------------------------------------
// lintTrackedExecutionDocs
// ---------------------------------------------------------------------------

test("tracked execution and legacy markdown under migration-owned dirs is flagged repo-wide", async () => {
  const repo = tempRepo();
  writeSpec(repo);
  writeDoc(repo, "docs/plans/plan.md", { id: "PLAN-0001", type: "plan", status: "draft", title: "Plan" });
  writeDoc(repo, "docs/tasks/task.md", { id: "TASK-0001", type: "task", status: "todo", title: "Task" });
  writeDoc(repo, "docs/impl/ir/rec.md", { id: "IMPL-0001", type: "impl", status: "draft", title: "IR" });
  writeDoc(repo, "docs/test-specs/ts.md", { id: "TSPEC-0001", type: "test-spec", status: "draft", title: "TS" });

  const model = await modelFor(repo);
  const findings = lintTrackedExecutionDocs(model);
  const byPath = new Map(findings.map((finding) => [finding.path, finding]));

  const plan = byPath.get("docs/plans/plan.md");
  const task = byPath.get("docs/tasks/task.md");
  const ir = byPath.get("docs/impl/ir/rec.md");
  const ts = byPath.get("docs/test-specs/ts.md");
  assert.equal(plan?.ruleId, "tracked-execution-doc");
  assert.equal(task?.ruleId, "tracked-execution-doc");
  assert.equal(ir?.ruleId, "tracked-legacy-doc");
  assert.equal(ts?.ruleId, "tracked-legacy-doc");
  for (const finding of findings) {
    assert.equal(finding.category, "migration");
    assert.equal(finding.blocking, true, `${finding.ruleId} must block — leftover corpus is never current state`);
    assert.equal(finding.repair, "migration");
    assert.match(finding.message, /migrate plan/);
  }
});

test("repo-level findings fire on collectFindings' repo-wide query only", async () => {
  const repo = tempRepo();
  writeSpec(repo);
  writeDoc(repo, "docs/plans/plan.md", { id: "PLAN-0001", type: "plan", status: "draft", title: "Plan" });

  const repoWide = await collectFindings(repo, { type: "all" });
  assert.ok(repoWide.findings.some((finding) => finding.ruleId === "tracked-execution-doc"));
  assert.ok(repoWide.gates.ran.includes("execution-boundary"));
  assert.ok(repoWide.gates.ran.includes("evidence"));
  assert.ok(!repoWide.gates.skipped.includes("execution-boundary"));

  // Omitted --type spells the same repo view.
  const implicit = await collectFindings(repo, {});
  assert.ok(implicit.findings.some((finding) => finding.ruleId === "tracked-execution-doc"));

  // A narrowed query audits its scope — repo-level gates report as skipped,
  // never as ran, and emit no findings.
  const scoped = await collectFindings(repo, { type: "spec" });
  assert.ok(!scoped.findings.some((finding) => finding.ruleId === "tracked-execution-doc"));
  assert.ok(scoped.gates.skipped.includes("execution-boundary"));
  assert.ok(scoped.gates.skipped.includes("evidence"));
  assert.ok(!scoped.gates.ran.includes("execution-boundary"));

  const dirScoped = await collectFindings(repo, { type: "all", dir: "docs/specs" });
  assert.ok(!dirScoped.findings.some((finding) => finding.ruleId === "tracked-execution-doc"));
  assert.ok(dirScoped.gates.skipped.includes("evidence"));
});

// ---------------------------------------------------------------------------
// lintEvidenceStore
// ---------------------------------------------------------------------------

test("no Evidence Store manifest → no evidence findings (absent coverage is the summary's call)", async () => {
  const repo = knowledgeRepo();
  assert.deepEqual(await evidenceRuleIds(repo), []);
});

test("a record pinned to the live graph and HEAD reports zero findings", async () => {
  const repo = knowledgeRepo();
  putImmutable(repo, await recordFor(repo, gitOut(repo, ["rev-parse", "HEAD"])), { now: () => FIXED_NOW });
  assert.deepEqual(await evidenceRuleIds(repo), []);
});

test("unresolvable claim/check refs surface as blocking evidence findings", async () => {
  const repo = knowledgeRepo();
  const head = gitOut(repo, ["rev-parse", "HEAD"]);
  putImmutable(repo, await recordFor(repo, head, {
    claim: { ref: "SPEC-gone::R-01", documentRevision: sha256Of("ghost") },
    check: { ref: "VD-gone::CHK-01", designRevision: sha256Of("ghost") },
  }), { now: () => FIXED_NOW });

  const findings = await lintEvidenceStore(repo, await modelFor(repo), { now: FIXED_NOW });
  const rules = findings.map((finding) => finding.ruleId).sort();
  assert.deepEqual(rules, ["unresolved-evidence-check", "unresolved-evidence-claim"]);
  for (const finding of findings) {
    assert.equal(finding.category, "evidence");
    assert.equal(finding.severity, "warning");
    assert.equal(finding.blocking, true);
    assert.equal(finding.path, null, "evidence findings name a record, not a file");
    assert.ok(finding.artifactId?.startsWith("EVID-"));
  }
});

test("a record measured on a prior commit reports stale-evidence-subject", async () => {
  const repo = knowledgeRepo();
  const baseline = gitOut(repo, ["rev-parse", "HEAD"]);
  putImmutable(repo, await recordFor(repo, baseline), { now: () => FIXED_NOW });
  // Advance HEAD — the record's subject is still resolvable but no longer
  // the checkout's HEAD subject digest.
  writeFile(repo, "docs/specs/notes.md", "# Notes\n");
  commitAll(repo);

  const rules = await evidenceRuleIds(repo);
  assert.ok(rules.includes("stale-evidence-subject"), `expected stale-evidence-subject, got ${rules}`);
});

test("an unresolvable record subject reports info, never a blocking stale marker", async () => {
  const repo = knowledgeRepo();
  putImmutable(repo, await recordFor(repo, "0123456789abcdef0123456789abcdef01234567"), { now: () => FIXED_NOW });
  const findings = await lintEvidenceStore(repo, await modelFor(repo), { now: FIXED_NOW });
  const subject = findings.find((finding) => finding.ruleId === "unverifiable-evidence-subject");
  assert.ok(subject, "fake commit oid cannot digest-verify");
  assert.equal(subject.severity, "info");
  assert.equal(subject.blocking, false);
});

test("a failed outcome on applicable evidence reports failed-evidence", async () => {
  const repo = knowledgeRepo();
  putImmutable(repo, await recordFor(repo, gitOut(repo, ["rev-parse", "HEAD"]), { outcome: "failed" }), { now: () => FIXED_NOW });
  assert.deepEqual(await evidenceRuleIds(repo), ["failed-evidence"]);
});

test("attestation-only and unverified-artifact records report non-blocking axes", async () => {
  const repo = knowledgeRepo();
  const head = gitOut(repo, ["rev-parse", "HEAD"]);
  putImmutable(repo, await recordFor(repo, head, { artifacts: [] }), { now: () => FIXED_NOW });
  putImmutable(repo, await recordFor(repo, head, {
    artifacts: [{
      uri: "file:logs/pending.txt",
      sha256: sha256Of("pending"),
      availability: "unverified",
      retention: "release",
      expiresAt: null,
    }],
  }), { now: () => FIXED_NOW });

  const findings = await lintEvidenceStore(repo, await modelFor(repo), { now: FIXED_NOW });
  const rules = findings.map((finding) => finding.ruleId).sort();
  assert.deepEqual(rules, ["attestation-only-evidence", "unverified-evidence-artifact"]);
  assert.ok(findings.every((finding) => finding.blocking === false));
});

test("an expired artifact reports evidence-artifact-expired", async () => {
  const repo = knowledgeRepo();
  putImmutable(repo, await recordFor(repo, gitOut(repo, ["rev-parse", "HEAD"]), {
    artifacts: [{
      uri: "file:logs/old.txt",
      sha256: sha256Of("old-log"),
      availability: "available",
      retention: "release",
      expiresAt: "2025-01-01T00:00:00.000Z",
    }],
  }), { now: () => FIXED_NOW });
  assert.deepEqual(await evidenceRuleIds(repo), ["evidence-artifact-expired"]);
});

test("evidence findings reach collectFindings on a repo-wide query", async () => {
  const repo = knowledgeRepo();
  putImmutable(repo, await recordFor(repo, gitOut(repo, ["rev-parse", "HEAD"]), {
    claim: { ref: "SPEC-gone::R-01", documentRevision: sha256Of("ghost") },
  }), { now: () => FIXED_NOW });

  const collected = await collectFindings(repo, { type: "all" });
  assert.ok(collected.findings.some((finding) => finding.ruleId === "unresolved-evidence-claim"));

  const scoped = await collectFindings(repo, { type: "spec" });
  assert.ok(!scoped.findings.some((finding) => finding.ruleId === "unresolved-evidence-claim"));
});

test("an unauthorized external state root fails closed, never silently skipped", async () => {
  const repo = knowledgeRepo();
  const outside = tempRepo("external-state-");
  await assert.rejects(
    collectFindings(repo, { type: "all", stateRoot: outside }),
    (error: unknown) => {
      assert.ok(error instanceof StoreError || error instanceof Error);
      assert.match((error as Error).message, /external|allowExternalRoot|state root/i);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// CLI surface — the generated bundles expose the same repo-level gates
// ---------------------------------------------------------------------------

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function runScript(skill: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, skill, "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("doc_status lint surfaces tracked execution docs repo-wide, never scoped", () => {
  const repo = tempRepo();
  writeSpec(repo);
  writeDoc(repo, "docs/plans/plan.md", { id: "PLAN-0001", type: "plan", status: "draft", title: "Plan" });

  const repoWide = runScript("doc-status", "doc_status.js", ["lint", "--type", "all", "--json"], repo);
  assert.equal(repoWide.status, 0, repoWide.stderr);
  const wideReport = JSON.parse(repoWide.stdout);
  assert.ok(wideReport.findings.some((finding: any) => finding.ruleId === "tracked-execution-doc"));
  assert.ok(wideReport.gates.ran.includes("execution-boundary"));
  assert.ok(wideReport.gates.ran.includes("evidence"));

  const scoped = runScript("doc-status", "doc_status.js", ["lint", "--type", "spec", "--json"], repo);
  assert.equal(scoped.status, 0, scoped.stderr);
  const scopedReport = JSON.parse(scoped.stdout);
  assert.ok(!scopedReport.findings.some((finding: any) => finding.ruleId === "tracked-execution-doc"));
  assert.ok(scopedReport.gates.skipped.includes("execution-boundary"));
  assert.ok(scopedReport.gates.skipped.includes("evidence"));
});

test("doc_status --state-root reaches the Evidence Store and --allow-external-root fails closed", () => {
  const repo = knowledgeRepo();
  const outside = tempRepo("external-state-");

  // An external root without --allow-external-root is refused, not ignored.
  const refused = runScript("doc-status", "doc_status.js",
    ["lint", "--type", "all", "--state-root", outside, "--json"], repo);
  assert.notEqual(refused.status, 0, "unauthorized external root must fail closed");
  assert.match(refused.stderr + refused.stdout, /external|allow-external-root|state root/i);

  // The explicit opt-in makes the (empty) external store an accepted scope.
  const allowed = runScript("doc-status", "doc_status.js",
    ["lint", "--type", "all", "--state-root", outside, "--allow-external-root", "--json"], repo);
  assert.equal(allowed.status, 0, allowed.stderr);
});
