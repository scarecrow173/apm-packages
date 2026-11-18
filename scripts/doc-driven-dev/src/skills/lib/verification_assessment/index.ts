"use strict";

// Evidence Assessment + Verification Summary v1 (Issue #241) — public
// surface. See assess.ts for the per-record axes, summary.ts for the
// per-claim/check aggregate the Verification Gate consumes, and
// waivers.ts for the exemption contract.

export { assessEvidence, assessEvidenceIn, recordSubjectDigest } from "./assess";
export type { AssessmentDependencies, AssessmentTarget } from "./assess";
export {
  buildVerificationSummary,
  buildVerificationSummaryIn,
  normalizeTarget,
} from "./summary";
export type { SummaryDependencies, VerificationSummaryInput } from "./summary";
export { NOT_APPLICABLE_REASONS, WAIVER_REASONS } from "./waivers";
export {
  ASSESSMENT_REASON_CODES,
  CHECK_STATUSES,
  CLAIM_STATUSES,
  VERIFICATION_SUMMARY_SCHEMA_VERSION,
  VERIFICATION_SUMMARY_VERDICTS,
  validateAssessment,
  validateNotApplicableVerdict,
  validateVerificationSummary,
  validateWaiver,
  verificationCoverageGap,
} from "./types";
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
  ShadowedExemption,
  VerificationSummary,
  VerificationSummaryVerdict,
  VerificationWaiver,
} from "./types";
