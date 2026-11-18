"use strict";

import type { TaskGraphResult } from "../../../doc-driven-dev-graph/scripts/lib/task_graph";
import {
  scopeFromEntries,
  scopeKey,
  type ScopePattern,
} from "./scope_entry";

export type ParallelVerdict = "parallel" | "serial" | "blocked";
export type ParallelConflict = { a: string; b: string; path: string };
export type SerialReason =
  | "scope-undeclared"        // no scope entries on the task record / empty
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
 * The declared write scope now comes from each task record's `scope` field in
 * the Execution Store (Issue #237) — the same entries the v2 `## Affected
 * Files` bullets carried, classified by the shared scope-entry rules.
 * Fail-closed: non-empty graph issues → blocked; missing/unverifiable scope or
 * any write-scope overlap → serial. Never guesses from insufficient input.
 */
export function evaluateParallelSafety(
  taskGraph: TaskGraphResult,
  tasks: Array<{ id: string; scope?: string[] }>,
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
  const scopeById = new Map(tasks.map((task) => [task.id, task.scope]));
  const reasonsById = new Map<string, Set<SerialReason>>();
  const patternsById = new Map<string, ScopedPattern[]>();
  const addReason = (id: string, reason: SerialReason): void => {
    const reasons = reasonsById.get(id) ?? new Set<SerialReason>();
    reasons.add(reason);
    reasonsById.set(id, reasons);
  };

  for (const id of eligible) {
    const scope = scopeFromEntries(scopeById.get(id));
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
