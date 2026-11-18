// Evidence Assessment + Verification Summary v1 (Issue #241) — contract tests.
//
// An Evidence Record (#240) is the immutable measured outcome; an
// EvidenceAssessment is the derived judgment of whether that outcome still
// speaks for the declared target; a VerificationSummary is the pure
// per-claim/check aggregate the Verification Gate consumes. These tests pin
// every axis transition, the exemption contracts (waivers + conditional
// out-of-scope verdicts), fail-closed behavior, and the checkout-bound
// integration the router's auto-computed summary relies on.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  documentRevisionOf,
  getById,
  putImmutable,
  resolveCommitSubject,
} from "../src/skills/lib/evidence_store";
import type { EvidenceRecordV1, EvidenceSubject } from "../src/skills/lib/evidence_store";
import {
  resolveCheckReference,
  scanKnowledgeGraph,
} from "../src/skills/lib/knowledge_graph";
import type { KnowledgeGraph } from "../src/skills/lib/knowledge_graph";
import {
  assessEvidence,
  assessEvidenceIn,
  buildVerificationSummary,
  buildVerificationSummaryIn,
  normalizeTarget,
  validateVerificationSummary,
} from "../src/skills/lib/verification_assessment";
import type {
  AssessmentTarget,
  SummaryDependencies,
  VerificationSummaryInput,
} from "../src/skills/lib/verification_assessment";
import { checkDesignRevision } from "../src/skills/lib/verification_checks";
import type { VerificationCheckV1 } from "../src/skills/lib/verification_checks";
import { approvePlan, createRun, initStateRoot } from "../src/skills/lib/execution_store";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
const cli = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "evidence_store.js");
const routeCli = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "route_graph.js");
const graphYaml = path.join(skillRoot, "doc-driven-dev-graph", "graphs", "doc-driven-dev.yaml");

const NOW = "2026-02-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";
const PAST = "2025-01-01T00:00:00.000Z";

// Workspace snapshot digests are attested digests the adapter supplies —
// any well-formed sha256:<hex> literal works as a fixture value.
function sha256Of(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`;
}
const SNAP_A = sha256Of("workspace-snapshot-A");
const SNAP_B = sha256Of("workspace-snapshot-B");

function tempRepo(prefix = "verification-summary-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function writeDoc(repo: string, relPath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-01-01",
    updated: "2026-01-01",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

// A spec carrying claim anchors — `<!-- claim:R-NN -->` in the body.
function writeSpec(repo: string, claims: string[], id = "SPEC-abcd"): void {
  writeDoc(repo, "docs/specs/spec.md", {
    id, type: "spec", status: "approved", title: "Spec",
  }, ["# Spec", "", ...claims.map((claim) => `<!-- claim:${claim} --> Requirement ${claim}`), ""].join("\n"));
}

type VdCheck = {
  id: string;
  target: string;
  method?: string;
  required?: boolean;
  implementation?: string;
};

// A verification document carrying a `checks:` design inventory.
function writeVerification(repo: string, checks: VdCheck[], id = "VD-efgh"): void {
  const entries = checks.map((check) => {
    const method = check.method ?? "unit";
    const criteriaField: Record<string, string> = {
      unit: "expect", integration: "expect", e2e: "expect",
      property: "invariant", static: "rule", "model-checking": "property",
      "formal-proof": "theorem", "runtime-monitoring": "signal", "manual-review": "checklistItem",
    };
    const field = criteriaField[method] ?? "expect";
    return {
      id: check.id,
      target: check.target,
      method,
      implementation: check.implementation ?? "pnpm test",
      preconditions: ["spec exists"],
      passCriteria: { kind: method, [field]: `criterion for ${check.id}` },
      limitations: [],
      required: check.required ?? true,
    };
  });
  writeDoc(repo, "docs/verification/vd.md", {
    id, type: "verification", status: "approved", title: "Design", checks: entries,
  }, "# Verification Design\n\n## Checks\n");
}

// Commit the fixture so HEAD exists for commit-subject tests.
function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);
}

function knowledgeRepo(options: {
  checks?: VdCheck[];
  claims?: string[];
  gitInit?: boolean;
} = {}): string {
  const repo = tempRepo();
  writeSpec(repo, options.claims ?? ["R-01"]);
  writeVerification(repo, options.checks ?? [{ id: "CHK-01", target: "SPEC-abcd::R-01" }]);
  if (options.gitInit === true) {
    git(repo, ["init", "-q"]);
    // The Evidence Store refuses writes unless .apm/state/ is git-ignored —
    // initStateRoot writes the managed block; committing it mirrors a real repo.
    initStateRoot(repo);
    commitAll(repo);
  }
  return repo;
}

function specRevision(repo: string): string {
  return documentRevisionOf(fs.readFileSync(path.join(repo, "docs/specs/spec.md"), "utf8"));
}

function checkRevision(graph: KnowledgeGraph, ref: string): string {
  const resolution = resolveCheckReference(graph, ref);
  assert.equal(resolution.status, "resolved", `${ref} must resolve in the fixture graph`);
  return resolution.check.designRevision;
}

// A record pinned to the LIVE fixture revisions — the well-formed baseline
// every drift test perturbs one field of.
function recordFor(repo: string, graph: KnowledgeGraph, overrides: Partial<EvidenceRecordV1> = {}): EvidenceRecordV1 {
  return {
    schemaVersion: 1,
    evidenceId: "EVID-0001",
    claim: { ref: "SPEC-abcd::R-01", documentRevision: specRevision(repo) },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkRevision(graph, "VD-efgh::CHK-01") },
    subject: { kind: "workspace", snapshotDigest: SNAP_A },
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
    derivedFrom: null,
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

// Hermetic summary deps: documents read from the fixture checkout, commit
// subjects resolved through a digest map (workspace subjects carry their
// attested digest). `digests` maps commit oid → canonical subject digest.
function depsFor(repo: string, digests: Record<string, string> = {}): SummaryDependencies {
  return {
    readDocument: (docPath) => {
      try {
        return fs.readFileSync(path.join(repo, docPath), "utf8");
      } catch {
        return null;
      }
    },
    resolveSubjectDigest: (subject: EvidenceSubject) =>
      subject.kind === "workspace" ? subject.snapshotDigest : digests[subject.commit] ?? null,
  };
}

function workspaceTarget(digest: string | null = SNAP_A): { subject: EvidenceSubject; subjectDigest: string | null } {
  return { subject: { kind: "workspace", snapshotDigest: digest ?? sha256Of("unnamed") }, subjectDigest: digest };
}

async function summarize(repo: string, input: Partial<VerificationSummaryInput> = {}) {
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const records = input.records ?? [];
  return buildVerificationSummaryIn(graph, {
    subject: { kind: "workspace", snapshotDigest: SNAP_A },
    subjectDigest: SNAP_A,
    records,
    now: NOW,
    ...input,
  }, depsFor(repo));
}

function assessedFor(summary: Awaited<ReturnType<typeof summarize>>, checkRef: string) {
  const check = summary.checks.find((entry) => entry.ref === checkRef);
  assert.ok(check !== undefined, `check ${checkRef} must be in scope`);
  return check;
}

function reasonCodes(assessment: { reasons: { code: string }[] }): string[] {
  return assessment.reasons.map((reason) => reason.code);
}

// ---------------------------------------------------------------------------
// EvidenceAssessment — per-record axes
// ---------------------------------------------------------------------------

test("applicable passed record with digest-verified artifacts is sufficient", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph);
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "applicable");
  assert.equal(assessment.availability, "available");
  assert.equal(assessment.integrity, "verified");
  assert.equal(assessment.assessment, "sufficient");
  assert.deepEqual(assessment.reasons, []);
});

test("claim document revision drift makes the record not-applicable", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph);
  // The spec moves on after measurement — the pinned documentRevision is stale.
  writeSpec(repo, ["R-01"]);
  fs.appendFileSync(path.join(repo, "docs/specs/spec.md"), "Extra requirement text.\n");
  const freshGraph = await scanKnowledgeGraph({ cwd: repo });
  const assessment = assessEvidenceIn(freshGraph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "not-applicable");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("claim-revision-mismatch"));
});

test("check design revision drift makes the record not-applicable", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph);
  writeVerification(repo, [{ id: "CHK-01", target: "SPEC-abcd::R-01", implementation: "pnpm test --strict" }]);
  const freshGraph = await scanKnowledgeGraph({ cwd: repo });
  const assessment = assessEvidenceIn(freshGraph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "not-applicable");
  assert.ok(reasonCodes(assessment).includes("check-revision-mismatch"));
});

test("a check no longer targeting the credited claim is not-applicable", async () => {
  const repo = knowledgeRepo({ claims: ["R-01", "R-02"] });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph);
  writeVerification(repo, [{ id: "CHK-01", target: "SPEC-abcd::R-02" }]);
  const freshGraph = await scanKnowledgeGraph({ cwd: repo });
  const assessment = assessEvidenceIn(freshGraph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "not-applicable");
  assert.ok(reasonCodes(assessment).includes("check-target-mismatch"));
});

test("a method other than the designed method is not-applicable and integrity-invalid", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, { method: "e2e" });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "not-applicable");
  assert.equal(assessment.integrity, "invalid");
  assert.ok(reasonCodes(assessment).includes("method-mismatch"));
});

test("a subject digest different from the target is not-applicable", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph); // measured at SNAP_A
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(SNAP_B), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "not-applicable");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("subject-mismatch"));
});

test("unresolvable claim and check references make applicability unknown", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, {
    claim: { ref: "SPEC-gone::R-01", documentRevision: sha256Of("x") },
    check: { ref: "VD-gone::CHK-01", designRevision: sha256Of("y") },
  });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "unknown");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("claim-unresolved"));
  assert.ok(reasonCodes(assessment).includes("check-unresolved"));
});

test("an unverifiable target subject makes every record indeterminate", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph);
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(null), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "unknown");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("target-unverifiable"));
});

test("a record subject that cannot be digested is subject-unverifiable", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const oid = "0123456789abcdef0123456789abcdef01234567";
  const record = recordFor(repo, graph, { subject: { kind: "commit", commit: oid } });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "unknown");
  assert.ok(reasonCodes(assessment).includes("subject-unverifiable"));
});

test("a dead artifact reference is unavailable and integrity-invalid", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, {
    artifacts: [{ uri: "s3:ci/build-logs.zip", sha256: null, availability: "unavailable", retention: "release", expiresAt: null }],
  });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.availability, "unavailable");
  assert.equal(assessment.integrity, "invalid");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("artifact-unavailable"));
});

test("an artifact past its expiresAt deadline is unavailable and integrity-invalid", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, {
    artifacts: [{ uri: "run:ci/123", sha256: sha256Of("log"), availability: "available", retention: "transient", expiresAt: PAST }],
  });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.availability, "unavailable");
  assert.equal(assessment.integrity, "invalid");
  assert.ok(reasonCodes(assessment).includes("artifact-expired"));
});

test("an unfetched artifact keeps a passed outcome indeterminate", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, {
    artifacts: [{ uri: "https://ci.example.test/log/1", sha256: null, availability: "unverified", retention: "release", expiresAt: null }],
  });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.availability, "unknown");
  assert.equal(assessment.integrity, "unverified");
  assert.equal(assessment.assessment, "indeterminate");
  assert.ok(reasonCodes(assessment).includes("artifact-unverified"));
});

test("an attestation-only record (no artifacts) is unverified, never sufficient", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, { artifacts: [] });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.availability, "available");
  assert.equal(assessment.integrity, "unverified");
  assert.equal(assessment.assessment, "indeterminate");
  // The indeterminate judgment names why — an attestation-only outcome
  // must never land with an empty reasons list.
  assert.ok(reasonCodes(assessment).includes("attestation-only"));
});

test("an applicable measured failure is insufficient", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const record = recordFor(repo, graph, { outcome: "failed" });
  const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
  assert.equal(assessment.applicability, "applicable");
  assert.equal(assessment.assessment, "insufficient");
  assert.ok(reasonCodes(assessment).includes("outcome-failed"));
});

test("inconclusive outcomes are indeterminate, never sufficient or insufficient", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  for (const outcome of ["inconclusive", "error", "not-run"] as const) {
    const record = recordFor(repo, graph, { outcome });
    const assessment = assessEvidenceIn(graph, record, workspaceTarget(), { ...depsFor(repo), now: NOW });
    assert.equal(assessment.assessment, "indeterminate", outcome);
    assert.ok(reasonCodes(assessment).includes("outcome-not-passed"), outcome);
  }
});

// ---------------------------------------------------------------------------
// VerificationSummary — coverage classification
// ---------------------------------------------------------------------------

test("a satisfied required check covers its claim; the summary validates and round-trips", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, { records: [recordFor(repo, graph)] });
  assert.equal(summary.verdict, "verified");
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "satisfied");
  assert.equal(summary.claims[0].status, "covered");
  assert.equal(summary.counts.checks.satisfied, 1);
  assert.equal(validateVerificationSummary(JSON.parse(JSON.stringify(summary))), true);
});

test("partial coverage is partial — one satisfied check never covers a claim needing two", async () => {
  const repo = knowledgeRepo({
    claims: ["R-01"],
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01" },
      { id: "CHK-02", target: "SPEC-abcd::R-01" },
    ],
  });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, { records: [recordFor(repo, graph)] });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "satisfied");
  assert.equal(assessedFor(summary, "VD-efgh::CHK-02").status, "undetermined");
  assert.equal(summary.claims[0].status, "partial");
  assert.equal(summary.verdict, "indeterminate");
  assert.ok(summary.reasons.includes("required-check-undetermined:VD-efgh::CHK-02"));
  assert.ok(summary.reasons.includes("claim-partial:SPEC-abcd::R-01"));
});

test("an unexecuted required check is undetermined — never silently out-of-scope", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo);
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.executed, false);
  assert.equal(check.status, "undetermined");
  assert.ok(check.reasons.includes("unexecuted"));
  assert.equal(summary.claims[0].status, "uncovered");
  assert.equal(summary.verdict, "indeterminate");
});

test("the newest conclusive applicable assessment decides check status", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  // Older failure superseded by a newer pass → satisfied.
  const older = recordFor(repo, graph, { evidenceId: "EVID-old", outcome: "failed", createdAt: "2026-01-10T00:00:00.000Z" });
  const newer = recordFor(repo, graph, { evidenceId: "EVID-new", createdAt: "2026-01-20T00:00:00.000Z" });
  let summary = await summarize(repo, { records: [older, newer] });
  const satisfied = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(satisfied.status, "satisfied");
  assert.deepEqual(satisfied.evidence.insufficient, ["EVID-old"]);
  assert.deepEqual(satisfied.evidence.sufficient, ["EVID-new"]);
  assert.equal(satisfied.latestConclusiveAt, "2026-01-20T00:00:00.000Z");
  // Newer failure supersedes the older pass → failed.
  summary = await summarize(repo, {
    records: [
      recordFor(repo, graph, { evidenceId: "EVID-old", createdAt: "2026-01-10T00:00:00.000Z" }),
      recordFor(repo, graph, { evidenceId: "EVID-new", outcome: "failed", createdAt: "2026-01-20T00:00:00.000Z" }),
    ],
  });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "failed");
  assert.equal(summary.verdict, "failed");
});

test("indeterminate-only evidence keeps the check undetermined but recorded", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const stale = recordFor(repo, graph, { evidenceId: "EVID-stale", subject: { kind: "workspace", snapshotDigest: SNAP_B } });
  const summary = await summarize(repo, { records: [stale] });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.executed, false);
  assert.equal(check.status, "undetermined");
  assert.ok(check.reasons.includes("indeterminate-evidence"));
  assert.deepEqual(check.evidence.indeterminate, ["EVID-stale"]);
  assert.equal(summary.verdict, "indeterminate");
});

test("records for out-of-scope checks never enter the summary's evidence list", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const foreign = recordFor(repo, graph, { check: { ref: "VD-other::CHK-99", designRevision: sha256Of("x") } });
  const summary = await summarize(repo, { records: [foreign] });
  assert.equal(summary.evidence.length, 0);
  assert.equal(summary.counts.evidence.total, 0);
});

test("an explicit unresolvable check ref stays in scope as unresolved", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { checks: ["VD-efgh::CHK-01", "VD-nope::CHK-09"] });
  const unresolved = assessedFor(summary, "VD-nope::CHK-09");
  assert.equal(unresolved.status, "unresolved");
  assert.equal(unresolved.required, true, "an unnamed check gates as required — coverage is unprovable");
  assert.equal(summary.verdict, "indeterminate");
  assert.ok(summary.reasons.includes("required-check-unresolved:VD-nope::CHK-09"));
});

test("records crediting an unresolved check still land in its evidence bucket", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  // A record exists for the check — it was assessed (unresolvable ⇒
  // indeterminate) and must be attributed, never swallowed by the
  // unresolved status.
  const record = recordFor(repo, graph, {
    check: { ref: "VD-nope::CHK-09", designRevision: sha256Of("foreign-design") },
  });
  const summary = await summarize(repo, { checks: ["VD-nope::CHK-09"], records: [record] });
  const check = assessedFor(summary, "VD-nope::CHK-09");
  assert.equal(check.status, "unresolved");
  assert.deepEqual(check.evidence.indeterminate, ["EVID-0001"]);
  assert.equal(summary.evidence.length, 1);
  assert.equal(summary.evidence[0].check, "VD-nope::CHK-09");
  assert.equal(summary.counts.evidence.indeterminate, 1);
});

test("advisory checks are classified but never gate the verdict", async () => {
  const repo = knowledgeRepo({
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01" },
      { id: "CHK-02", target: "SPEC-abcd::R-01", required: false },
    ],
  });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, { records: [recordFor(repo, graph)] });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-02").status, "undetermined");
  assert.equal(summary.counts.checks.advisory, 1);
  assert.equal(summary.claims[0].status, "covered", "advisory residue never blocks coverage");
  assert.equal(summary.verdict, "verified");
});

test("a checked-failed advisory check reports failed without gating", async () => {
  const repo = knowledgeRepo({
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01" },
      { id: "CHK-02", target: "SPEC-abcd::R-01", required: false },
    ],
  });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const failing = recordFor(repo, graph, {
    evidenceId: "EVID-fail",
    check: { ref: "VD-efgh::CHK-02", designRevision: checkRevision(graph, "VD-efgh::CHK-02") },
    outcome: "failed",
  });
  const summary = await summarize(repo, { records: [recordFor(repo, graph), failing] });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-02").status, "failed");
  assert.equal(summary.verdict, "verified", "a measured advisory failure is reported, never gated on");
});

test("a malformed check inventory fails closed — never a vacuous verified", async () => {
  const repo = knowledgeRepo();
  // A broken checks: entry beside the valid one: the scan drops it, but the
  // graph issue means the declared inventory could not be fully read.
  const vdPath = path.join(repo, "docs/verification/vd.md");
  const text = fs.readFileSync(vdPath, "utf8");
  fs.writeFileSync(vdPath, text.replace("  - id: CHK-01\n", "  - broken-entry\n  - id: CHK-01\n"), "utf8");
  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.ok(graph.issues.some((issue) => issue.code === "malformed-check-entry"), "fixture must trip the check parser");
  const summary = await summarize(repo, { records: [recordFor(repo, graph)] });
  assert.equal(summary.verdict, "indeterminate");
  assert.ok(summary.reasons.some((reason) => reason.startsWith("check-design-invalid:malformed-check-entry:")));
});

test("an empty check scope verifies with an explicit no-required-coverage reason", async () => {
  const repo = tempRepo();
  writeSpec(repo, ["R-01"]);
  const summary = await summarize(repo, { checks: [] });
  assert.equal(summary.verdict, "verified");
  assert.ok(summary.reasons.includes("no-required-coverage"));
});

test("a null target digest fails the whole summary closed as indeterminate", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, {
    subject: { kind: "workspace", snapshotDigest: SNAP_A },
    subjectDigest: null,
    records: [recordFor(repo, graph)],
  });
  assert.equal(summary.verdict, "indeterminate");
  assert.ok(summary.reasons.includes("target-unverifiable"));
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "undetermined");
});

test("multiple claims scope from their checks' targets", async () => {
  const repo = knowledgeRepo({
    claims: ["R-01", "R-02"],
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01" },
      { id: "CHK-02", target: "SPEC-abcd::R-02" },
    ],
  });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const second = recordFor(repo, graph, {
    evidenceId: "EVID-r02",
    claim: { ref: "SPEC-abcd::R-02", documentRevision: specRevision(repo) },
    check: { ref: "VD-efgh::CHK-02", designRevision: checkRevision(graph, "VD-efgh::CHK-02") },
  });
  const summary = await summarize(repo, { records: [recordFor(repo, graph), second] });
  assert.deepEqual(summary.scope.claims, ["SPEC-abcd::R-01", "SPEC-abcd::R-02"]);
  assert.equal(summary.claims.every((claim) => claim.status === "covered"), true);
  assert.equal(summary.verdict, "verified");
});

// ---------------------------------------------------------------------------
// Exemptions — waivers and conditional out-of-scope verdicts
// ---------------------------------------------------------------------------

const VALID_NA = {
  check: "VD-efgh::CHK-01",
  revision: "sha256:abc",
  paths: ["src/unrelated.ts"],
  rule: "changed-paths-not-under-check-precondition",
  judger: "impact-analyzer",
  method: "path-scope",
  reason: "the change touches no code the check measures",
};

function validWaiver(overrides: Record<string, unknown> = {}) {
  return {
    scope: { kind: "check", ref: "VD-efgh::CHK-01" },
    authority: "release-manager",
    reason: "external audit already covered this check",
    grantedAt: "2026-01-20T00:00:00.000Z",
    expiresAt: FUTURE,
    ...overrides,
  };
}

test("a validated not-applicable verdict puts an unexecuted check out of scope", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { notApplicable: [VALID_NA] });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "out-of-scope");
  assert.equal(check.notApplicable?.status, "applied");
  assert.equal(summary.claims[0].status, "covered");
  assert.equal(summary.verdict, "verified");
});

test("a malformed not-applicable verdict is rejected — the check stays undetermined", async () => {
  const repo = knowledgeRepo();
  for (const broken of [
    { ...VALID_NA, judger: "" },
    { ...VALID_NA, paths: [] },
    { check: "VD-efgh::CHK-01" },
  ]) {
    const summary = await summarize(repo, { notApplicable: [broken] });
    const check = assessedFor(summary, "VD-efgh::CHK-01");
    assert.equal(check.status, "undetermined", JSON.stringify(broken));
    assert.equal(check.notApplicable?.status, "rejected");
    assert.ok(check.notApplicable?.reasons.includes("not-applicable-malformed"));
    assert.equal(summary.rejectedNotApplicable.length, 1);
    assert.equal(summary.verdict, "indeterminate");
  }
});

test("a not-applicable verdict naming an unresolvable check is rejected", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { notApplicable: [{ ...VALID_NA, check: "VD-gone::CHK-01" }] });
  assert.equal(summary.rejectedNotApplicable.length, 1);
  assert.ok(summary.rejectedNotApplicable[0].reasons.includes("not-applicable-check-unresolved"));
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "undetermined");
});

test("a trusted-authority check waiver exempts an unexecuted check", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [validWaiver()],
    waiverAuthorities: ["release-manager"],
  });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "waived");
  assert.equal(check.waiver?.status, "applied");
  assert.equal(summary.verdict, "verified");
  assert.equal(summary.rejectedWaivers.length, 0);
});

test("a claim-scope waiver covers every required check targeting the claim", async () => {
  const repo = knowledgeRepo({
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01" },
      { id: "CHK-02", target: "SPEC-abcd::R-01" },
    ],
  });
  const summary = await summarize(repo, {
    waivers: [validWaiver({ scope: { kind: "claim", ref: "SPEC-abcd::R-01" } })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "waived");
  assert.equal(assessedFor(summary, "VD-efgh::CHK-02").status, "waived");
  assert.equal(summary.verdict, "verified");
});

test("a waiver from an untrusted authority is rejected, never applied", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [validWaiver({ authority: "intern" })],
    waiverAuthorities: ["release-manager"],
  });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "undetermined");
  assert.equal(check.waiver?.status, "rejected");
  assert.ok(check.waiver?.reasons.includes("waiver-untrusted-authority"));
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.equal(summary.verdict, "indeterminate");
});

test("no authority allowlist means every waiver rejects — fail closed", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { waivers: [validWaiver()] });
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.ok(summary.rejectedWaivers[0].reasons.includes("waiver-untrusted-authority"));
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "undetermined");
});

test("an expired waiver is rejected and reported", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [validWaiver({ expiresAt: PAST })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.ok(summary.rejectedWaivers[0].reasons.includes("waiver-expired"));
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "undetermined");
});

test("a waiver whose expiry precedes its grant is malformed-window rejected", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    // expiresAt is still future at the assessment instant but precedes the
    // recorded grant — an impossible window, rejected on its own code.
    waivers: [validWaiver({ grantedAt: "2026-03-01T00:00:00.000Z", expiresAt: "2026-02-15T00:00:00.000Z" })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.deepEqual(summary.rejectedWaivers[0].reasons, ["waiver-invalid-window"]);
});

test("a waiver scoping an unresolvable ref is rejected", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [validWaiver({ scope: { kind: "check", ref: "VD-gone::CHK-99" } })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.ok(summary.rejectedWaivers[0].reasons.includes("waiver-scope-unresolved"));
});

test("a malformed waiver candidate rejects as data — never throws, never casts", async () => {
  const repo = knowledgeRepo();
  for (const broken of [
    { bad: true },                          // no scope at all
    { scope: { kind: "check", ref: "VD-efgh::CHK-01" } }, // scope only — every other field missing
    { scope: "not-an-object" },             // unreadable scope
    "a string is not a waiver",
    42,
    null,
  ]) {
    const summary = await summarize(repo, { waivers: [broken], waiverAuthorities: ["release-manager"] });
    assert.equal(summary.rejectedWaivers.length, 1, JSON.stringify(broken));
    const entry = summary.rejectedWaivers[0];
    // The malformed candidate is recorded verbatim — never cast into the
    // contract shape; `verdict` stays null and `input` is the audit copy.
    assert.equal(entry.waiver, null, JSON.stringify(broken));
    assert.deepEqual(entry.input, broken);
    assert.deepEqual(entry.reasons, ["waiver-malformed"]);
    assert.equal(summary.verdict, "indeterminate");
    assert.ok(validateVerificationSummary(JSON.parse(JSON.stringify(summary))), JSON.stringify(broken));
  }
});

test("a malformed waiver that spells a readable scope attaches its refusal to that check", async () => {
  const repo = knowledgeRepo();
  const broken = { scope: { kind: "check", ref: "VD-efgh::CHK-01" } };
  const summary = await summarize(repo, { waivers: [broken], waiverAuthorities: ["release-manager"] });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "undetermined");
  assert.equal(check.waiver?.status, "rejected");
  assert.equal(check.waiver?.verdict, null, "a malformed candidate never produces a contract-shaped verdict");
  assert.deepEqual(check.waiver?.input, broken);
  assert.ok(check.waiver?.reasons.includes("waiver-malformed"));
  assert.ok(summary.reasons.includes("rejected-waiver:VD-efgh::CHK-01"));
  assert.equal(validateVerificationSummary(JSON.parse(JSON.stringify(summary))), true);
});

test("a waiver scope with no readable ref reports an unidentified rejection", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { waivers: [{ bad: true }], waiverAuthorities: ["release-manager"] });
  assert.ok(summary.reasons.includes("rejected-waiver:unidentified"));
});

test("a summary carrying rejected malformed exemptions round-trips through the boundary validator", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [{ bad: true }, validWaiver({ authority: "intern" })],
    waiverAuthorities: ["release-manager"],
    notApplicable: [{ check: "VD-efgh::CHK-01" }, { bad: true }],
  });
  assert.equal(summary.rejectedWaivers.length, 2);
  assert.equal(summary.rejectedWaivers[0].waiver, null);
  assert.notEqual(summary.rejectedWaivers[1].waiver, null, "shape-valid refusals keep their validated verdict");
  assert.equal(summary.rejectedNotApplicable.length, 2);
  assert.equal(summary.rejectedNotApplicable[0].verdict, null);
  assert.equal(summary.rejectedNotApplicable[1].verdict, null);
  // The emitted file must satisfy the same validator route_graph reads —
  // a recorded rejection can never poison the summary that carries it.
  assert.equal(validateVerificationSummary(JSON.parse(JSON.stringify(summary))), true);
});

test("a rejected entry with a null verdict but no malformed reason fails the boundary", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, { waivers: [{ bad: true }] });
  const forged = JSON.parse(JSON.stringify(summary)) as Record<string, unknown>;
  (forged.rejectedWaivers as { reasons: string[] }[])[0].reasons = ["waiver-expired"];
  assert.equal(validateVerificationSummary(forged), false,
    "a null waiver verdict is only honest under the malformed reason");
});

test("a duplicate waiver for the same scope is shadowed — and audited, never dropped silently", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    waivers: [validWaiver(), validWaiver({ reason: "a second, redundant grant" })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "waived");
  assert.equal(summary.shadowedExemptions.length, 1);
  const shadow = summary.shadowedExemptions[0];
  assert.equal(shadow.kind, "waiver");
  assert.deepEqual(shadow.scope, { kind: "check", ref: "VD-efgh::CHK-01" });
  assert.ok(summary.reasons.includes("shadowed-exemption:waiver:VD-efgh::CHK-01"));
  assert.equal(validateVerificationSummary(JSON.parse(JSON.stringify(summary))), true);
});

test("a rejected waiver shadows a later applied one — the loser is still audited", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    // The expired entry owns the scope (deterministic input order); the
    // valid waiver it hides is applied-but-shadowed.
    waivers: [validWaiver({ expiresAt: PAST }), validWaiver()],
    waiverAuthorities: ["release-manager"],
  });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "undetermined");
  assert.equal(check.waiver?.status, "rejected");
  assert.equal(summary.rejectedWaivers.length, 1);
  assert.equal(summary.shadowedExemptions.length, 1);
  assert.equal(summary.shadowedExemptions[0].kind, "waiver");
  assert.equal(summary.verdict, "indeterminate");
});

test("a duplicate not-applicable verdict for the same check is shadowed and audited", async () => {
  const repo = knowledgeRepo();
  const summary = await summarize(repo, {
    notApplicable: [VALID_NA, { ...VALID_NA, reason: "a second analysis" }],
  });
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "out-of-scope");
  assert.equal(summary.shadowedExemptions.length, 1);
  assert.equal(summary.shadowedExemptions[0].kind, "not-applicable");
  assert.deepEqual(summary.shadowedExemptions[0].scope, { kind: "check", ref: "VD-efgh::CHK-01" });
  assert.ok(summary.reasons.includes("shadowed-exemption:not-applicable:VD-efgh::CHK-01"));
});

test("waiver expiry boundaries: expiry AT the instant is expired, expiry at grant is a malformed window", async () => {
  const repo = knowledgeRepo();
  // expiresAt === now → expired (the deadline must be in the future).
  let summary = await summarize(repo, {
    waivers: [validWaiver({ expiresAt: NOW })],
    waiverAuthorities: ["release-manager"],
  });
  assert.deepEqual(summary.rejectedWaivers[0].reasons, ["waiver-expired"]);
  // expiresAt === grantedAt → an impossible window.
  summary = await summarize(repo, {
    waivers: [validWaiver({ grantedAt: FUTURE, expiresAt: FUTURE })],
    waiverAuthorities: ["release-manager"],
  });
  assert.deepEqual(summary.rejectedWaivers[0].reasons, ["waiver-invalid-window"]);
  // One millisecond past the instant is a live deadline → applied.
  summary = await summarize(repo, {
    waivers: [validWaiver({ expiresAt: "2026-02-01T00:00:00.001Z" })],
    waiverAuthorities: ["release-manager"],
  });
  assert.equal(summary.rejectedWaivers.length, 0);
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "waived");
});

test("a measured failure stays failed under a valid waiver — exemptions never rewrite reality", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, {
    records: [recordFor(repo, graph, { outcome: "failed" })],
    waivers: [validWaiver()],
    waiverAuthorities: ["release-manager"],
  });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "failed", "the newest conclusive measurement outranks any exemption");
  assert.equal(check.waiver?.status, "applied", "the valid waiver is still reported as evaluated");
  assert.equal(summary.claims[0].status, "failed");
  assert.equal(summary.verdict, "failed");
});

test("a measured pass outranks an exemption — the check reports satisfied, not waived", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const summary = await summarize(repo, {
    records: [recordFor(repo, graph)],
    notApplicable: [VALID_NA],
    waivers: [validWaiver()],
    waiverAuthorities: ["release-manager"],
  });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "satisfied");
  assert.equal(check.executed, true);
  assert.equal(summary.verdict, "verified");
});

// ---------------------------------------------------------------------------
// Method-derived constraints (#241): manual-review / runtime-monitoring
// ---------------------------------------------------------------------------

test("manual-review and runtime-monitoring checks carry their gate-visible constraints", async () => {
  const repo = knowledgeRepo({
    checks: [
      { id: "CHK-01", target: "SPEC-abcd::R-01", method: "manual-review" },
      { id: "CHK-02", target: "SPEC-abcd::R-01", method: "runtime-monitoring" },
    ],
  });
  const summary = await summarize(repo);
  assert.deepEqual(
    assessedFor(summary, "VD-efgh::CHK-01").constraints.map((constraint) => constraint.kind),
    ["manual-review"],
  );
  assert.deepEqual(
    assessedFor(summary, "VD-efgh::CHK-02").constraints.map((constraint) => constraint.kind),
    ["monitoring-continuous"],
  );
});

// ---------------------------------------------------------------------------
// Checkout-bound integration — real git subjects
// ---------------------------------------------------------------------------

test("buildVerificationSummary binds a commit subject to HEAD and normalizes its oid", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  putImmutable(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: head.commitOid } }),
    createdAt: "2026-01-15T00:00:00.000Z",
  });
  const summary = await buildVerificationSummary(repo, {
    subject: { kind: "commit", commit: "HEAD" },
    now: NOW,
  });
  assert.equal(summary.target.subject.kind, "commit");
  if (summary.target.subject.kind === "commit") {
    assert.equal(summary.target.subject.commit, head.commitOid, "revspec spellings normalize to the full oid");
  }
  assert.equal(summary.target.subjectDigest, head.subjectDigest);
  assert.equal(assessedFor(summary, "VD-efgh::CHK-01").status, "satisfied");
  assert.equal(summary.verdict, "verified");
});

test("a commit after measurement makes stored evidence not-applicable for the new HEAD", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const measured = resolveCommitSubject(repo, "HEAD");
  assert.ok(measured !== null);
  putImmutable(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: measured.commitOid } }),
    createdAt: "2026-01-15T00:00:00.000Z",
  });
  // A new commit advances HEAD — the record measured the old tree.
  fs.writeFileSync(path.join(repo, "src.ts"), "export const x = 1;\n");
  commitAll(repo);
  const summary = await buildVerificationSummary(repo, { subject: { kind: "commit", commit: "HEAD" }, now: NOW });
  const check = assessedFor(summary, "VD-efgh::CHK-01");
  assert.equal(check.status, "undetermined");
  assert.deepEqual(check.evidence.indeterminate, ["EVID-0001"]);
  const assessment = summary.evidence[0];
  assert.equal(assessment.applicability, "not-applicable");
  assert.ok(reasonCodes(assessment).includes("subject-mismatch"));
  assert.equal(summary.verdict, "indeterminate");
});

test("assessEvidence derives the same axes against the live checkout", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  putImmutable(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: head.commitOid } }),
    createdAt: "2026-01-15T00:00:00.000Z",
  });
  const stored = getById(repo, "EVID-0001");
  assert.ok(stored !== null);
  const assessment = await assessEvidence(repo, stored, {
    subject: { kind: "commit", commit: head.commitOid },
    subjectDigest: head.subjectDigest,
  }, { now: NOW });
  assert.equal(assessment.assessment, "sufficient");
});

test("normalizeTarget maps revspec spellings and refuses unresolvable targets", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const resolved = normalizeTarget(repo, { subject: { kind: "commit", commit: "HEAD" } });
  if (resolved.subject.kind === "commit") assert.equal(resolved.subject.commit, head.commitOid);
  assert.equal(resolved.subjectDigest, head.subjectDigest);
  const bogus = normalizeTarget(repo, { subject: { kind: "commit", commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" } });
  assert.equal(bogus.subjectDigest, null, "an unresolvable commit can never produce a bound digest");
});

// ---------------------------------------------------------------------------
// Graph gate binding — the summary IS the verification gate's authority
// (Issue #241; the implementation gate itself only checks task completion)
// ---------------------------------------------------------------------------

function chainRepo(): string {
  const repo = knowledgeRepo({ gitInit: true });
  writeDoc(repo, "docs/adr/adr.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "ADR",
    relations: { "decides-for": ["DESIGN-0001"] },
  }, "# ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeDoc(repo, "docs/designs/design.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Design",
    relations: { realizes: ["SPEC-abcd"] },
  }, "# Design\n");
  // Gate evaluation needs the focused chain plus a selected run — an
  // Execution Store run whose every task is done, bound to the chain.
  createRun(repo, {
    runId: "RUN-0001",
    graphId: "doc-driven-dev",
    focus: ["docs/designs/design.md"],
    plan: "# Plan\n\nRun plan.\n",
    tasks: [{ taskId: "TASK-0001", title: "TASK-0001", status: "done" }],
  });
  approvePlan(repo, "RUN-0001", { actor: "verification-summary" });
  commitAll(repo);
  return repo;
}

test("the verification gate fails closed without a summary and passes on a HEAD-bound verified one", async () => {
  const repo = chainRepo();
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const focus = ["DESIGN-0001"];

  const missing = await projectGraphState({ cwd: repo, focus });
  assert.equal(missing.verification, null);
  assert.equal(missing.gates.verification.status, "blocked");
  assert.ok(missing.gates.verification.reasons.includes("verification-summary"));

  const stale = await projectGraphState({
    cwd: repo,
    focus,
    verificationSummary: {
      ...emptySummary(),
      target: { subject: { kind: "commit", commit: head.commitOid }, subjectDigest: sha256Of("other-tree") },
    },
  });
  assert.equal(stale.verification?.boundToHead, false);
  assert.equal(stale.gates.verification.status, "blocked");
  assert.ok(stale.gates.verification.reasons.includes("verification-summary-target-mismatch"));

  const indeterminate = await projectGraphState({
    cwd: repo,
    focus,
    verificationSummary: {
      ...emptySummary(),
      target: { subject: { kind: "commit", commit: head.commitOid }, subjectDigest: head.subjectDigest },
      verdict: "indeterminate",
      reasons: ["required-check-undetermined:VD-efgh::CHK-01"],
    },
  });
  assert.equal(indeterminate.verification?.boundToHead, true);
  assert.equal(indeterminate.gates.verification.status, "blocked");
  assert.ok(indeterminate.gates.verification.reasons.includes("verification-indeterminate"));
  assert.ok(indeterminate.gates.verification.reasons.includes("required-check-undetermined:VD-efgh::CHK-01"));

  const verified = await projectGraphState({
    cwd: repo,
    focus,
    verificationSummary: {
      ...emptySummary(),
      target: { subject: { kind: "commit", commit: head.commitOid }, subjectDigest: head.subjectDigest },
    },
  });
  assert.equal(verified.verification?.boundToHead, true);
  assert.equal(verified.gates.verification.status, "pass", JSON.stringify(verified.gates.verification));
});

test("a HEAD the checkout cannot resolve reports head-unreadable — never a target mismatch", async () => {
  const repo = chainRepo();
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const summary = {
    ...emptySummary(),
    target: { subject: { kind: "commit" as const, commit: head.commitOid }, subjectDigest: head.subjectDigest },
  };
  // Removing .git makes HEAD unresolvable: binding becomes unprovable,
  // which fails closed but must not be mislabeled a stale artifact.
  fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"], verificationSummary: summary });
  assert.equal(state.verification?.boundToHead, null);
  assert.equal(state.gates.verification.status, "blocked");
  assert.ok(state.gates.verification.reasons.includes("verification-summary-head-unreadable"));
  assert.ok(!state.gates.verification.reasons.includes("verification-summary-target-mismatch"));
});

test("a verified verdict over un-covered required coverage is inconsistent — refused and gated", async () => {
  const repo = chainRepo();
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  // The honest summary is indeterminate — the declared check has no
  // evidence. Forging `verdict: "verified"` over it asserts coverage the
  // file does not contain.
  const honest = await buildVerificationSummary(repo, {
    subject: { kind: "workspace", snapshotDigest: head.subjectDigest },
    now: NOW,
  });
  assert.equal(honest.verdict, "indeterminate");
  const forged = { ...honest, verdict: "verified" as const };
  // The file boundary refuses the inconsistency outright.
  assert.equal(validateVerificationSummary(JSON.parse(JSON.stringify(forged))), false);
  // And the gate re-checks the cheap invariant on trusted input — a
  // hand-projected inconsistent summary is blocked, never trusted.
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"], verificationSummary: forged });
  assert.equal(state.verification?.boundToHead, true);
  assert.equal(state.gates.verification.status, "blocked");
  assert.ok(state.gates.verification.reasons.includes("verification-summary-inconsistent"));
});

function emptySummary() {
  return {
    schemaVersion: 1 as const,
    kind: "verification-summary" as const,
    target: { subject: { kind: "workspace" as const, snapshotDigest: SNAP_A }, subjectDigest: SNAP_A },
    assessedAt: NOW,
    scope: { claims: [] as string[], checks: [] as string[] },
    claims: [],
    checks: [],
    evidence: [],
    rejectedWaivers: [],
    rejectedNotApplicable: [],
    shadowedExemptions: [],
    counts: {
      checks: { total: 0, required: 0, advisory: 0, satisfied: 0, failed: 0, waived: 0, outOfScope: 0, undetermined: 0, unresolved: 0 },
      claims: { total: 0, covered: 0, partial: 0, uncovered: 0, failed: 0 },
      evidence: { total: 0, sufficient: 0, insufficient: 0, indeterminate: 0 },
    },
    verdict: "verified" as const,
    reasons: ["no-required-coverage"],
  };
}

// ---------------------------------------------------------------------------
// CLI — evidence_store assess / summary + route_graph --verification-summary
// ---------------------------------------------------------------------------

function runCli(script: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [script, ...args, "--cwd", cwd, "--json"], {
    cwd, encoding: "utf8", windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function putViaCli(repo: string, input: Record<string, unknown>): void {
  const file = path.join(repo, "put-input.json");
  fs.writeFileSync(file, JSON.stringify(input), "utf8");
  const result = runCli(cli, ["put", "--file", "put-input.json", "--resolve"], repo);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test("evidence_store assess emits the per-record axes for a declared target", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putViaCli(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: head.commitOid } }),
    check: { ref: "VD-efgh::CHK-01", designRevision: "" },
    claim: { ref: "SPEC-abcd::R-01", documentRevision: "" },
  });
  const result = runCli(cli, ["assess", "EVID-0001", "--commit", "HEAD"], repo);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.assessment.assessment, "sufficient");
  assert.equal(payload.assessment.applicability, "applicable");
});

test("evidence_store summary --out writes a route_graph-consumable summary file", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putViaCli(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: head.commitOid } }),
    check: { ref: "VD-efgh::CHK-01", designRevision: "" },
    claim: { ref: "SPEC-abcd::R-01", documentRevision: "" },
  });
  const result = runCli(cli, ["summary", "--commit", "HEAD", "--out", "summary.json"], repo);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const written = JSON.parse(fs.readFileSync(path.join(repo, "summary.json"), "utf8"));
  assert.equal(validateVerificationSummary(written), true);
  assert.equal(written.verdict, "verified");
  assert.equal(written.target.subjectDigest, head.subjectDigest);
});

test("evidence_store summary validates exemptions from --waivers/--not-applicable files", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  fs.writeFileSync(path.join(repo, "waivers.json"), JSON.stringify([validWaiver()]), "utf8");
  fs.writeFileSync(path.join(repo, "na.json"), JSON.stringify([{ bad: true }]), "utf8");
  const result = runCli(cli, [
    "summary", "--commit", "HEAD",
    "--waivers", "waivers.json", "--waiver-authority", "release-manager",
    "--not-applicable", "na.json",
  ], repo);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.checks[0].status, "waived");
  assert.equal(payload.summary.rejectedNotApplicable.length, 1);
  assert.equal(payload.summary.verdict, "verified");
});

test("evidence_store summary/assess accept a --snapshot workspace subject", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putViaCli(repo, {
    ...recordFor(repo, graph),
    check: { ref: "VD-efgh::CHK-01", designRevision: "" },
    claim: { ref: "SPEC-abcd::R-01", documentRevision: "" },
  });
  const assessed = runCli(cli, ["assess", "EVID-0001", "--snapshot", SNAP_A], repo);
  assert.equal(assessed.status, 0, assessed.stderr + assessed.stdout);
  const axes = JSON.parse(assessed.stdout).assessment;
  assert.equal(axes.applicability, "applicable");
  assert.equal(axes.assessment, "sufficient");
  const summarized = runCli(cli, ["summary", "--snapshot", SNAP_A], repo);
  assert.equal(summarized.status, 0, summarized.stderr + summarized.stdout);
  const payload = JSON.parse(summarized.stdout).summary;
  assert.equal(payload.target.subject.kind, "workspace");
  assert.equal(payload.target.subjectDigest, SNAP_A);
  assert.equal(payload.verdict, "verified");
});

test("route_graph --verification-summary consumes a valid summary file end-to-end", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  const head = resolveCommitSubject(repo, "HEAD");
  assert.ok(head !== null);
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putViaCli(repo, {
    ...recordFor(repo, graph, { subject: { kind: "commit", commit: head.commitOid } }),
    check: { ref: "VD-efgh::CHK-01", designRevision: "" },
    claim: { ref: "SPEC-abcd::R-01", documentRevision: "" },
  });
  const produced = runCli(cli, ["summary", "--commit", "HEAD", "--out", "summary.json"], repo);
  assert.equal(produced.status, 0, produced.stderr + produced.stdout);
  const result = runCli(routeCli, [
    "--graph", graphYaml, "--verification-summary", "summary.json",
    "--focus", "SPEC-abcd", "--current", "implementation",
  ], repo);
  assert.equal(result.status, 0, `a contract-valid summary file must be consumed: ${result.stderr + result.stdout}`);
  const route = JSON.parse(result.stdout);
  assert.equal(route.edgeId, "implementation-retry");
});

test("a summary file carrying rejected malformed exemptions is still route-consumable", async () => {
  const repo = knowledgeRepo({ gitInit: true });
  // A typo'd waivers file: the summary records the refusal as data — the
  // emitted file must not be refused wholesale by the route boundary.
  fs.writeFileSync(path.join(repo, "waivers.json"), JSON.stringify([{ bad: true }]), "utf8");
  const produced = runCli(cli, ["summary", "--commit", "HEAD", "--waivers", "waivers.json", "--out", "s.json"], repo);
  assert.equal(produced.status, 0, produced.stderr + produced.stdout);
  const written = JSON.parse(fs.readFileSync(path.join(repo, "s.json"), "utf8"));
  assert.equal(written.rejectedWaivers.length, 1);
  assert.equal(written.rejectedWaivers[0].waiver, null);
  const result = runCli(routeCli, [
    "--graph", graphYaml, "--verification-summary", "s.json",
    "--focus", "SPEC-abcd", "--current", "implementation",
  ], repo);
  assert.equal(result.status, 0, `a summary carrying recorded rejections must be consumed: ${result.stderr + result.stdout}`);
});

test("route_graph --verification-summary rejects an invalid summary file", () => {
  const repo = knowledgeRepo({ gitInit: true });
  fs.writeFileSync(path.join(repo, "bogus.json"), JSON.stringify({ kind: "verification-summary" }), "utf8");
  const result = runCli(routeCli, ["--graph", graphYaml, "--verification-summary", "bogus.json"], repo);
  assert.equal(result.status, 1, "an unverifiable summary file must be refused");
  assert.match(result.stderr + result.stdout, /Verification Summary|verification-summary/);
});

test("route_graph auto-computes a HEAD-bound summary when no file is supplied", () => {
  // No evidence: the corpus declares a check with no measured outcome, so
  // auto-compute yields undetermined coverage — the implementation gate
  // fails closed on real assessment (the declared retry edge), never on an
  // asserted signal.
  const repo = knowledgeRepo({ gitInit: true });
  const result = runCli(routeCli, ["--graph", graphYaml, "--focus", "SPEC-abcd", "--current", "implementation"], repo);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const route = JSON.parse(result.stdout);
  assert.equal(route.status, "edge");
  assert.equal(route.edgeId, "implementation-retry");
  assert.equal(route.next, "implementation");
});
