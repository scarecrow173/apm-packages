"use strict";

// ---------------------------------------------------------------------------
// Evidence Assessment + Verification Summary v1 — contract types (Issue #241)
// ---------------------------------------------------------------------------
//
// Assessment is a DERIVED judgment over immutable Evidence Records (#240),
// computed against a caller-declared target subject — the "current change".
// Nothing here writes to the Evidence Store: a record stays the measured
// outcome; an EvidenceAssessment answers whether that outcome still speaks
// for the target under review.
//
// Three contracts:
//
//   EvidenceAssessment — per record, four axes plus reasons:
//     applicability — does the record measure THIS target? A `passed`
//       outcome whose claim/check revision or subject commit/workspace
//       differs from the target is never sufficient: it measured
//       something else (`not-applicable`). References that cannot resolve
//       in the live Knowledge Graph make applicability `unknown`, never
//       guessed.
//     availability — is the recorded evidence package retrievable now?
//       Dead or expired artifact references report `unavailable`;
//       references never fetched report `unknown` — separate axis from
//       integrity, so a gate policy can weight them independently.
//     integrity — is the recorded measurement internally trustworthy?
//       `invalid` when the record's own declared support contradicts it
//       (dead/expired artifacts, a method the check does not design);
//       `unverified` when support was never fetched or was never recorded
//       (attestation-only); `verified` when every declared artifact is
//       digest-verified and current.
//     assessment — the per-record bottom line for this target:
//       `sufficient` (usable positive verification), `insufficient` (a
//       usable measured failure), or `indeterminate` (not usable).
//
//   VerificationSummary — per Claim/Check coverage for one target:
//     required checks, conditional out-of-scope verdicts (impact-analysis
//     rationale: revision/paths/rule/judger/method — never conflated with
//     unexecuted), executed checks, undetermined checks, waivers, and a
//     single verdict consumable as Graph Gate input.
//
//   VerificationWaiver — an exemption with authority/reason/scope/expiry.
//     A waiver is validated, never trusted: authority must sit in the
//     caller-supplied allowlist, the scope ref must resolve, and expiry
//     must be future. A failed validation is REFUSED — recorded under
//     `rejectedWaivers`, never silently applied.
//
// Everything is a plain JSON object so a summary file round-trips;
// validation is hand-rolled (same style as evidence_store/types.ts) so
// every rejection is an explicit fail-closed branch.

import { isPlainObject, isValidId } from "../execution_store/types";
import { VERIFICATION_METHODS } from "../verification_checks";
import type { VerificationMethod } from "../verification_checks";
import { EVIDENCE_OUTCOMES, isRevisionDigest } from "../evidence_store/types";
import type { EvidenceOutcome, EvidenceSubject } from "../evidence_store/types";

const ASSESSMENT_SCHEMA_VERSION = 1;
const VERIFICATION_SUMMARY_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Assessment reason vocabulary — closed set, machine-readable
// ---------------------------------------------------------------------------

const ASSESSMENT_REASON_CODES = [
  // The caller's target could not be named (unresolvable commit, no
  // snapshot): nothing can be judged applicable.
  "target-unverifiable",
  // The record's own subject could not be digested (e.g. its commit no
  // longer resolves) — applicability cannot be proven.
  "subject-unverifiable",
  // The record's subject digest differs from the target's — it measured a
  // different commit or workspace.
  "subject-mismatch",
  // Claim/check reference failed to resolve in the live graph (detail
  // carries the resolution status).
  "claim-unresolved",
  "check-unresolved",
  // Resolved, but the pinned revision no longer matches the live document
  // or check design — the evidence predates the current design.
  "claim-revision-mismatch",
  "check-revision-mismatch",
  // The resolved check does not target the claim the record credits.
  "check-target-mismatch",
  // The recorded method differs from the check's designed method — the
  // outcome is not a measurement of the designed check.
  "method-mismatch",
  // A declared artifact is known-inaccessible.
  "artifact-unavailable",
  // A declared artifact is past its expiresAt deadline.
  "artifact-expired",
  // A declared artifact was recorded but never fetched — its content was
  // never digest-verified.
  "artifact-unverified",
  // The recorded outcome is a measured failure of this target.
  "outcome-failed",
  // The recorded outcome is inconclusive/error/not-run — not a pass.
  "outcome-not-passed",
] as const;

type AssessmentReasonCode = typeof ASSESSMENT_REASON_CODES[number];
const ASSESSMENT_REASON_SET: ReadonlySet<AssessmentReasonCode> = new Set(ASSESSMENT_REASON_CODES);

type AssessmentReason = {
  code: AssessmentReasonCode;
  // Context for the code: artifact uri, resolution status, a revision
  // digest, or null when the code needs none.
  detail: string | null;
};

// ---------------------------------------------------------------------------
// EvidenceAssessment — one record judged against one target
// ---------------------------------------------------------------------------

type EvidenceApplicability = "applicable" | "not-applicable" | "unknown";
type EvidenceAvailability = "available" | "unavailable" | "unknown";
type EvidenceIntegrity = "verified" | "invalid" | "unverified";
type EvidenceAssessmentVerdict = "sufficient" | "insufficient" | "indeterminate";

const EVIDENCE_APPLICABILITIES: ReadonlySet<EvidenceApplicability> = new Set(["applicable", "not-applicable", "unknown"]);
const EVIDENCE_AVAILABILITIES_ASSESSMENT: ReadonlySet<EvidenceAvailability> = new Set(["available", "unavailable", "unknown"]);
const EVIDENCE_INTEGRITIES: ReadonlySet<EvidenceIntegrity> = new Set(["verified", "invalid", "unverified"]);
const EVIDENCE_ASSESSMENT_VERDICTS: ReadonlySet<EvidenceAssessmentVerdict> = new Set(["sufficient", "insufficient", "indeterminate"]);

type EvidenceAssessment = {
  schemaVersion: typeof ASSESSMENT_SCHEMA_VERSION;
  evidenceId: string;
  // The claim/check refs the record credits — echoed for consumers that
  // never see the raw record.
  claim: string;
  check: string;
  outcome: EvidenceOutcome;
  applicability: EvidenceApplicability;
  availability: EvidenceAvailability;
  integrity: EvidenceIntegrity;
  assessment: EvidenceAssessmentVerdict;
  reasons: AssessmentReason[];
};

// ---------------------------------------------------------------------------
// VerificationWaiver + NotApplicableVerdict — exemption contracts
// ---------------------------------------------------------------------------

// A waiver exempts one required check — or every required check targeting
// one claim — from coverage. It is an assertion the summary VALIDATES:
// `authority` must appear in the caller's trusted allowlist, `scope.ref`
// must resolve in the live graph, `reason` must say why, and `expiresAt`
// must be a future deadline (`grantedAt` records when it was granted —
// expiry at or before grant time is malformed). An invalid waiver is a
// refused exemption, never a skip.
type VerificationWaiver = {
  scope: { kind: "check" | "claim"; ref: string };
  authority: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
};

// A conditional out-of-scope verdict: a positive declaration that a check
// does not apply to the current change, backed by the change-impact
// analysis. Every field is required — a verdict missing its basis is a
// refused exemption, and an unexecuted check is NEVER out-of-scope by
// default: only this explicit verdict makes it so.
type NotApplicableVerdict = {
  // The qualified check ref the verdict exempts — must resolve.
  check: string;
  // The revision the impact analysis ran at (claim document revision,
  // check design revision, commit oid, or plan digest — opaque string,
  // required non-empty).
  revision: string;
  // The changed paths the analysis covered — at least one.
  paths: string[];
  // The rule/precondition the judgment applied (e.g. which check
  // precondition the changed input falsifies).
  rule: string;
  // Who judged — actor or adapter identity.
  judger: string;
  // How the judgment was made (e.g. "path-scope", "precondition-eval").
  method: string;
  // Human rationale.
  reason: string;
};

// ---------------------------------------------------------------------------
// VerificationSummary — per claim/check coverage for one target
// ---------------------------------------------------------------------------

// A method-derived constraint the gate must see explicitly (#241):
// manual-review evidence is human attestation; runtime-monitoring evidence
// is a point-in-time sample of a continuous obligation — a pass does not
// discharge it forever.
type CheckConstraint = {
  kind: "manual-review" | "monitoring-continuous";
  detail: string;
};

const CHECK_STATUSES = [
  // An applicable record assessed `sufficient` is the newest conclusive
  // measurement for this target.
  "satisfied",
  // The newest conclusive applicable measurement is `insufficient` — a
  // recorded failure for this target. Measured outcomes outrank any
  // exemption: a failed check stays failed even under a valid waiver.
  "failed",
  // No conclusive evidence, but a validated waiver exempts the check.
  "waived",
  // No conclusive evidence, but a validated not-applicable verdict
  // (impact-analysis basis) exempts the check.
  "out-of-scope",
  // In scope, no usable outcome and no valid exemption — unexecuted or
  // indeterminate-only evidence. This is the bucket an unexecuted check
  // lands in; it is never silently out-of-scope.
  "undetermined",
  // The check ref does not resolve in the live graph — coverage is
  // unprovable, so the check gates as required.
  "unresolved",
] as const;

type CheckStatus = typeof CHECK_STATUSES[number];
const CHECK_STATUS_SET: ReadonlySet<CheckStatus> = new Set(CHECK_STATUSES);

type ExemptionVerdict<T> = {
  verdict: T;
  status: "applied" | "rejected";
  // Refusal codes when rejected (`waiver-*`/`not-applicable-*`); empty on
  // applied.
  reasons: string[];
};

type CheckVerification = {
  ref: string;
  // The claim the resolved check targets; null when the ref never
  // resolves.
  claim: string | null;
  method: VerificationMethod | null;
  required: boolean;
  designRevision: string | null;
  constraints: CheckConstraint[];
  // True when at least one applicable record produced a conclusive
  // (sufficient|insufficient) assessment — the "executed" bucket.
  executed: boolean;
  status: CheckStatus;
  // Assessed evidence ids per verdict bucket (applicable-or-not; every
  // assessed record for this check is listed exactly once).
  evidence: {
    sufficient: string[];
    insufficient: string[];
    indeterminate: string[];
  };
  // The most recent conclusive evidence timestamp — the monitoring
  // recency datum a gate policy can require.
  latestConclusiveAt: string | null;
  waiver: ExemptionVerdict<VerificationWaiver> | null;
  notApplicable: ExemptionVerdict<NotApplicableVerdict> | null;
  reasons: string[];
};

const CLAIM_STATUSES = [
  // Every in-scope required check is satisfied, waived, or out-of-scope.
  "covered",
  // At least one required check is covered, but not all.
  "partial",
  // No required check is covered — including the zero-required-checks
  // coverage gap.
  "uncovered",
  // A required check measured a failure for this target.
  "failed",
] as const;

type ClaimStatus = typeof CLAIM_STATUSES[number];
const CLAIM_STATUS_SET: ReadonlySet<ClaimStatus> = new Set(CLAIM_STATUSES);

type ClaimVerification = {
  ref: string;
  status: ClaimStatus;
  // In-scope checks targeting this claim (qualified refs, sorted).
  checks: string[];
  requiredChecks: string[];
  reasons: string[];
};

type RejectedWaiver = {
  waiver: VerificationWaiver;
  reasons: string[];
};

type RejectedNotApplicable = {
  verdict: NotApplicableVerdict;
  reasons: string[];
};

const VERIFICATION_SUMMARY_VERDICTS = ["verified", "failed", "indeterminate"] as const;
type VerificationSummaryVerdict = typeof VERIFICATION_SUMMARY_VERDICTS[number];

type VerificationSummary = {
  schemaVersion: typeof VERIFICATION_SUMMARY_SCHEMA_VERSION;
  kind: "verification-summary";
  // The assessed target — the "current change". `subjectDigest` is the
  // canonical subject digest both sides compute through one algorithm
  // (#240); null when it could not be computed — every record is then
  // `target-unverifiable`.
  target: {
    subject: EvidenceSubject;
    subjectDigest: string | null;
  };
  // The assessment instant — expiry horizon for artifacts and waivers.
  assessedAt: string;
  // The scope actually assessed: resolved claim and check refs.
  scope: { claims: string[]; checks: string[] };
  claims: ClaimVerification[];
  checks: CheckVerification[];
  // Every record assessed for the in-scope checks — the authority the
  // gate consumes.
  evidence: EvidenceAssessment[];
  rejectedWaivers: RejectedWaiver[];
  rejectedNotApplicable: RejectedNotApplicable[];
  counts: {
    checks: {
      total: number;
      required: number;
      advisory: number;
      satisfied: number;
      failed: number;
      waived: number;
      outOfScope: number;
      undetermined: number;
      unresolved: number;
    };
    claims: { total: number; covered: number; partial: number; uncovered: number; failed: number };
    evidence: { total: number; sufficient: number; insufficient: number; indeterminate: number };
  };
  verdict: VerificationSummaryVerdict;
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Validation — boundary reads for summary files, waivers, verdicts
// ---------------------------------------------------------------------------

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSubject(value: unknown): value is EvidenceSubject {
  if (!isPlainObject(value)) return false;
  if (value.kind === "commit") {
    return typeof value.commit === "string" && /^[0-9a-f]{7,64}$/i.test(value.commit);
  }
  if (value.kind === "workspace") {
    return isRevisionDigest(value.snapshotDigest);
  }
  return false;
}

function validateReason(value: unknown): value is AssessmentReason {
  return isPlainObject(value)
    && ASSESSMENT_REASON_SET.has(value.code as AssessmentReasonCode)
    && (value.detail === null || typeof value.detail === "string");
}

function validateAssessment(value: unknown): value is EvidenceAssessment {
  return isPlainObject(value)
    && value.schemaVersion === ASSESSMENT_SCHEMA_VERSION
    && isValidId(value.evidenceId)
    && typeof value.claim === "string"
    && typeof value.check === "string"
    && EVIDENCE_OUTCOMES.has(value.outcome as EvidenceOutcome)
    && EVIDENCE_APPLICABILITIES.has(value.applicability as EvidenceApplicability)
    && EVIDENCE_AVAILABILITIES_ASSESSMENT.has(value.availability as EvidenceAvailability)
    && EVIDENCE_INTEGRITIES.has(value.integrity as EvidenceIntegrity)
    && EVIDENCE_ASSESSMENT_VERDICTS.has(value.assessment as EvidenceAssessmentVerdict)
    && Array.isArray(value.reasons) && value.reasons.every(validateReason);
}

function validateWaiver(value: unknown): value is VerificationWaiver {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.scope)) return false;
  if (value.scope.kind !== "check" && value.scope.kind !== "claim") return false;
  return nonEmptyString(value.scope.ref)
    && nonEmptyString(value.authority)
    && nonEmptyString(value.reason)
    && isIsoTimestamp(value.grantedAt)
    && isIsoTimestamp(value.expiresAt);
}

function validateNotApplicableVerdict(value: unknown): value is NotApplicableVerdict {
  return isPlainObject(value)
    && nonEmptyString(value.check)
    && nonEmptyString(value.revision)
    && Array.isArray(value.paths)
    && (value.paths as unknown[]).length > 0
    && (value.paths as unknown[]).every(nonEmptyString)
    && nonEmptyString(value.rule)
    && nonEmptyString(value.judger)
    && nonEmptyString(value.method)
    && nonEmptyString(value.reason);
}

function stringArrayField(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateExemption<T>(
  value: unknown,
  inner: (candidate: unknown) => candidate is T,
): value is ExemptionVerdict<T> {
  return isPlainObject(value)
    && inner(value.verdict)
    && (value.status === "applied" || value.status === "rejected")
    && stringArrayField(value.reasons);
}

function validateConstraint(value: unknown): value is CheckConstraint {
  return isPlainObject(value)
    && (value.kind === "manual-review" || value.kind === "monitoring-continuous")
    && typeof value.detail === "string";
}

function validateCheckVerification(value: unknown): value is CheckVerification {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.evidence)) return false;
  return typeof value.ref === "string"
    && (value.claim === null || typeof value.claim === "string")
    && (value.method === null || (VERIFICATION_METHODS as readonly string[]).includes(value.method as string))
    && typeof value.required === "boolean"
    && (value.designRevision === null || typeof value.designRevision === "string")
    && Array.isArray(value.constraints) && value.constraints.every(validateConstraint)
    && typeof value.executed === "boolean"
    && CHECK_STATUS_SET.has(value.status as CheckStatus)
    && stringArrayField(value.evidence.sufficient)
    && stringArrayField(value.evidence.insufficient)
    && stringArrayField(value.evidence.indeterminate)
    && (value.latestConclusiveAt === null || isIsoTimestamp(value.latestConclusiveAt))
    && (value.waiver === null || validateExemption(value.waiver, validateWaiver))
    && (value.notApplicable === null || validateExemption(value.notApplicable, validateNotApplicableVerdict))
    && stringArrayField(value.reasons);
}

function validateClaimVerification(value: unknown): value is ClaimVerification {
  return isPlainObject(value)
    && typeof value.ref === "string"
    && CLAIM_STATUS_SET.has(value.status as ClaimStatus)
    && stringArrayField(value.checks)
    && stringArrayField(value.requiredChecks)
    && stringArrayField(value.reasons);
}

function nonNegativeInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validateSummaryCounts(counts: Record<string, unknown>): boolean {
  const checkCounts = counts.checks;
  const claimCounts = counts.claims;
  const evidenceCounts = counts.evidence;
  if (!isPlainObject(checkCounts) || !isPlainObject(claimCounts) || !isPlainObject(evidenceCounts)) return false;
  return ["total", "required", "advisory", "satisfied", "failed", "waived", "outOfScope", "undetermined", "unresolved"].every((key) => nonNegativeInt(checkCounts[key]))
    && ["total", "covered", "partial", "uncovered", "failed"].every((key) => nonNegativeInt(claimCounts[key]))
    && ["total", "sufficient", "insufficient", "indeterminate"].every((key) => nonNegativeInt(evidenceCounts[key]));
}

// The summary boundary validator — `route_graph --verification-summary`
// and Graph Gate consumers read a caller-supplied summary through this.
// Shape only: correctness of the assessment inside is the producer's
// contract (verification_summary.js), never re-derived at the boundary.
function validateVerificationSummary(value: unknown): value is VerificationSummary {
  if (!isPlainObject(value)) return false;
  if (value.schemaVersion !== VERIFICATION_SUMMARY_SCHEMA_VERSION) return false;
  if (value.kind !== "verification-summary") return false;
  if (!isPlainObject(value.target) || !isSubject(value.target.subject)) return false;
  if (!(value.target.subjectDigest === null || isRevisionDigest(value.target.subjectDigest))) return false;
  if (!isIsoTimestamp(value.assessedAt)) return false;
  if (!isPlainObject(value.scope)) return false;
  if (!stringArrayField(value.scope.claims) || !stringArrayField(value.scope.checks)) return false;
  if (!Array.isArray(value.claims) || !value.claims.every(validateClaimVerification)) return false;
  if (!Array.isArray(value.checks) || !value.checks.every(validateCheckVerification)) return false;
  if (!Array.isArray(value.evidence) || !value.evidence.every(validateAssessment)) return false;
  if (!Array.isArray(value.rejectedWaivers)) return false;
  for (const entry of value.rejectedWaivers) {
    if (!isPlainObject(entry) || !validateWaiver(entry.waiver) || !stringArrayField(entry.reasons)) return false;
  }
  if (!Array.isArray(value.rejectedNotApplicable)) return false;
  for (const entry of value.rejectedNotApplicable) {
    if (!isPlainObject(entry) || !validateNotApplicableVerdict(entry.verdict) || !stringArrayField(entry.reasons)) return false;
  }
  if (!isPlainObject(value.counts) || !validateSummaryCounts(value.counts)) return false;
  if (!(VERIFICATION_SUMMARY_VERDICTS as readonly string[]).includes(value.verdict as string)) return false;
  return stringArrayField(value.reasons);
}

export {
  ASSESSMENT_REASON_CODES,
  ASSESSMENT_SCHEMA_VERSION,
  CHECK_STATUSES,
  CLAIM_STATUSES,
  VERIFICATION_SUMMARY_SCHEMA_VERSION,
  VERIFICATION_SUMMARY_VERDICTS,
  validateAssessment,
  validateNotApplicableVerdict,
  validateVerificationSummary,
  validateWaiver,
};

export type {
  AssessmentReason,
  AssessmentReasonCode,
  CheckConstraint,
  CheckStatus,
  CheckVerification,
  ClaimStatus,
  ClaimVerification,
  EvidenceApplicability,
  EvidenceAssessment,
  EvidenceAssessmentVerdict,
  EvidenceAvailability,
  EvidenceIntegrity,
  ExemptionVerdict,
  NotApplicableVerdict,
  RejectedNotApplicable,
  RejectedWaiver,
  VerificationSummary,
  VerificationSummaryVerdict,
  VerificationWaiver,
};
