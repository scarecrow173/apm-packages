"use strict";

// ---------------------------------------------------------------------------
// Evidence Record v1 — record schema and field validation (Issue #240)
// ---------------------------------------------------------------------------
//
// Record shape for the Git-external immutable Evidence Store. An Evidence
// Record is the measured OUTCOME of a Verification Check — deliberately a
// separate contract from an Effect Receipt (which only proves an effect
// ran). Records are append-once: identical re-puts are idempotent,
// same-id different-content is a conflict, and there is no update or
// delete path at any layer.
//
// Everything here is a plain JSON object so a record is fully
// serializable; validation is hand-rolled (same style as
// execution_store/types.ts) so every rejection is an explicit fail-closed
// branch, never a parser fallback.

import { parseClaimReference } from "../claim_ids";
import { isSha256, isValidId, isPlainObject } from "../execution_store/types";
import { VERIFICATION_METHODS } from "../verification_checks";
import type { VerificationMethod } from "../verification_checks";

const EVIDENCE_RECORD_SCHEMA_VERSION = 1;
const EVIDENCE_MANIFEST_SCHEMA_VERSION = 1;
const EVIDENCE_INDEX_SCHEMA_VERSION = 1;

// Storage policy for a record and its artifacts (#240):
//   transient — per-run / working evidence; safe to drop with the run
//   release   — evidence backing a release decision; kept until superseded
//   durable   — long-term project evidence; kept indefinitely
type EvidenceRetention = "transient" | "release" | "durable";
const EVIDENCE_RETENTIONS: ReadonlySet<EvidenceRetention> = new Set([
  "transient",
  "release",
  "durable",
]);

type EvidenceOutcome = "passed" | "failed" | "inconclusive" | "error" | "not-run";
const EVIDENCE_OUTCOMES: ReadonlySet<EvidenceOutcome> = new Set([
  "passed",
  "failed",
  "inconclusive",
  "error",
  "not-run",
]);

// Where the verification actually ran — repository-local tooling, CI, or
// an external provider adapter.
type EvidenceProviderKind = "repository" | "ci" | "external";
const EVIDENCE_PROVIDER_KINDS: ReadonlySet<EvidenceProviderKind> = new Set([
  "repository",
  "ci",
  "external",
]);

// Accessibility of an artifact reference (#240): `available` is the only
// state allowed to carry a verified content digest; `unverified` marks a
// recorded reference that was never fetched — it must never be counted as
// supporting a `passed` outcome; `unavailable` is a checked, known
// inaccessibility (deleted CI artifact, dead link).
type ArtifactAvailability = "available" | "unverified" | "unavailable";
const ARTIFACT_AVAILABILITIES: ReadonlySet<ArtifactAvailability> = new Set([
  "available",
  "unverified",
  "unavailable",
]);

// The subject a check was measured against — either a Git commit or a
// workspace snapshot identified by a content digest. A workspace subject
// may only ever be promoted to a commit subject with a matching tree
// digest — content-identity proof, handled in store.ts.
type EvidenceSubject =
  | { kind: "commit"; commit: string }
  | { kind: "workspace"; snapshotDigest: string };

// One recorded artifact reference. `expiresAt` is the artifact's retention
// deadline (ISO-8601); `sha256` is the verified content digest —
// `sha256:<64-hex>` — required exactly when `availability` is "available":
// an artifact claimed available without a digest is invalid, and an
// unfetched or dead reference can never masquerade as verified content.
type EvidenceArtifact = {
  uri: string;
  sha256: string | null;
  availability: ArtifactAvailability;
  retention: EvidenceRetention;
  expiresAt: string | null;
};

type EvidenceRecordV1 = {
  schemaVersion: typeof EVIDENCE_RECORD_SCHEMA_VERSION;
  evidenceId: string;
  // The claim the check verifies, pinned at measure time: qualified claim
  // reference plus the digest of the document carrying it.
  claim: {
    ref: string;
    documentRevision: string;
  };
  // The check that produced the outcome, pinned at measure time:
  // qualified `VD-<id>::CHK-NN` reference plus its design revision.
  check: {
    ref: string;
    designRevision: string;
  };
  subject: EvidenceSubject;
  method: VerificationMethod;
  provider: {
    kind: EvidenceProviderKind;
    name: string | null;
  };
  // Execution run that produced the record, when one exists — context
  // only; evidence never becomes run state.
  runId: string | null;
  // Freeform environment description (runner, os, toolchain) — opaque to
  // the store, recorded verbatim for later assessment.
  environment: unknown;
  outcome: EvidenceOutcome;
  retention: EvidenceRetention;
  artifacts: EvidenceArtifact[];
  // Set when the record was promoted from an earlier record (workspace →
  // commit with content-identity proof); null for original measurements.
  derivedFrom: string | null;
  createdAt: string;
};

// Store manifest — a write-once marker tracking WHERE the Git-untracked
// records live and the retention vocabulary the store honors (#240).
type EvidenceStoreManifest = {
  schemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  kind: "evidence-store";
  // Checkout-relative path when the root is inside the worktree, or the
  // absolute root for a declared external root.
  location: string;
  recordsDir: "records";
  retentionClasses: EvidenceRetention[];
  createdAt: string;
};

// The derived aggregate index — regenerable byte-identically from the
// records dir; never written on the append path so parallel puts share no
// file. `generatedAt` is the newest record `createdAt`, not wall time, so
// the same records always produce the same bytes.
type EvidenceIndex = {
  schemaVersion: typeof EVIDENCE_INDEX_SCHEMA_VERSION;
  generated: "evidence-index";
  generatedAt: string | null;
  recordCount: number;
  counts: {
    byOutcome: Record<EvidenceOutcome, number>;
    byRetention: Record<EvidenceRetention, number>;
    bySubjectKind: { commit: number; workspace: number };
  };
  // Qualified check ref → sorted evidence ids (latest first by createdAt).
  checks: Record<string, string[]>;
  claims: Record<string, string[]>;
  runs: Record<string, string[]>;
};

// ---------------------------------------------------------------------------
// Validation + normalization
// ---------------------------------------------------------------------------

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRevisionDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

// Normalize a revision digest to the canonical `sha256:<hex>` spelling —
// a bare 64-hex digest is the same value, anything else is rejected at the
// caller, not coerced.
function normalizeRevisionDigest(value: unknown): string | null {
  if (isRevisionDigest(value)) return value;
  if (isSha256(value)) return `sha256:${value}`;
  return null;
}

// Schemes allowed in an artifact URI. `javascript:`/`data:`/`vbscript:`
// are rejected outright — a recorded reference is data, but a consumer may
// open it, so dangerous schemes are refused at the write boundary.
const ARTIFACT_URI_SCHEMES: ReadonlySet<string> = new Set([
  "file", "http", "https", "s3", "gs", "az", "artifact", "run",
]);
const BLOCKED_URI_SCHEMES: ReadonlySet<string> = new Set(["javascript", "data", "vbscript"]);

const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// Resolve `.`/`..` segments lexically (no filesystem access) on a POSIX-ish
// path. Returns null when the path escapes its root or is malformed —
// `a/../../b` can never be a contained reference.
function normalizePathSegments(rawPath: string): string | null {
  const absolute = rawPath.startsWith("/");
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

// Normalize an artifact URI (#240): trim, lowercase the scheme, validate
// the form, and resolve `file:` path segments lexically. Bare relative
// paths (no scheme) are normalized as repo-relative POSIX paths — an
// absolute path or a `..` escape is refused. Returns the normalized
// spelling or null when the input is not a safe reference.
function normalizeArtifactUri(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const uri = raw.trim();
  // No empty references, no control characters, no whitespace inside.
  if (uri === "" || /[\x00-\x1f\x7f\s]/.test(uri)) return null;
  if (!URI_SCHEME_PATTERN.test(uri)) {
    // Repo-relative path: no drive letters, no absolute paths, no escape.
    if (uri.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(uri) || uri.includes("\\")) return null;
    const normalized = normalizePathSegments(uri);
    if (normalized === null || normalized === "") return null;
    return normalized;
  }
  const scheme = uri.slice(0, uri.indexOf(":")).toLowerCase();
  if (BLOCKED_URI_SCHEMES.has(scheme)) return null;
  if (!ARTIFACT_URI_SCHEMES.has(scheme)) return null;
  if (scheme === "file") {
    let rest = uri.slice(uri.indexOf(":") + 1);
    while (rest.startsWith("/")) rest = rest.slice(1);
    const normalized = normalizePathSegments(`/${rest}`);
    return normalized === null ? null : `file://${normalized}`;
  }
  try {
    // URL parse normalizes host casing and default ports; re-serializing
    // the parsed object yields the canonical spelling.
    return new URL(uri).toString();
  } catch {
    return null;
  }
}

function validateSubject(value: unknown): value is EvidenceSubject {
  if (!isPlainObject(value)) return false;
  if (value.kind === "commit") {
    // Full or abbreviated hex object id (sha1/sha256 repos alike).
    return typeof value.commit === "string" && /^[0-9a-f]{7,64}$/i.test(value.commit);
  }
  if (value.kind === "workspace") {
    return isRevisionDigest(value.snapshotDigest);
  }
  return false;
}

function validateArtifact(value: unknown): value is EvidenceArtifact {
  if (!isPlainObject(value)) return false;
  if (typeof value.uri !== "string" || normalizeArtifactUri(value.uri) === null) return false;
  if (!(value.sha256 === null || isRevisionDigest(value.sha256))) return false;
  if (!ARTIFACT_AVAILABILITIES.has(value.availability as ArtifactAvailability)) return false;
  if (!EVIDENCE_RETENTIONS.has(value.retention as EvidenceRetention)) return false;
  if (!(value.expiresAt === null || isIsoTimestamp(value.expiresAt))) return false;
  // An artifact claimed "available" must carry the verified digest —
  // anything else is an unverified or dead reference and must not be
  // recorded as supporting content.
  if (value.availability === "available" && !isRevisionDigest(value.sha256)) return false;
  return true;
}

function validateProvider(value: unknown): value is EvidenceRecordV1["provider"] {
  return isPlainObject(value)
    && EVIDENCE_PROVIDER_KINDS.has(value.kind as EvidenceProviderKind)
    && (value.name === null || value.name === undefined || typeof value.name === "string");
}

function validateEvidenceRecord(value: unknown): value is EvidenceRecordV1 {
  if (!isPlainObject(value)) return false;
  const claim = value.claim;
  const check = value.check;
  return value.schemaVersion === EVIDENCE_RECORD_SCHEMA_VERSION
    && isValidId(value.evidenceId)
    && isPlainObject(claim)
    && typeof claim.ref === "string" && parseClaimReference(claim.ref.trim()) !== null
    && isRevisionDigest(claim.documentRevision)
    && isPlainObject(check)
    && typeof check.ref === "string"
    && (() => {
      const parsed = parseClaimReference(check.ref.trim());
      return parsed !== null && /^CHK-\d+$/.test(parsed.key);
    })()
    && isRevisionDigest(check.designRevision)
    && validateSubject(value.subject)
    && (VERIFICATION_METHODS as readonly string[]).includes(value.method as string)
    && validateProvider(value.provider)
    && (value.runId === null || isValidId(value.runId))
    && EVIDENCE_OUTCOMES.has(value.outcome as EvidenceOutcome)
    && EVIDENCE_RETENTIONS.has(value.retention as EvidenceRetention)
    && Array.isArray(value.artifacts) && value.artifacts.every(validateArtifact)
    && (value.derivedFrom === null || isValidId(value.derivedFrom))
    && isIsoTimestamp(value.createdAt);
}

function validateManifest(value: unknown): value is EvidenceStoreManifest {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === EVIDENCE_MANIFEST_SCHEMA_VERSION
    && value.kind === "evidence-store"
    && typeof value.location === "string" && value.location.length > 0
    && value.recordsDir === "records"
    && Array.isArray(value.retentionClasses)
    && value.retentionClasses.every((item) => EVIDENCE_RETENTIONS.has(item as EvidenceRetention))
    && isIsoTimestamp(value.createdAt);
}

function validateIndex(value: unknown): value is EvidenceIndex {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === EVIDENCE_INDEX_SCHEMA_VERSION
    && value.generated === "evidence-index"
    && (value.generatedAt === null || isIsoTimestamp(value.generatedAt))
    && Number.isInteger(value.recordCount) && (value.recordCount as number) >= 0
    && isPlainObject(value.counts)
    && isPlainObject(value.checks)
    && isPlainObject(value.claims)
    && isPlainObject(value.runs);
}

export {
  ARTIFACT_AVAILABILITIES,
  EVIDENCE_INDEX_SCHEMA_VERSION,
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  EVIDENCE_OUTCOMES,
  EVIDENCE_PROVIDER_KINDS,
  EVIDENCE_RECORD_SCHEMA_VERSION,
  EVIDENCE_RETENTIONS,
  isRevisionDigest,
  normalizeArtifactUri,
  normalizeRevisionDigest,
  validateArtifact,
  validateEvidenceRecord,
  validateIndex,
  validateManifest,
};

export type {
  ArtifactAvailability,
  EvidenceArtifact,
  EvidenceIndex,
  EvidenceOutcome,
  EvidenceProviderKind,
  EvidenceRecordV1,
  EvidenceRetention,
  EvidenceStoreManifest,
  EvidenceSubject,
};
