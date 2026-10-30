"use strict";

import type { TaskGraphResult } from "../../../doc-driven-dev-graph/scripts/lib/task_graph";
import {
  scopeKey,
  stripFencedBlocks,
  toScopeEntry,
  type ScopePattern,
} from "./scope_entry";
import { hasSection, sectionBody } from "../../../lib/markdown_sections";

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
type ScopedPattern = ScopePattern;

const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CHECKBOX_MARKER = /^\[[ xX]?\]\s*/;
const SUB_HEADING = /^#{3,6}\s/;
const TOP_HEADING = /^#{1,2}\s/;

/** Internal parse shape: patterns always carry their normalized path. */
type ParsedScopeEntry = { pattern: ScopedPattern } | { opaque: string };

/**
 * Parse the `## Affected Files` section of a task body into scope entries.
 * Returns null when the section is absent; an empty array when the section
 * is present but declares no usable entries (comments/placeholders only).
 * Fenced code blocks are stripped first — a heading or bullet inside a
 * fence is documentation, not a declaration — and bullets nested under a
 * `###`+ subsection (for example `### Notes`) never enter the scope.
 */
function parseAffectedEntries(body: string): ParsedScopeEntry[] | null {
  const stripped = stripFencedBlocks(body);
  if (!hasSection(stripped, "Affected Files")) return null;
  const section = sectionBody(stripped, "Affected Files");
  const entries: ParsedScopeEntry[] = [];
  let inSubSection = false;
  for (const line of section.split(/\r?\n/)) {
    if (SUB_HEADING.test(line)) {
      inSubSection = true;
      continue;
    }
    if (TOP_HEADING.test(line)) {
      inSubSection = false;
      continue;
    }
    if (inSubSection) continue;
    const match = BULLET_ITEM.exec(line);
    if (!match) continue;
    // Strip comments first, then trim so a leading checkbox marker is anchored.
    let text = match[1].replace(HTML_COMMENT, "").trim().replace(CHECKBOX_MARKER, "").trim();
    // Unwrap a single code span so `src/x.ts` still verifies as a path;
    // any leftover markup is caught by MARKUP_CHARS and turns opaque.
    if (text.length > 2 && text.startsWith("`") && text.endsWith("`")) {
      text = text.slice(1, -1).trim();
    }
    if (!text) continue;
    entries.push(toScopeEntry(text));
  }
  return entries;
}

export function parseAffectedFiles(body: string): ScopeEntry[] | null {
  return parseAffectedEntries(body);
}

/**
 * Resolved `## Affected Files` scope for authority-side comparison:
 * `null` when the section is absent (the task declares no scope at all),
 * otherwise the verifiable patterns plus whether any opaque entry exists.
 */
export function parseAffectedScope(body: string): { patterns: ScopedPattern[]; hasOpaque: boolean } | null {
  const entries = parseAffectedEntries(body);
  if (entries === null) return null;
  const patterns: ScopedPattern[] = [];
  let hasOpaque = false;
  for (const entry of entries) {
    if ("opaque" in entry) hasOpaque = true;
    else patterns.push(entry.pattern);
  }
  return { patterns, hasOpaque };
}

/**
 * Returns the most specific conflicting path when two write patterns overlap:
 * file==file on equal paths, a dir prefix containing the other's path, or
 * dir∩dir when either prefix contains the other. Null when disjoint.
 */
function overlapPath(left: ScopedPattern, right: ScopedPattern): string | null {
  // Paths compare case-folded (Windows dev env) but report original case.
  const leftKey = scopeKey(left.path);
  const rightKey = scopeKey(right.path);
  if (left.kind === "file" && right.kind === "file") {
    return leftKey === rightKey ? left.path : null;
  }
  if (left.kind === "dir" && right.kind === "dir") {
    if (leftKey === rightKey) return left.path;
    if (leftKey.startsWith(`${rightKey}/`)) return left.path;
    if (rightKey.startsWith(`${leftKey}/`)) return right.path;
    return null;
  }
  const dir = left.kind === "dir" ? left : right;
  const file = left.kind === "dir" ? right : left;
  const dirKey = scopeKey(dir.path);
  const fileKey = scopeKey(file.path);
  if (fileKey === dirKey || fileKey.startsWith(`${dirKey}/`)) return file.path;
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
    const scope = body === undefined ? null : parseAffectedScope(body);
    if (scope === null || (scope.patterns.length === 0 && !scope.hasOpaque)) {
      addReason(id, "scope-undeclared");
      continue;
    }
    if (scope.hasOpaque) addReason(id, "scope-unverifiable");
    patternsById.set(id, scope.patterns);
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
          const key = `${a}\u0000${b}\u0000${path}`;
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
