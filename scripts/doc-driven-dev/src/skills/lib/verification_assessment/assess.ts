"use strict";

// ---------------------------------------------------------------------------
// Evidence Assessment v1 — per-record judgment against a target (Issue #241)
// ---------------------------------------------------------------------------
//
// An Evidence Record is the measured outcome; an EvidenceAssessment is the
// DERIVED judgment of whether that outcome speaks for the caller-declared
// target (the "current change"). Assessment recomputes — it never mutates
// the store.
//
// The axes and their fail-closed rules:
//
//   applicability — does the record measure THIS target?
//     applicable     — claim + check resolve, both pinned revisions still
//                      match the live graph, the check targets the credited
//                      claim, the recorded method is the designed method,
//                      and the record's subject digest equals the target's.
//     not-applicable — everything resolves but something differs: a claim
//                      or check revision moved on, the check does not
//                      target the claim, the recorded method is not the
//                      designed one, or the subject digest differs — a
//                      `passed` outcome measured a DIFFERENT target and is
//                      never sufficient for this one.
//     unknown        — a reference cannot resolve (ambiguous, missing, or
//                      invalid ref), the record's subject cannot be
//                      digested, or the target itself is unnamable. The
//                      assessment never guesses.
//
//   availability — is the recorded evidence package retrievable now?
//     unavailable    — an artifact is known-inaccessible or past its
//                      expiresAt deadline.
//     unknown        — no dead references, but some were never fetched.
//     available      — every declared artifact is digest-verified and
//                      within retention, or none were declared.
//
//   integrity — is the recorded measurement internally trustworthy?
//     invalid        — the record's own package contradicts the outcome:
//                      a declared artifact is dead/expired, or the
//                      recorded method is not the method the check
//                      designs.
//     unverified     — support exists but was never digest-verified
//                      (unfetched artifacts), or the record declares no
//                      artifacts at all — an attestation-only outcome.
//     verified       — every declared artifact is digest-verified and
//                      current.
//
//   assessment — the per-record bottom line:
//     sufficient     — applicable + passed + integrity `verified`: every
//                      declared artifact is digest-verified and current.
//                      An unverified reference must never support a
//                      passed outcome (#240), and an attestation-only
//                      record (no artifacts) is unverified by
//                      construction — neither can be sufficient.
//     insufficient   — applicable + a recorded `failed` outcome (a
//                      measured failure is never upgraded by broken
//                      support).
//     indeterminate  — everything else: not for this target, unresolvable,
//                      inconclusive/error/not-run, or a pass whose own
//                      package is unverified or broken.
//
// Sufficiency requires `integrity: "verified"` — which already implies
// `availability: "available"` (a dead/expired reference makes integrity
// `invalid`, an unfetched one `unverified`). The three axes still report
// independently so a gate policy sees WHY a record fell short — a
// missing artifact is a different failure than a revision drift.

import fs from "node:fs";
import path from "node:path";

import { scanKnowledgeGraph, resolveCheckReference } from "../knowledge_graph";
import type { KnowledgeGraph } from "../knowledge_graph";
import { resolveEvidenceIn } from "../evidence_store/resolve";
import { resolveCommitSubject } from "../evidence_store/store";
import type {
  EvidenceRecordV1,
  EvidenceSubject,
} from "../evidence_store/types";
import {
  ASSESSMENT_SCHEMA_VERSION,
} from "./types";
import type {
  AssessmentReason,
  AssessmentReasonCode,
  EvidenceApplicability,
  EvidenceAssessment,
  EvidenceAvailability,
  EvidenceIntegrity,
} from "./types";

// The subject a summary assesses — the "current change". `subjectDigest`
// is the canonical digest computed through the one shared algorithm
// (#240): commit subjects resolve `<commit>^{tree}` through git, workspace
// subjects carry the adapter-attested snapshot digest.
type AssessmentTarget = {
  subject: EvidenceSubject;
  subjectDigest: string | null;
};

type AssessmentDependencies = {
  // Reads a node primary file for claim documentRevision — injectable so
  // tests pin content without a fixture checkout.
  readDocument: (docPath: string) => string | null;
  // Computes the canonical digest of a record's own subject — commit
  // subjects through git (resolveCommitSubject), workspace subjects as
  // the attested snapshotDigest.
  resolveSubjectDigest: (subject: EvidenceSubject) => string | null;
  // The assessment instant — expiry horizon for artifact deadlines.
  now: string;
};

function push(reasons: AssessmentReason[], code: AssessmentReasonCode, detail: string | null = null): void {
  reasons.push({ code, detail });
}

// Artifact axes. Availability answers "is the content retrievable now";
// integrity answers "does the record's declared support contradict the
// outcome". Both derive from the same declared references but report
// independently — a gate policy weighs them separately.
function artifactAxes(
  record: EvidenceRecordV1,
  now: string,
  reasons: AssessmentReason[],
): { availability: EvidenceAvailability; brokenSupport: boolean; unverifiedSupport: boolean } {
  let unavailable = false;
  let unverified = false;
  for (const artifact of record.artifacts) {
    const expired = artifact.expiresAt !== null && Date.parse(artifact.expiresAt) <= Date.parse(now);
    if (artifact.availability === "unavailable" || expired) {
      unavailable = true;
      push(reasons, artifact.availability === "unavailable" ? "artifact-unavailable" : "artifact-expired", artifact.uri);
    } else if (artifact.availability === "unverified") {
      unverified = true;
      push(reasons, "artifact-unverified", artifact.uri);
    }
  }
  return {
    availability: unavailable ? "unavailable" : unverified ? "unknown" : "available",
    brokenSupport: unavailable,
    unverifiedSupport: unverified,
  };
}

// The pure per-record assessment — everything derivable from the record,
// the live graph, the declared target, and injectable environment reads.
function assessEvidenceIn(
  graph: KnowledgeGraph,
  record: EvidenceRecordV1,
  target: AssessmentTarget,
  deps: AssessmentDependencies,
): EvidenceAssessment {
  const reasons: AssessmentReason[] = [];
  const resolution = resolveEvidenceIn(graph, record, deps.readDocument);

  // --- applicability ---------------------------------------------------
  let applicability: EvidenceApplicability;
  let unresolvable = false;
  if (resolution.claim.status !== "resolved") {
    unresolvable = true;
    push(reasons, "claim-unresolved", resolution.claim.status);
  }
  if (resolution.check.status !== "resolved") {
    unresolvable = true;
    push(reasons, "check-unresolved", resolution.check.status);
  }

  let methodMismatch = false;
  let mismatched = false;
  if (!unresolvable) {
    if (resolution.claim.status === "resolved" && !resolution.claim.matchesPinned) {
      mismatched = true;
      push(reasons, "claim-revision-mismatch", resolution.claim.currentRevision);
    }
    if (resolution.check.status === "resolved" && !resolution.check.matchesPinned) {
      mismatched = true;
      push(reasons, "check-revision-mismatch", resolution.check.currentRevision);
    }
    if (resolution.checkTargetsClaim === false) {
      mismatched = true;
      push(reasons, "check-target-mismatch", record.claim.ref);
    }
    if (resolution.check.status === "resolved") {
      const check = resolveCheckReference(graph, record.check.ref);
      if (check.status === "resolved" && check.check.method !== record.method) {
        methodMismatch = true;
        mismatched = true;
        push(reasons, "method-mismatch", `${check.check.method}!=${record.method}`);
      }
    }
  }

  let subjectKnown = true;
  if (target.subjectDigest === null) {
    subjectKnown = false;
    push(reasons, "target-unverifiable");
  }
  const recordDigest = deps.resolveSubjectDigest(record.subject);
  if (recordDigest === null) {
    subjectKnown = false;
    push(reasons, "subject-unverifiable");
  }
  const subjectMatches = subjectKnown && recordDigest === target.subjectDigest;
  if (subjectKnown && !subjectMatches) {
    mismatched = true;
    push(reasons, "subject-mismatch", recordDigest);
  }

  if (unresolvable || !subjectKnown) {
    applicability = "unknown";
  } else if (mismatched) {
    applicability = "not-applicable";
  } else {
    applicability = "applicable";
  }

  // --- availability + integrity ----------------------------------------
  const axes = artifactAxes(record, deps.now, reasons);
  const integrity: EvidenceIntegrity = axes.brokenSupport || methodMismatch
    ? "invalid"
    : axes.unverifiedSupport || record.artifacts.length === 0
      ? "unverified"
      : "verified";

  // --- assessment --------------------------------------------------------
  if (applicability === "applicable" && record.outcome === "failed") {
    push(reasons, "outcome-failed");
  } else if (record.outcome !== "passed" && record.outcome !== "failed") {
    push(reasons, "outcome-not-passed", record.outcome);
  }
  const assessment = applicability !== "applicable"
    ? "indeterminate"
    : record.outcome === "failed"
      ? "insufficient"
      : record.outcome !== "passed" || integrity !== "verified"
        ? "indeterminate"
        : "sufficient";

  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    evidenceId: record.evidenceId,
    claim: record.claim.ref,
    check: record.check.ref,
    outcome: record.outcome,
    applicability,
    availability: axes.availability,
    integrity,
    assessment,
    reasons,
  };
}

// The canonical subject digest for a record's own subject — commit
// subjects resolve through git in this checkout; workspace subjects carry
// the adapter-attested snapshot digest. Null = unprovable.
function recordSubjectDigest(cwd: string, subject: EvidenceSubject): string | null {
  if (subject.kind === "workspace") return subject.snapshotDigest;
  const resolved = resolveCommitSubject(cwd, subject.commit);
  return resolved === null ? null : resolved.subjectDigest;
}

// One-record assessment against the live graph of `cwd` — one scan, docs
// read from the checkout root, record-subject digests computed through
// git where needed.
async function assessEvidence(
  cwd: string,
  record: EvidenceRecordV1,
  target: AssessmentTarget,
  options: { now?: string } = {},
): Promise<EvidenceAssessment> {
  const graph = await scanKnowledgeGraph({ cwd });
  const root = path.resolve(cwd);
  return assessEvidenceIn(graph, record, target, {
    readDocument: (docPath) => {
      try {
        return fs.readFileSync(path.join(root, docPath), "utf8");
      } catch {
        return null;
      }
    },
    resolveSubjectDigest: (subject) => recordSubjectDigest(root, subject),
    now: options.now ?? new Date().toISOString(),
  });
}

export { assessEvidence, assessEvidenceIn, recordSubjectDigest };
export type { AssessmentDependencies, AssessmentTarget };
