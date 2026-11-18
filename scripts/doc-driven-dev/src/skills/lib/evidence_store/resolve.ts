"use strict";

// ---------------------------------------------------------------------------
// Evidence Record back-resolution (Issue #240)
// ---------------------------------------------------------------------------
//
// A record pins claim.ref + documentRevision and check.ref +
// designRevision at measure time. Back-resolution answers: do those
// references still resolve in the live Knowledge Graph, and does the
// pinned revision match what the document/check declares NOW? This is the
// read interface Evidence Assessment (#241) consumes — the store stays
// synchronous and pure; resolution needs the repository graph, so it lives
// in its own module like execution_store/check_resolution.ts.
//
// documentRevision is `sha256:<hex>` of the claim document's canonical
// bytes — the same digest convention check design revisions use.

import fs from "node:fs";
import path from "node:path";

import { scanKnowledgeGraph, resolveCheckReference, resolveClaimReference } from "../knowledge_graph";
import type { KnowledgeGraph } from "../knowledge_graph";
import { documentRevisionOf } from "./store";
import type { EvidenceRecordV1 } from "./types";

type EvidenceReferenceResolution =
  | { status: "resolved"; matchesPinned: boolean; currentRevision: string }
  | { status: "invalid" | "ambiguous" | "unresolved-document" | "unresolved-claim" | "unresolved-check" | "not-verification" };

type EvidenceResolution = {
  claim: EvidenceReferenceResolution;
  check: EvidenceReferenceResolution;
  // Both references resolve AND both pinned revisions match the live
  // graph — the record is current for the target it names.
  current: boolean;
};

// Read a node's primary file for the documentRevision digest. The reader
// is injectable so tests can pin content without a fixture checkout.
function resolveEvidenceIn(
  graph: KnowledgeGraph,
  record: EvidenceRecordV1,
  readDocument: (docPath: string) => string | null,
): EvidenceResolution {
  const claimResolution = resolveClaimReference(graph, record.claim.ref);
  let claim: EvidenceResolution["claim"];
  if (claimResolution.status !== "resolved") {
    claim = { status: claimResolution.status };
  } else {
    const content = readDocument(claimResolution.node.path);
    if (content === null) {
      claim = { status: "unresolved-document" };
    } else {
      const currentRevision = documentRevisionOf(content);
      claim = {
        status: "resolved",
        matchesPinned: currentRevision === record.claim.documentRevision,
        currentRevision,
      };
    }
  }
  const checkResolution = resolveCheckReference(graph, record.check.ref);
  let check: EvidenceResolution["check"];
  if (checkResolution.status !== "resolved") {
    check = { status: checkResolution.status };
  } else {
    const currentRevision = checkResolution.check.designRevision;
    check = {
      status: "resolved",
      matchesPinned: currentRevision === record.check.designRevision,
      currentRevision,
    };
  }
  return {
    claim,
    check,
    current: claim.status === "resolved" && claim.matchesPinned
      && check.status === "resolved" && check.matchesPinned,
  };
}

// Resolve a record against the live Knowledge Graph of `cwd` — one scan,
// doc bytes read from the checkout root.
async function resolveEvidence(cwd: string, record: EvidenceRecordV1): Promise<EvidenceResolution> {
  const graph = await scanKnowledgeGraph({ cwd });
  const root = path.resolve(cwd);
  return resolveEvidenceIn(graph, record, (docPath) => {
    try {
      return fs.readFileSync(path.join(root, docPath), "utf8");
    } catch {
      return null;
    }
  });
}

export { resolveEvidence, resolveEvidenceIn };
export type { EvidenceReferenceResolution, EvidenceResolution };
