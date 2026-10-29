"use strict";

import type { TaskGraphResult } from "../../../doc-driven-dev-graph/scripts/lib/task_graph";

// WritePattern matches the cross-task contract verbatim: the declared type
// only guarantees `path` on dir entries, but this implementation always
// attaches a normalized `path` (file entries need it for exact matching).
export type WritePattern = { kind: "file" } | { kind: "dir" } & { path: string };
export type ScopeEntry = { pattern: WritePattern } | { opaque: string };
export type ParallelVerdict = "parallel" | "serial" | "blocked";
export type ParallelConflict = { a: string; b: string; path: string };
export type SerialReason =
  | "scope-undeclared"        // no ## Affected Files section / empty
  | "scope-unverifiable"      // non-path entry (e.g. "auth module")
  | "write-conflict";         // pairwise path overlap
export type ParallelReport = {
  decision: ParallelVerdict;
  eligible: string[];                    // candidates evaluated (resumableActive || runnable)
  parallel: string[];                    // task IDs safe to run concurrently
  serial: Array<{ id: string; reasons: string[] }>; // serial-only task IDs + reason codes
  conflicts: ParallelConflict[];
  taskGraphIssues: string[];             // issue codes when blocked
};

/** Internal shape: every resolved pattern carries its normalized path. */
type ScopedPattern = WritePattern & { path: string };

// Verbatim port of the sectionBody helper from
// briefing-flow/scripts/lib/briefing_audit.ts (itself ported from
// doc-driven-dev-graph/scripts/lib/graph_state.ts) so `##` heading extraction
// cannot drift between audits.
function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
  if (start < 0) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const section = endOffset < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + endOffset);
  return section.join("\n").trim();
}

function hasSection(body: string, heading: string): boolean {
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  return body.split(/\r?\n/).some((line) => pattern.test(line.trimEnd()));
}

const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CHECKBOX_MARKER = /^\[[ xX]?\]\s*/;

/**
 * Normalize a declared scope path to forward-slash repo-relative form.
 * Returns null for entries that cannot be verified deterministically:
 * absolute paths, `..` escapes, and embedded glob segments.
 */
function normalizeScopePath(raw: string): { path: string; isDir: boolean } | null {
  let text = raw.trim().replace(/\\/g, "/");
  // Reject POSIX roots, UNC-style `//`, and drive-letter absolutes (`C:`).
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null;
  while (text.startsWith("./")) text = text.slice(2);
  let isDir = false;
  if (text.endsWith("/*")) {
    isDir = true;
    text = text.slice(0, -2);
  } else if (text.endsWith("/")) {
    isDir = true;
    text = text.replace(/\/+$/, "");
  }
  const segments = text.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) return null;
  const normalized = segments.join("/");
  if (!normalized) return null;
  return { path: normalized, isDir };
}

function toScopeEntry(text: string): ScopeEntry {
  // A bare word with no path separators is a module/feature name, not a path.
  if (!text.includes("/") && !text.includes(".") && !text.includes("\\")) {
    return { opaque: text };
  }
  const normalized = normalizeScopePath(text);
  if (!normalized) return { opaque: text };
  const pattern: ScopedPattern = normalized.isDir
    ? { kind: "dir", path: normalized.path }
    : { kind: "file", path: normalized.path };
  return { pattern };
}

/**
 * Parse the `## Affected Files` section of a task body into scope entries.
 * Returns null when the section is absent; an empty array when the section
 * is present but declares no usable entries (comments/placeholders only).
 */
export function parseAffectedFiles(body: string): ScopeEntry[] | null {
  if (!hasSection(body, "Affected Files")) return null;
  const section = sectionBody(body, "Affected Files");
  const entries: ScopeEntry[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = BULLET_ITEM.exec(line);
    if (!match) continue;
    const text = match[1].replace(HTML_COMMENT, "").replace(CHECKBOX_MARKER, "").trim();
    if (!text) continue;
    entries.push(toScopeEntry(text));
  }
  return entries;
}

/**
 * Returns the most specific conflicting path when two write patterns overlap:
 * file==file on equal paths, a dir prefix containing the other's path, or
 * dir∩dir when either prefix contains the other. Null when disjoint.
 */
function overlapPath(left: ScopedPattern, right: ScopedPattern): string | null {
  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path ? left.path : null;
  }
  if (left.kind === "dir" && right.kind === "dir") {
    if (left.path === right.path) return left.path;
    if (left.path.startsWith(`${right.path}/`)) return left.path;
    if (right.path.startsWith(`${left.path}/`)) return right.path;
    return null;
  }
  const dir = left.kind === "dir" ? left : right;
  const file = left.kind === "dir" ? right : left;
  if (file.path === dir.path || file.path.startsWith(`${dir.path}/`)) return file.path;
  return null;
}

/**
 * Deterministic parallel-safety judgment over the authoritative TaskGraphResult.
 * Fail-closed: non-empty graph issues → blocked; missing/unverifiable scope or
 * any write-scope overlap → serial. Never guesses from insufficient input.
 */
export function evaluateParallelSafety(
  taskGraph: TaskGraphResult,
  tasks: Array<{ id: string; body: string }>,
): ParallelReport {
  if (taskGraph.issues.length > 0) {
    return {
      decision: "blocked",
      eligible: [],
      parallel: [],
      serial: [],
      conflicts: [],
      taskGraphIssues: [...new Set(taskGraph.issues.map((issue) => issue.code))],
    };
  }

  // Eligibility mirrors the tasks-active priority: resumable active work
  // before starting new runnable work.
  const eligible = taskGraph.resumableActive.length > 0
    ? [...taskGraph.resumableActive]
    : [...taskGraph.runnable];
  const bodyById = new Map(tasks.map((task) => [task.id, task.body]));
  const reasonsById = new Map<string, Set<SerialReason>>();
  const patternsById = new Map<string, ScopedPattern[]>();
  const addReason = (id: string, reason: SerialReason): void => {
    const reasons = reasonsById.get(id) ?? new Set<SerialReason>();
    reasons.add(reason);
    reasonsById.set(id, reasons);
  };

  for (const id of eligible) {
    const body = bodyById.get(id);
    const entries = body === undefined ? null : parseAffectedFiles(body);
    if (entries === null || entries.length === 0) {
      addReason(id, "scope-undeclared");
      continue;
    }
    const patterns: ScopedPattern[] = [];
    let hasOpaque = false;
    for (const entry of entries) {
      if ("opaque" in entry) hasOpaque = true;
      else patterns.push(entry.pattern as ScopedPattern);
    }
    if (hasOpaque) addReason(id, "scope-unverifiable");
    patternsById.set(id, patterns);
  }

  // Pairwise write-scope overlap: any task in a conflict pair is serial.
  const conflicts: ParallelConflict[] = [];
  const seenConflicts = new Set<string>();
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      const patternsA = patternsById.get(a);
      const patternsB = patternsById.get(b);
      if (!patternsA || !patternsB) continue;
      for (const patternA of patternsA) {
        for (const patternB of patternsB) {
          const path = overlapPath(patternA, patternB);
          if (path === null) continue;
          const key = `${a} ${b} ${path}`;
          if (!seenConflicts.has(key)) {
            seenConflicts.add(key);
            conflicts.push({ a, b, path });
          }
          addReason(a, "write-conflict");
          addReason(b, "write-conflict");
        }
      }
    }
  }

  const serial = eligible
    .filter((id) => reasonsById.has(id))
    .map((id) => ({ id, reasons: [...reasonsById.get(id) ?? []].sort() }));
  const parallel = eligible.filter((id) => !reasonsById.has(id));
  return {
    decision: parallel.length > 1 ? "parallel" : "serial",
    eligible,
    parallel,
    serial,
    conflicts,
    taskGraphIssues: [],
  };
}
