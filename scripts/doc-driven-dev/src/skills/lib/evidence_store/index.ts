"use strict";

// Evidence Store v1 (Issue #240) — public surface. See store.ts for the
// consistency model, types.ts for the record schema, resolve.ts for the
// back-resolution interface Evidence Assessment (#241) consumes.

export {
  buildIndex,
  documentRevisionOf,
  getById,
  inspectEvidenceStore,
  loadManifest,
  promoteToCommit,
  putImmutable,
  query,
  rebuildIndex,
  recoverEvidence,
  requireById,
  resolveCommitSubject,
  treeDigestOf,
  workspaceDigestOf,
} from "./store";
export type {
  EvidenceInput,
  EvidenceQuery,
  EvidenceStoreInspection,
  EvidenceStoreIntegrity,
  StoreOptions,
} from "./store";
export {
  EVIDENCE_OUTCOMES,
  EVIDENCE_PROVIDER_KINDS,
  EVIDENCE_RETENTIONS,
  normalizeArtifactUri,
  normalizeRevisionDigest,
  validateIndex,
} from "./types";
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
} from "./types";
export { resolveEvidence, resolveEvidenceIn } from "./resolve";
export type { EvidenceReferenceResolution, EvidenceResolution } from "./resolve";
export { StoreError } from "../execution_store/atomic";
