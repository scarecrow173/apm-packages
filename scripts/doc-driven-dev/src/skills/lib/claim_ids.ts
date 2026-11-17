"use strict";

// ---------------------------------------------------------------------------
// Claim ID grammar (Issue #235)
// ---------------------------------------------------------------------------
//
// The shared authority for the `<document-id>::<KEY>` claim-reference grammar
// — every resolution boundary (repository model, artifact graph, knowledge
// projection) parses claim-qualified targets through these same patterns so a
// `SPEC-<id>::R-01` value resolves identically everywhere. The grammar lives
// in its own module, below `doc_repository.ts` in the dependency direction:
// the repository model's `resolveRelationTarget` is itself a claim-aware
// boundary, so the grammar cannot live in `knowledge_graph.ts` (which depends
// on the repository model) without inverting the layering.

// Local claim key inside a document — `R-01`, `AC-2`, `NFR-12`.
const CLAIM_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

// A claim reference is `<document-id>::<key>` — the owning document id and
// the document-local key, joined by `::` (e.g. `SPEC-<id>::R-01`). The
// document id segment excludes `:` entirely, so a URI (`https://...`,
// `mailto:...`) can never parse as a claim reference.
const CLAIM_REFERENCE_PATTERN = /^([^\s:]+)::([A-Z][A-Z0-9]*-\d+)$/;

// Claim declaration marker anywhere in a document body:
// `<!-- claim:R-01 -->` or `<!-- claim:DOC-ID::R-01 -->`. The marker binds
// the claim identity to its position, so rewording the claim text or moving
// it across headings keeps the ID stable.
const CLAIM_MARKER_PATTERN = /<!--\s*claim\s*:(.*?)-->/g;

type ClaimReference = {
  docId: string;
  key: string;
};

function isClaimKey(value: string): boolean {
  return CLAIM_KEY_PATTERN.test(value);
}

function parseClaimReference(value: string): ClaimReference | null {
  const match = CLAIM_REFERENCE_PATTERN.exec(value.trim());
  if (!match) return null;
  return { docId: match[1], key: match[2] };
}

function claimId(docId: string, key: string): string {
  return `${docId}::${key}`;
}

export {
  CLAIM_KEY_PATTERN,
  CLAIM_MARKER_PATTERN,
  CLAIM_REFERENCE_PATTERN,
  claimId,
  isClaimKey,
  parseClaimReference,
};

export type { ClaimReference };
