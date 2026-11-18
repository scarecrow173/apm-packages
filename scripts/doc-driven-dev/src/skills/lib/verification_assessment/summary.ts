"use strict";

// ---------------------------------------------------------------------------
// Verification Summary v1 — per Claim/Check coverage for a target (#241)
// ---------------------------------------------------------------------------
//
// The summary is the pure aggregate the Verification Gate consumes: for a
// declared target subject it classifies every in-scope check as
// satisfied / failed / waived / out-of-scope / undetermined / unresolved,
// rolls checks up per claim, and reduces the whole scope to one verdict —
// `verified`, `failed`, or `indeterminate`. It is computed from the live
// Knowledge Graph (design-time checks), the immutable Evidence Store
// (measured outcomes), and caller-supplied exemptions — never from a
// blanket "implementation verified" signal.
//
// Semantics that matter:
//
//   - Coverage is per required check. Advisory checks (`required: false`)
//     are classified and reported but never gate the verdict.
//   - A measured outcome outranks an exemption: the newest conclusive
//     applicable assessment wins — `sufficient` ⇒ satisfied,
//     `insufficient` ⇒ failed — and a recorded failure stays failed even
//     under a valid waiver (a waiver exempts obligation, not reality).
//   - Only conclusive applicable evidence executes a check. Unexecuted
//     checks and indeterminate-only evidence land in `undetermined` —
//     never silently `out-of-scope`; out-of-scope needs a validated
//     impact-analysis verdict, and a waived check needs a validated
//     authority.
//   - A claim is `covered` only when EVERY required check targeting it is
//     satisfied, waived, or out-of-scope — a subset of passing checks
//     never covers the claim.
//   - Fail closed: unresolvable scope refs gate as required, records for
//     other subjects are not-applicable, and `subjectDigest: null` makes
//     every assessment `target-unverifiable` ⇒ `indeterminate`.

import fs from "node:fs";
import path from "node:path";

import { scanKnowledgeGraph, resolveCheckReference, resolveClaimReference } from "../knowledge_graph";
import type { KnowledgeGraph } from "../knowledge_graph";
import { isPlainObject } from "../execution_store/types";
import { inspectEvidenceStore, query, resolveCommitSubject } from "../evidence_store/store";
import type { StoreOptions } from "../evidence_store/store";
import type {
  EvidenceRecordV1,
  EvidenceSubject,
} from "../evidence_store/types";
import { isVerificationMethod } from "../verification_checks";
import type { VerificationMethod } from "../verification_checks";
import { assessEvidenceIn, recordSubjectDigest } from "./assess";
import type { AssessmentTarget } from "./assess";
import { evaluateNotApplicables, evaluateWaivers } from "./waivers";
import { VERIFICATION_SUMMARY_SCHEMA_VERSION } from "./types";
import type {
  CheckConstraint,
  CheckVerification,
  ClaimVerification,
  EvidenceAssessment,
  ExemptionVerdict,
  NotApplicableVerdict,
  RejectedNotApplicable,
  RejectedWaiver,
  ShadowedExemption,
  VerificationSummary,
  VerificationSummaryVerdict,
  VerificationWaiver,
} from "./types";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

type VerificationSummaryInput = {
  // The subject under assessment — the "current change". Commit subjects
  // normalize to their full oid and canonical subject digest through git
  // (`buildVerificationSummary`); the `...In` form takes the caller's
  // digest verbatim. A null digest marks the target unverifiable —
  // assessments then fail closed as indeterminate.
  subject: EvidenceSubject;
  subjectDigest?: string | null;
  // Explicit in-scope claim refs. Default: every claim an in-scope check
  // targets plus — always — the targets of in-scope checks. Refs that do
  // not resolve land in the summary as uncovered claims.
  claims?: string[];
  // Explicit in-scope check refs. Default: every check the graph
  // declares. Refs that do not resolve gate as `unresolved`.
  checks?: string[];
  // Evidence records to assess — `buildVerificationSummary` fills this
  // from the store query (optionally run-scoped); the `...In` form takes
  // it verbatim.
  records?: EvidenceRecordV1[];
  // Restrict the store query to records produced by one run.
  runId?: string;
  // Waiver candidates — validated per-entry; invalid ones reject.
  waivers?: unknown[];
  // Trusted waiver authorities — absent (undefined) means NO trusted
  // authority: every waiver rejects.
  waiverAuthorities?: string[];
  // Conditional out-of-scope verdict candidates — validated per-entry.
  notApplicable?: unknown[];
  // The assessment instant — expiry horizon for artifacts and waivers.
  now?: string;
};

type SummaryDependencies = {
  readDocument: (docPath: string) => string | null;
  resolveSubjectDigest: (subject: EvidenceSubject) => string | null;
};

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

type ScopedCheck = {
  ref: string;
  resolved: boolean;
  claim: string | null;
  method: VerificationMethod | null;
  required: boolean;
  designRevision: string | null;
  constraints: CheckConstraint[];
};

const METHOD_CONSTRAINTS: Record<string, CheckConstraint> = {
  "manual-review": {
    kind: "manual-review",
    detail: "evidence attests a human review outcome — a gate policy may require review provenance",
  },
  "runtime-monitoring": {
    kind: "monitoring-continuous",
    detail: "a point-in-time pass does not discharge a continuous monitoring obligation — a gate policy may require recency",
  },
};

// The checks the summary must judge: the caller's explicit refs, or every
// check the graph declares. Refs that do not resolve stay in scope as
// `unresolved` — a required check that cannot be named cannot be
// satisfied, and dropping it would fabricate coverage.
function scopedCheck(check: { qualifiedId: string | null; id: string; target: string; method: string; required: boolean; designRevision: string }, fallbackRef: string): ScopedCheck {
  const ref = check.qualifiedId ?? fallbackRef;
  const method = isVerificationMethod(check.method) ? check.method : null;
  return {
    ref,
    resolved: check.qualifiedId !== null && method !== null,
    claim: check.target,
    method,
    required: check.required,
    designRevision: check.designRevision,
    constraints: method !== null && method in METHOD_CONSTRAINTS ? [METHOD_CONSTRAINTS[method]] : [],
  };
}

function scopeChecks(graph: KnowledgeGraph, input: VerificationSummaryInput): ScopedCheck[] {
  if (input.checks !== undefined) {
    return [...new Set(input.checks)].sort().map((ref) => {
      const resolution = resolveCheckReference(graph, ref);
      if (resolution.status !== "resolved") {
        return { ref, resolved: false, claim: null, method: null, required: true, designRevision: null, constraints: [] };
      }
      return scopedCheck(resolution.check, ref);
    });
  }
  const scoped: ScopedCheck[] = [];
  for (const node of graph.nodes) {
    for (const check of node.checks) {
      scoped.push(scopedCheck(check, `${node.id ?? node.path}::${check.id}`));
    }
  }
  return scoped.sort((left, right) => left.ref.localeCompare(right.ref));
}

// Claim scope = explicit refs ∪ resolved targets of in-scope checks.
// Unresolvable explicit refs stay in scope as `uncovered` claims — a
// caller that names a claim asserts it needs verification, and an
// unfindable claim can never show coverage.
function scopeClaims(
  graph: KnowledgeGraph,
  checks: ScopedCheck[],
  input: VerificationSummaryInput,
): { ref: string; resolved: boolean }[] {
  const refs = new Set<string>();
  const resolved = new Map<string, boolean>();
  for (const check of checks) {
    if (check.claim !== null && check.resolved) {
      refs.add(check.claim);
      resolved.set(check.claim, true);
    }
  }
  for (const ref of input.claims ?? []) {
    if (refs.has(ref)) continue;
    refs.add(ref);
    resolved.set(ref, resolveClaimReference(graph, ref).status === "resolved");
  }
  return [...refs].sort().map((ref) => ({ ref, resolved: resolved.get(ref) === true }));
}

// ---------------------------------------------------------------------------
// Per-check classification
// ---------------------------------------------------------------------------

function compareRecords(left: EvidenceRecordV1, right: EvidenceRecordV1): number {
  return left.createdAt === right.createdAt
    ? left.evidenceId.localeCompare(right.evidenceId)
    : left.createdAt.localeCompare(right.createdAt);
}

function classifyCheck(
  check: ScopedCheck,
  assessed: { assessment: EvidenceAssessment; record: EvidenceRecordV1 }[],
  waiver: ExemptionVerdict<VerificationWaiver> | null,
  notApplicable: ExemptionVerdict<NotApplicableVerdict> | null,
): CheckVerification {
  const reasons: string[] = [];
  const buckets = { sufficient: [] as string[], insufficient: [] as string[], indeterminate: [] as string[] };
  // Every assessed record for this check is listed exactly once — even
  // for an unresolved check: its records were assessed (an unresolvable
  // ref can only ever yield `unknown` applicability ⇒ indeterminate) and
  // dropping them here would leave them attributed nowhere.
  for (const entry of assessed) {
    buckets[entry.assessment.assessment].push(entry.assessment.evidenceId);
  }
  if (!check.resolved) {
    reasons.push("check-unresolved");
    return {
      ref: check.ref,
      claim: check.claim,
      method: check.method,
      required: check.required,
      designRevision: check.designRevision,
      constraints: check.constraints,
      executed: false,
      status: "unresolved",
      evidence: buckets,
      latestConclusiveAt: null,
      waiver,
      notApplicable,
      reasons,
    };
  }

  // The newest CONCLUSIVE applicable assessment decides: measured
  // outcomes — usable pass or usable fail — outrank any exemption, and
  // the latest measurement supersedes older ones (createdAt, then id —
  // the same ordering the store's query emits).
  const conclusive = assessed
    .filter((entry) => entry.assessment.assessment !== "indeterminate")
    .sort((left, right) => compareRecords(left.record, right.record));
  const latest = conclusive.length === 0 ? null : conclusive[conclusive.length - 1];
  const executed = latest !== null;

  let status: CheckVerification["status"];
  if (latest !== null) {
    status = latest.assessment.assessment === "sufficient" ? "satisfied" : "failed";
    if (status === "failed") reasons.push("required-check-failed");
  } else if (notApplicable?.status === "applied") {
    status = "out-of-scope";
    reasons.push("out-of-scope-verdict");
  } else if (waiver?.status === "applied") {
    status = "waived";
    reasons.push("waiver-applied");
  } else {
    status = "undetermined";
    reasons.push(assessed.length === 0 ? "unexecuted" : "indeterminate-evidence");
  }
  if (waiver?.status === "rejected") reasons.push(...waiver.reasons);
  if (notApplicable?.status === "rejected") reasons.push(...notApplicable.reasons);

  return {
    ref: check.ref,
    claim: check.claim,
    method: check.method,
    required: check.required,
    designRevision: check.designRevision,
    constraints: check.constraints,
    executed,
    status,
    evidence: buckets,
    latestConclusiveAt: latest === null ? null : latest.record.createdAt,
    waiver,
    notApplicable,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Per-claim rollup
// ---------------------------------------------------------------------------

function classifyClaim(ref: string, resolved: boolean, checks: CheckVerification[]): ClaimVerification {
  const scoped = checks.filter((check) => check.claim === ref);
  const required = scoped.filter((check) => check.required);
  const reasons: string[] = [];
  let status: ClaimVerification["status"];
  if (!resolved) {
    status = "uncovered";
    reasons.push("claim-unresolved");
  } else if (required.length === 0) {
    status = "uncovered";
    reasons.push("claim-no-required-checks");
  } else if (required.some((check) => check.status === "failed")) {
    status = "failed";
    reasons.push("claim-required-check-failed");
  } else {
    const covered = required.filter((check) =>
      check.status === "satisfied" || check.status === "waived" || check.status === "out-of-scope");
    if (covered.length === required.length) {
      status = "covered";
    } else if (covered.length === 0) {
      status = "uncovered";
      reasons.push("claim-uncovered");
    } else {
      status = "partial";
      reasons.push("claim-partial-coverage");
    }
  }
  return {
    ref,
    status,
    checks: scoped.map((check) => check.ref).sort(),
    requiredChecks: required.map((check) => check.ref).sort(),
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

// Verification-design integrity findings. The Knowledge Graph drops a
// malformed `checks:` entry (or a `checks:` field on a non-verification
// document) into `issues` and keeps scanning — so a VD document whose
// design cannot be read contributes ZERO checks to the scope. The summary
// must not mistake that for an empty design: any check-related graph
// issue means the declared check inventory is untrustworthy, and coverage
// computed over a partial inventory can never prove verification.
const CHECK_DESIGN_ISSUE_CODES: ReadonlySet<string> = new Set([
  // verification_checks.ts parse findings
  "malformed-checks",
  "malformed-check-entry",
  "missing-check-field",
  "invalid-check-id",
  "duplicate-check",
  "invalid-check-target",
  "invalid-check-method",
  "check-criteria-mismatch",
  "incomplete-required-check",
  // knowledge_graph.ts projection findings
  "unresolved-check-target",
  "ambiguous-check-target",
  "invalid-check-anchor",
  "unresolved-check-anchor",
  "duplicate-check-anchor",
  "check-anchor-mismatch",
  "misplaced-check-anchor",
  "misplaced-checks",
]);

function buildVerificationSummaryIn(
  graph: KnowledgeGraph,
  input: VerificationSummaryInput & { records: EvidenceRecordV1[] },
  deps: SummaryDependencies,
): VerificationSummary {
  const now = input.now ?? new Date().toISOString();
  const target: AssessmentTarget = {
    subject: input.subject,
    subjectDigest: input.subjectDigest ?? null,
  };

  const scopedChecks = scopeChecks(graph, input);
  const scopedClaims = scopeClaims(graph, scopedChecks, input);
  const checkRefs = new Set(scopedChecks.map((check) => check.ref));

  // Assess every record bound to an in-scope check — records for other
  // checks are irrelevant to this scope and never enter the evidence list.
  const records = [...input.records].sort(compareRecords);

  const assessmentsByCheck = new Map<string, { assessment: EvidenceAssessment; record: EvidenceRecordV1 }[]>();
  const assessments: EvidenceAssessment[] = [];
  for (const record of records) {
    if (!checkRefs.has(record.check.ref)) continue;
    const assessment = assessEvidenceIn(graph, record, target, {
      readDocument: deps.readDocument,
      resolveSubjectDigest: deps.resolveSubjectDigest,
      now,
    });
    assessments.push(assessment);
    const bucket = assessmentsByCheck.get(record.check.ref) ?? [];
    bucket.push({ assessment, record });
    assessmentsByCheck.set(record.check.ref, bucket);
  }

  // Exemptions validate once against the whole graph — applied waivers/
  // verdicts bind to their scope; rejections report on the summary and on
  // the check they tried to exempt.
  const authorities = input.waiverAuthorities ?? null;
  const waivers = evaluateWaivers(graph, input.waivers ?? [], authorities, now);
  const notApplicables = evaluateNotApplicables(graph, input.notApplicable ?? []);

  const checks: CheckVerification[] = scopedChecks.map((check) => {
    const waiver = firstWaiverForScope(waivers.results, "check", check.ref)
      ?? (check.claim === null ? null : firstWaiverForScope(waivers.results, "claim", check.claim));
    const notApplicable = firstVerdictForCheck(notApplicables.results, check.ref);
    return classifyCheck(check, assessmentsByCheck.get(check.ref) ?? [], waiver, notApplicable);
  });

  const claims: ClaimVerification[] = scopedClaims.map((claim) => classifyClaim(claim.ref, claim.resolved, checks));

  // --- verdict -------------------------------------------------------------
  // Required checks alone gate; advisory results are reported, never
  // counted. A measured failure anywhere fails the summary — exemptions
  // and partial coverage never heal it.
  const requiredChecks = checks.filter((check) => check.required);
  const reasons: string[] = [];
  const failed = requiredChecks.filter((check) => check.status === "failed");
  const gated = requiredChecks.filter((check) =>
    check.status === "undetermined" || check.status === "unresolved");
  const uncovered = claims.filter((claim) => claim.status !== "covered");
  for (const check of failed) reasons.push(`required-check-failed:${check.ref}`);
  for (const check of gated) reasons.push(`required-check-${check.status}:${check.ref}`);
  for (const claim of uncovered) reasons.push(`claim-${claim.status}:${claim.ref}`);
  for (const entry of waivers.rejected) {
    // A malformed candidate carries no contract shape — name the
    // best-effort scope it spelled, or that none could be read.
    const scope = candidateScope(entry.waiver, entry.input);
    reasons.push(`rejected-waiver:${scope?.ref ?? "unidentified"}`);
  }
  for (const entry of notApplicables.rejected) {
    reasons.push(`rejected-not-applicable:${candidateCheck(entry.verdict, entry.input) ?? "unidentified"}`);
  }
  // Shadowing audit — deterministic input order gives each scope key to
  // its FIRST candidate, so a later APPLIED candidate for the same scope
  // attaches nowhere: valid, but it exempted nothing. Record those
  // losers so an applied exemption never vanishes silently; a shadowed
  // REJECTED candidate needs no entry (the rejected lists carry it).
  const shadowedExemptions: ShadowedExemption[] = [];
  const seenWaiverScopes = new Set<string>();
  for (const result of waivers.results) {
    const scope = candidateScope(result.verdict, result.input);
    if (scope === null) continue;
    const key = `${scope.kind}:${scope.ref}`;
    if (seenWaiverScopes.has(key)) {
      if (result.status === "applied") {
        shadowedExemptions.push({ kind: "waiver", input: result.input, scope });
        reasons.push(`shadowed-exemption:waiver:${scope.ref}`);
      }
    } else {
      seenWaiverScopes.add(key);
    }
  }
  const seenVerdictChecks = new Set<string>();
  for (const result of notApplicables.results) {
    const ref = candidateCheck(result.verdict, result.input);
    if (ref === null) continue;
    if (seenVerdictChecks.has(ref)) {
      if (result.status === "applied") {
        shadowedExemptions.push({ kind: "not-applicable", input: result.input, scope: { kind: "check", ref } });
        reasons.push(`shadowed-exemption:not-applicable:${ref}`);
      }
    } else {
      seenVerdictChecks.add(ref);
    }
  }
  // A check-design graph issue means the declared check inventory could
  // not be fully read — a malformed or misplaced `checks:` entry drops
  // out of scope silently, so an otherwise-clean summary over a partial
  // inventory would fabricate coverage. The issue is surfaced verbatim;
  // the verdict below fails closed on it.
  const designIssues = graph.issues.filter((issue) => CHECK_DESIGN_ISSUE_CODES.has(issue.code));
  for (const issue of designIssues) {
    reasons.push(`check-design-invalid:${issue.code}:${issue.path}`);
  }
  if (target.subjectDigest === null) reasons.push("target-unverifiable");

  let verdict: VerificationSummaryVerdict;
  if (failed.length > 0 || claims.some((claim) => claim.status === "failed")) {
    verdict = "failed";
  } else if (gated.length > 0 || uncovered.length > 0 || designIssues.length > 0) {
    verdict = "indeterminate";
  } else {
    verdict = "verified";
    // A verified verdict over a non-empty scope implies required checks:
    // a claim with zero required checks is `uncovered`, which gates as
    // indeterminate above — so an empty required set here can only mean
    // the scope itself was empty.
    if (requiredChecks.length === 0) {
      reasons.push("no-required-coverage");
    }
  }

  const counts = {
    checks: {
      total: checks.length,
      required: requiredChecks.length,
      advisory: checks.length - requiredChecks.length,
      satisfied: checks.filter((check) => check.status === "satisfied").length,
      failed: failed.length,
      waived: checks.filter((check) => check.status === "waived").length,
      outOfScope: checks.filter((check) => check.status === "out-of-scope").length,
      undetermined: checks.filter((check) => check.status === "undetermined").length,
      unresolved: checks.filter((check) => check.status === "unresolved").length,
    },
    claims: {
      total: claims.length,
      covered: claims.filter((claim) => claim.status === "covered").length,
      partial: claims.filter((claim) => claim.status === "partial").length,
      uncovered: claims.filter((claim) => claim.status === "uncovered").length,
      failed: claims.filter((claim) => claim.status === "failed").length,
    },
    evidence: {
      total: assessments.length,
      sufficient: assessments.filter((entry) => entry.assessment === "sufficient").length,
      insufficient: assessments.filter((entry) => entry.assessment === "insufficient").length,
      indeterminate: assessments.filter((entry) => entry.assessment === "indeterminate").length,
    },
  };

  return {
    schemaVersion: VERIFICATION_SUMMARY_SCHEMA_VERSION,
    kind: "verification-summary",
    target,
    assessedAt: now,
    scope: {
      claims: claims.map((claim) => claim.ref),
      checks: checks.map((check) => check.ref),
    },
    claims,
    checks,
    evidence: assessments,
    rejectedWaivers: waivers.rejected,
    rejectedNotApplicable: notApplicables.rejected,
    shadowedExemptions,
    counts,
    verdict,
    reasons: reasons.sort(),
  };
}

// The scope a waiver candidate names — the validated scope when the
// candidate had one, else the best-effort readable scope of the verbatim
// input. A malformed waiver still "tried" to exempt the scope it
// spelled, so its refusal attaches there (and can shadow a later
// candidate) exactly like a shape-valid one — invalid input is never
// dereferenced as if it were a contract shape.
function candidateScope(
  verdict: VerificationWaiver | null,
  input: unknown,
): { kind: "check" | "claim"; ref: string } | null {
  if (verdict !== null) return verdict.scope;
  if (!isPlainObject(input) || !isPlainObject(input.scope)) return null;
  const kind = input.scope.kind;
  const ref = input.scope.ref;
  return (kind === "check" || kind === "claim") && typeof ref === "string" && ref.length > 0
    ? { kind, ref }
    : null;
}

// The check a not-applicable candidate names — validated or best-effort
// readable from the verbatim input, same rule as candidateScope.
function candidateCheck(verdict: NotApplicableVerdict | null, input: unknown): string | null {
  if (verdict !== null) return verdict.check;
  return isPlainObject(input) && typeof input.check === "string" && input.check.length > 0
    ? input.check
    : null;
}

// Pick the first waiver covering a scope — deterministic input order,
// applied or rejected alike (the check owns whichever it got). A
// claim-scope waiver covers every required check targeting that claim.
function firstWaiverForScope(
  results: ExemptionVerdict<VerificationWaiver>[],
  kind: "check" | "claim",
  ref: string,
): ExemptionVerdict<VerificationWaiver> | null {
  for (const result of results) {
    const scope = candidateScope(result.verdict, result.input);
    if (scope !== null && scope.kind === kind && scope.ref === ref) return result;
  }
  return null;
}

function firstVerdictForCheck(
  results: ExemptionVerdict<NotApplicableVerdict>[],
  ref: string,
): ExemptionVerdict<NotApplicableVerdict> | null {
  for (const result of results) {
    if (candidateCheck(result.verdict, result.input) === ref) return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checkout-bound builder — graph scan + store query + subject digests
// ---------------------------------------------------------------------------

// Normalize the declared target: commit subjects resolve their full oid
// and canonical subject digest through git (unresolvable ⇒ digest null,
// fail closed); workspace subjects carry the attested snapshot digest.
function normalizeTarget(cwd: string, input: VerificationSummaryInput): AssessmentTarget {
  if (input.subject.kind === "commit") {
    const resolved = resolveCommitSubject(cwd, input.subject.commit);
    return {
      subject: resolved === null
        ? input.subject
        : { kind: "commit", commit: resolved.commitOid },
      subjectDigest: resolved === null ? null : resolved.subjectDigest,
    };
  }
  return { subject: input.subject, subjectDigest: input.subject.snapshotDigest };
}

async function buildVerificationSummary(
  cwd: string,
  input: VerificationSummaryInput,
  options: StoreOptions = {},
): Promise<VerificationSummary> {
  const root = path.resolve(cwd);
  const graph = await scanKnowledgeGraph({ cwd: root });
  const storeQueried = input.records === undefined;
  const records = input.records ?? query(root, { runId: input.runId }, options);
  const target = normalizeTarget(root, input);
  // The serialized summary must carry the NORMALIZED subject — a `HEAD`
  // revspec spelling is not a subject the file contract admits; the
  // resolved full oid is what a downstream gate can pin against.
  const summary = buildVerificationSummaryIn(graph, { ...input, subject: target.subject, records, subjectDigest: target.subjectDigest }, {
    readDocument: (docPath) => {
      try {
        return fs.readFileSync(path.join(root, docPath), "utf8");
      } catch {
        return null;
      }
    },
    resolveSubjectDigest: (subject) => recordSubjectDigest(root, subject),
  });
  // The store's own marker is part of what the summary claims: records
  // read from a store whose manifest is torn or missing cannot be
  // certified as store state, so the summary degrades instead of
  // certifying coverage it cannot prove (Issue #246 — the same boundary
  // the repo-level lint reports as `*-evidence-store`). An ABSENT store
  // stays a legitimate empty input; a caller-supplied record list is the
  // caller's own authority and is never re-inspected.
  if (storeQueried) {
    const store = inspectEvidenceStore(root, options);
    if (store.integrity === "corrupt" || store.integrity === "unmanifested") {
      if (summary.verdict === "verified") summary.verdict = "indeterminate";
      summary.reasons = [...new Set([...summary.reasons, `evidence-store-${store.integrity}`])].sort();
    }
  }
  return summary;
}

export { buildVerificationSummary, buildVerificationSummaryIn, normalizeTarget };
export type { SummaryDependencies, VerificationSummaryInput };
