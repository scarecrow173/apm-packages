"use strict";

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type SliceOutcome = {
  taskId: string;
  declaredScope: string[];     // normalized paths from ## Affected Files (files + dir prefixes)
  touchedPaths: string[];      // actual diff (from collectChangedPaths or supplied)
  evidencePaths: string[];
  taskDocPath: string;         // e.g. docs/tasks/0002-task.md
};
export type MergeFinding = {
  code: "scope-violation" | "write-collision" | "evidence-mismatch";
  taskId?: string; path?: string; message: string;
};
export type MergeReport = { verdict: "merge" | "merge-review" | "blocked"; findings: MergeFinding[] };

/**
 * Normalize a repo-relative path to forward-slash form for comparison.
 * Scope entries keep their trailing marker; callers strip it via
 * parseScopeEntry so dir prefixes survive normalization.
 */
function normalizePath(raw: string): string {
  let text = raw.trim().replace(/\\/g, "/");
  while (text.startsWith("./")) text = text.slice(2);
  return text
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

type ScopePattern = { kind: "file" | "dir"; path: string };

/**
 * Interpret a declared-scope string: a trailing `/` or `/*` marks a dir
 * prefix; anything else is an exact-match file entry. Mirrors the
 * affected-files boundary rules in parallel_safety.ts.
 */
function parseScopeEntry(raw: string): ScopePattern {
  let text = raw.trim().replace(/\\/g, "/");
  while (text.startsWith("./")) text = text.slice(2);
  let isDir = false;
  if (text.endsWith("/*")) {
    isDir = true;
    text = text.slice(0, -2);
  } else if (text.endsWith("/")) {
    isDir = true;
    text = text.replace(/\/+$/, "");
  }
  const normalized = text
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  return { kind: isDir ? "dir" : "file", path: normalized };
}

/** Dir prefixes match only on a `/` boundary, same rule as overlapPath. */
function scopeContains(pattern: ScopePattern, touched: string): boolean {
  if (pattern.kind === "file") return touched === pattern.path;
  return touched === pattern.path || touched.startsWith(`${pattern.path}/`);
}

/**
 * Task documents under docs/tasks/ carry status/front matter; an out-of-scope
 * write there can silently mark a task done or rewrite its relations, so a
 * violation targeting this subtree is blocked rather than merge-review.
 */
function isTaskDocPath(normalized: string): boolean {
  return normalized.startsWith("docs/tasks/");
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Collect the actual changed paths in a repo: the union of
 * `git diff --name-only <baseRef>` (tracked modifications, staged or not)
 * and `git status --porcelain` (untracked + renamed paths). Returns
 * deduplicated, forward-slash-normalized, sorted repo-relative paths.
 * Throws when git cannot answer — never guesses an empty diff.
 */
export function collectChangedPaths(repo: string, baseRef = "HEAD"): string[] {
  const changed = new Set<string>();
  for (const line of git(repo, ["diff", "--name-only", baseRef]).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) changed.add(normalizePath(trimmed));
  }
  for (const line of git(repo, ["status", "--porcelain"]).split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Porcelain format: two status columns, a space, then the path; renames
    // append " -> <new path>" and unusual names are double-quoted.
    let entry = line.slice(3);
    const arrow = entry.indexOf(" -> ");
    if (arrow >= 0) entry = entry.slice(arrow + 4);
    entry = entry.trim();
    if (entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1);
    if (entry) changed.add(normalizePath(entry));
  }
  return [...changed].sort();
}

/**
 * Evidence binding check: the evidence file must exist, be readable as UTF-8,
 * and literally contain the slice's own task ID (front matter or body).
 * Any read failure fails closed to false.
 */
export function verifyEvidenceBinding(cwd: string, evidencePath: string, taskId: string): boolean {
  try {
    return fs.readFileSync(path.join(cwd, evidencePath), "utf8").includes(taskId);
  } catch {
    return false;
  }
}

/**
 * An evidence artifact may only live under docs/impl/ or be the slice's own
 * task doc; anywhere else is out of the evidence scope by definition.
 */
function isAllowedEvidencePath(normalized: string, taskDocPath: string): boolean {
  return normalized.startsWith("docs/impl/") || normalized === taskDocPath;
}

// Severity ladder: evidence-mismatch and task-doc scope violations are
// blocked-severity (2); write-collision and other scope violations are
// merge-review-severity (1). Findings sort severity-descending so the worst
// kinds surface first; the sort is stable, preserving discovery order.
const BLOCKED_SEVERITY = 2;
const REVIEW_SEVERITY = 1;

type RankedFinding = MergeFinding & { severity: number };

/**
 * Deterministic merge verification over completed slices: the actual diff of
 * each slice must stay inside its declared scope, no two slices may touch the
 * same path, and each evidence file must live in the slice's evidence scope
 * and bind to the slice's own task ID.
 */
export function verifyParallelMerge(cwd: string, slices: SliceOutcome[]): MergeReport {
  const findings: RankedFinding[] = [];

  for (const outcome of slices) {
    const patterns = outcome.declaredScope.map(parseScopeEntry);
    for (const raw of outcome.touchedPaths) {
      const touched = normalizePath(raw);
      if (!touched || patterns.some((pattern) => scopeContains(pattern, touched))) continue;
      const taskDocViolation = isTaskDocPath(touched);
      findings.push({
        code: "scope-violation",
        taskId: outcome.taskId,
        path: touched,
        message: taskDocViolation
          ? `${outcome.taskId} touched task document ${touched} outside its declared scope`
          : `${outcome.taskId} touched ${touched} outside its declared scope`,
        severity: taskDocViolation ? BLOCKED_SEVERITY : REVIEW_SEVERITY,
      });
    }
  }

  const touchersByPath = new Map<string, string[]>();
  for (const outcome of slices) {
    for (const raw of outcome.touchedPaths) {
      const touched = normalizePath(raw);
      if (!touched) continue;
      const touchers = touchersByPath.get(touched) ?? [];
      if (!touchers.includes(outcome.taskId)) touchers.push(outcome.taskId);
      touchersByPath.set(touched, touchers);
    }
  }
  for (const [touched, touchers] of touchersByPath) {
    if (touchers.length < 2) continue;
    findings.push({
      code: "write-collision",
      path: touched,
      message: `${touched} was touched by multiple slices (${touchers.join(", ")}); refusing last-writer-win`,
      severity: REVIEW_SEVERITY,
    });
  }

  for (const outcome of slices) {
    const taskDocPath = normalizePath(outcome.taskDocPath);
    for (const raw of outcome.evidencePaths) {
      const evidencePath = normalizePath(raw);
      if (!isAllowedEvidencePath(evidencePath, taskDocPath)) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: evidencePath,
          message: `${outcome.taskId} evidence ${evidencePath} is outside docs/impl/ and the slice's own task doc`,
          severity: BLOCKED_SEVERITY,
        });
        continue;
      }
      if (!verifyEvidenceBinding(cwd, evidencePath, outcome.taskId)) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: evidencePath,
          message: `${outcome.taskId} evidence ${evidencePath} is missing or does not reference the task ID`,
          severity: BLOCKED_SEVERITY,
        });
      }
    }
  }

  findings.sort((left, right) => right.severity - left.severity);
  const verdict: MergeReport["verdict"] = findings.some((finding) => finding.severity === BLOCKED_SEVERITY)
    ? "blocked"
    : findings.length > 0
      ? "merge-review"
      : "merge";
  return {
    verdict,
    findings: findings.map(({ severity: _severity, ...finding }) => finding),
  };
}
