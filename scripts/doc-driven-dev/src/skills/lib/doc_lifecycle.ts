"use strict";

import {
  configs,
  docTypes,
  ephemeralConfigs,
  isDurableType,
  legacyDocTypes,
  LIFECYCLE_VALUES,
  registry,
  resolveDocType,
  settledStatusesFor,
} from "./doc_types";
import type { LifecycleValue } from "./doc_types";

// Lifecycle axes policy — the single authority for two distinct axes
// (Issue #234):
//
// 1. `lifecycle` — the document's own archival state (`draft | current |
//    superseded | retired`), declared on durable front matter. `superseded`
//    and `retired` are the settled end-states; `draft` and `current` are
//    in-flight. Unknown values are never coerced to `current`.
// 2. `settled status` — the type-specific status vocabulary's terminal
//    set, per the registry's `settledStatuses` declarations. This drives
//    the "the document's own work has concluded; it persists as historical
//    evidence" signal for docs that predate the lifecycle axis or carry no
//    lifecycle value. It is NOT the graph's terminal-status notion —
//    `approved` designs and `accepted` ADRs stay in-flight because they
//    remain the normative baseline in-flight work derives from. Unknown
//    types get an empty set (everything counts as in-flight).
//
// Consumers: the `stale-upstream` lint rule (`doc_repository.ts`), the
// lifecycle-stats projection (`lifecycle_stats.ts`), and the status-aware
// index views (`doc_suite_utils.ts`, ADR/impl index writers). (Issues
// #127/#166, extended by #162/#163; registry-derived by #234.)

// SETTLED_STATUSES projects every registry type — durable, ephemeral, and
// legacy (plus legacy aliases) — into its declared terminal-status set, so
// the settled axis keeps working for the historical docs migration reads.
const SETTLED_STATUSES: Record<string, ReadonlySet<string>> = {
  ...Object.fromEntries(docTypes.map((type) => [type, new Set(configs[type].settledStatuses)])),
  ...Object.fromEntries(Object.values(ephemeralConfigs).map((entry) => [entry.type, new Set(entry.settledStatuses)])),
  ...Object.fromEntries(Object.values(legacyDocTypes).flatMap((entry) =>
    [entry.type, ...entry.aliases].map((name) => [name, new Set(entry.settledStatuses)] as const))),
};

// Legacy type-name aliases merged into their canonical bucket — derived
// from the legacy registry's declared aliases.
const LIFECYCLE_TYPE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.values(legacyDocTypes).flatMap((entry) =>
    entry.aliases.map((alias) => [alias, entry.type] as const)),
);

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

/**
 * Parse a front-matter `lifecycle:` value into the declared axis. Returns
 * the value when it is one of `draft | current | superseded | retired`,
 * `null` when the field is absent or empty, and `"invalid"` for any other
 * populated value — callers decide whether that is a finding; nothing here
 * silently maps an unknown lifecycle to `current`.
 */
function parseLifecycle(value: unknown): LifecycleValue | "invalid" | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return (LIFECYCLE_VALUES as readonly string[]).includes(trimmed)
    ? trimmed as LifecycleValue
    : "invalid";
}

/**
 * Whether `lifecycle` names a settled end-state (`superseded` | `retired`).
 * `null`/`invalid` return `null` — the caller falls back to the status axis
 * rather than guessing.
 */
function isSettledLifecycle(lifecycle: LifecycleValue | "invalid" | null): boolean | null {
  if (lifecycle === null || lifecycle === "invalid") return null;
  return lifecycle === "superseded" || lifecycle === "retired";
}

/**
 * The settled verdict for one index row or document: when a lifecycle value
 * is present it is authoritative; absent or unparsable values fall back to
 * the per-type settled-status axis (the established v2 semantics).
 */
function isSettledEntry(
  type: string | null | undefined,
  status: string | null | undefined,
  lifecycle?: string | null,
): boolean {
  const byLifecycle = isSettledLifecycle(parseLifecycle(lifecycle));
  if (byLifecycle !== null) return byLifecycle;
  return isSettledStatus(type, status);
}

export {
  isDurableType,
  isSettledEntry,
  isSettledLifecycle,
  isSettledStatus,
  lifecycleBucketForType,
  LIFECYCLE_TYPE_ALIASES,
  parseLifecycle,
  registry,
  resolveDocType,
  SETTLED_STATUSES,
  settledStatusesFor,
};
export type { LifecycleValue };
