"use strict";

// ---------------------------------------------------------------------------
// Task check reference resolution (Issue #239)
// ---------------------------------------------------------------------------
//
// The shared boundary a `TaskRecord.checks` entry resolves through. A task
// may only name a Verification Check by its qualified reference
// `VD-<id>::CHK-NN` — the same `<document-id>::<KEY>` grammar claims use —
// and the reference must resolve to a check a live Verification Design
// declares. Bare keys, claim references, legacy test-spec references, and
// arbitrary strings never resolve: task check entries were unchecked
// strings before this contract; anything that is not a real check
// reference is a refusal, not a passthrough.
//
// The store itself (store.ts) stays synchronous and pure — resolution
// needs the repository Knowledge Graph, so the entrypoints that write
// task checks (`execution_store.js create --tasks-file`, `put-task
// --file`) route through this module BEFORE calling into the store.
// Imported runs are exempt: a handoff snapshot legitimately references
// checks declared in the exporting checkout's durable docs.

import { scanKnowledgeGraph, resolveCheckReference } from "../knowledge_graph";
import type { KnowledgeCheck } from "../knowledge_graph";

type TaskCheckResolution =
  | { ref: string; status: "resolved"; documentId: string | null; check: KnowledgeCheck }
  | { ref: string; status: "invalid" | "unresolved-document" | "not-verification" | "unresolved-check"; reason: string };

const STATUS_REASONS: Record<string, string> = {
  invalid: "is not a qualified check reference VD-<id>::CHK-NN",
  "unresolved-document": "names a document that does not exist",
  "not-verification": "names a document that is not a Verification Design",
  "unresolved-check": "names a check the Verification Design does not declare",
};

// Resolve one batch of task check references against the live graph —
// one scan per call, so a whole task file resolves consistently. Every
// entry keeps its own status; `assertTaskCheckRefs` turns any non-resolved
// entry into a refusal.
async function resolveTaskCheckRefs(cwd: string, refs: string[]): Promise<TaskCheckResolution[]> {
  const graph = await scanKnowledgeGraph({ cwd });
  return refs.map((ref) => {
    const resolution = resolveCheckReference(graph, ref);
    if (resolution.status === "resolved") {
      return { ref, status: "resolved", documentId: resolution.node.id, check: resolution.check };
    }
    return { ref, status: resolution.status, reason: STATUS_REASONS[resolution.status] ?? "does not resolve" };
  });
}

// The write-boundary form: refuse the write when any reference is not a
// live check. `owner` names the writing context (e.g. `task T-03`) so the
// refusal reads like the store's own invalid-argument errors.
async function assertTaskCheckRefs(cwd: string, refs: string[], owner: string): Promise<void> {
  if (refs.length === 0) return;
  const resolutions = await resolveTaskCheckRefs(cwd, refs);
  const failures = resolutions.filter((resolution) => resolution.status !== "resolved");
  if (failures.length === 0) return;
  const detail = failures
    .map((failure) => `  ${failure.ref} — ${failure.reason}`)
    .join("\n");
  throw new Error(
    `${owner} references ${failures.length === 1 ? "a check" : "checks"} that cannot resolve — ` +
    `task checks must be qualified Verification Check references VD-<id>::CHK-NN declared by a live Verification Design:\n${detail}`,
  );
}

export { assertTaskCheckRefs, resolveTaskCheckRefs };
export type { TaskCheckResolution };
