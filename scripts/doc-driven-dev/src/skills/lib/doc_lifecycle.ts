"use strict";

// Lifecycle settled-axis policy — the single authority for "the document's own
// lifecycle work has concluded; it persists as historical evidence even though
// it may still be referenced". Consumers: the `stale-upstream` lint rule
// (`doc_repository.ts`), the lifecycle-stats projection (`lifecycle_stats.ts`),
// and the status-aware index views (`doc_suite_utils.ts`, ADR/impl index
// writers). This is NOT the graph's terminal-status notion — `approved`
// designs and `accepted` ADRs stay in-flight because they remain the normative
// baseline in-flight work derives from. Unknown types get an empty set
// (everything counts as in-flight). (Issues #127/#166, extended by #162/#163.)

const SETTLED_STATUSES: Record<string, ReadonlySet<string>> = {
  idea: new Set(["promoted", "parked", "archived", "superseded"]),
  brainstorm: new Set(["routed", "superseded"]),
  discovery: new Set(["resolved", "archived", "superseded"]),
  spec: new Set(["implemented", "superseded", "rejected"]),
  plan: new Set(["completed", "superseded"]),
  task: new Set(["done", "wont-do"]),
  design: new Set(["superseded", "rejected"]),
  adr: new Set(["rejected", "deprecated", "superseded"]),
  "test-spec": new Set(["deprecated", "superseded"]),
  impl: new Set(["completed", "abandoned", "superseded"]),
};

/** Legacy fixture spelling merged into the canonical `impl` bucket. */
const LIFECYCLE_TYPE_ALIASES: Record<string, string> = { "implementation-record": "impl" };

/**
 * Lifecycle bucket for a declared `type:` value. Unlike `lifecycleBucketOf`
 * (which operates on scanned documents and knows `unmanaged`), this answers
 * for a bare type string — the shape index writers have.
 */
function lifecycleBucketForType(type: string | null | undefined): string {
  const declared = type ?? "untyped";
  return LIFECYCLE_TYPE_ALIASES[declared] ?? declared;
}

/**
 * Whether `(type, status)` is settled per the shared authority. Null status or
 * unknown type counts as in-flight. Used by index generators to partition the
 * generated table into active and settled sections.
 */
function isSettledStatus(type: string | null | undefined, status: string | null | undefined): boolean {
  if (!status) return false;
  return SETTLED_STATUSES[lifecycleBucketForType(type)]?.has(status) ?? false;
}

export { isSettledStatus, lifecycleBucketForType, LIFECYCLE_TYPE_ALIASES, SETTLED_STATUSES };
