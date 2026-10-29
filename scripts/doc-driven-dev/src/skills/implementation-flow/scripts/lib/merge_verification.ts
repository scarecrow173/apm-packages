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
export type MergeVerifyOptions = {
  /** Task-doc subtree whose out-of-scope writes are blocked-severity. */
  taskDir?: string;            // default "docs/tasks"
};

/**
 * Lenient normalizer for git-reported paths only: converts backslashes, strips
 * leading `./`, and collapses empty/`.` segments. Git paths are trustworthy
 * repo-relative strings, so `..`, `*`, and `?` are preserved verbatim — the
 * strict normalizer on the verify side will reject them fail-closed.
 */
function normalizeGitPath(raw: string): string {
  let text = raw.replace(/\\/g, "/");
  while (text.startsWith("./")) text = text.slice(2);
  return text
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

/**
 * Strict normalizer for caller-supplied paths, mirroring the reject rules in
 * parallel_safety.ts `normalizeScopePath`: absolute paths (POSIX root, UNC,
 * drive letter), `..` escapes, `*`/`?` glob segments, and empty results are
 * unverifiable and return null instead of being silently rewritten.
 */
function normalizeVerifiedPath(raw: string): string | null {
  let text = raw.trim().replace(/\\/g, "/");
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null;
  while (text.startsWith("./")) text = text.slice(2);
  const segments = text.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) {
    return null;
  }
  const normalized = segments.join("/");
  return normalized ? normalized : null;
}

type ScopePattern = { kind: "file" | "dir"; path: string };

/**
 * Interpret a declared-scope string: a trailing `/` or `/*` marks a dir
 * prefix; anything else is an exact-match file entry. Entries failing the
 * strict path rules return null (unverifiable — the caller blocks).
 */
function parseScopeEntry(raw: string): ScopePattern | null {
  let text = raw.trim().replace(/\\/g, "/");
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
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) {
    return null;
  }
  const normalized = segments.join("/");
  if (!normalized) return null;
  return { kind: isDir ? "dir" : "file", path: normalized };
}

/** Dir prefixes match only on a `/` boundary, same rule as overlapPath. */
function scopeContains(pattern: ScopePattern, touched: string): boolean {
  if (pattern.kind === "file") return touched === pattern.path;
  return touched === pattern.path || touched.startsWith(`${pattern.path}/`);
}

/**
 * Task documents under the task dir carry status/front matter; an out-of-scope
 * write there can silently mark a task done or rewrite its relations, so a
 * violation targeting this subtree is blocked rather than merge-review.
 */
function isTaskDocPath(normalized: string, taskDir: string): boolean {
  return normalized === taskDir || normalized.startsWith(`${taskDir}/`);
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Collect the actual changed paths in a repo: the union of
 * `git diff --name-only <baseRef>` (tracked modifications, staged or not) and
 * `git status --porcelain` (untracked + renamed paths). Returns deduplicated,
 * forward-slash-normalized, sorted repo-relative paths.
 *
 * Fail-closed: a baseRef starting with `-` (option injection) or one that does
 * not resolve to a commit throws before diffing, as does any git failure —
 * an undetermined diff is never reported as empty.
 */
export function collectChangedPaths(repo: string, baseRef = "HEAD"): string[] {
  if (baseRef.startsWith("-")) {
    throw new Error(`git diff baseRef ${JSON.stringify(baseRef)} rejected: refs must not start with "-"`);
  }
  git(repo, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  const changed = new Set<string>();
  // `-z` + `core.quotepath=false` yields exact NUL-separated paths — no
  // quoting/unescaping needed even for spaces or non-ASCII filenames.
  // `--no-renames` expands renames to delete+add so BOTH endpoints surface —
  // a rename out of a protected path must not masquerade as a pure addition.
  for (const entry of git(repo, ["-c", "core.quotepath=false", "diff", "--name-only", "-z", "--no-renames", baseRef]).split("\0")) {
    if (entry) changed.add(normalizeGitPath(entry));
  }
  // `-uall`: report every untracked file instead of collapsing fully
  // untracked directories into `dir/` entries.
  const statusEntries = git(repo, ["-c", "core.quotepath=false", "status", "--porcelain", "-z", "-uall"]).split("\0");
  for (let index = 0; index < statusEntries.length; index += 1) {
    const entry = statusEntries[index];
    if (!entry) continue;
    // Porcelain -z: `XY <path>`; rename/copy entries carry the destination
    // here and the SOURCE in the following NUL field. Record the source too —
    // dropping it would hide a rename out of a protected path — then skip it.
    const status = entry.slice(0, 2);
    const entryPath = entry.slice(3);
    if (entryPath) changed.add(normalizeGitPath(entryPath));
    if (status.includes("R") || status.includes("C")) {
      const source = statusEntries[index + 1];
      if (source) changed.add(normalizeGitPath(source));
      index += 1;
    }
  }
  return [...changed].sort();
}

/**
 * Evidence binding check: the evidence file must have a verifiable
 * repo-relative path, exist, be readable as UTF-8, and literally contain the
 * slice's own task ID (front matter or body). Any failure → false.
 */
export function verifyEvidenceBinding(cwd: string, evidencePath: string, taskId: string): boolean {
  // An empty task ID would pass `.includes("")` on any file — fail closed.
  if (!taskId.trim()) return false;
  const normalized = normalizeVerifiedPath(evidencePath);
  if (normalized === null) return false;
  try {
    return fs.readFileSync(path.join(cwd, normalized), "utf8").includes(taskId);
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
// merge-review-severity (1). Unverifiable paths and malformed slice inputs
// are also blocked-severity — bad input always fails closed. Findings sort
// severity-descending so the worst kinds surface first; the sort is stable,
// preserving discovery order.
const BLOCKED_SEVERITY = 2;
const REVIEW_SEVERITY = 1;

type RankedFinding = MergeFinding & { severity: number };

/**
 * Deterministic merge verification over completed slices: the actual diff of
 * each slice must stay inside its declared scope, no two slices may touch the
 * same path, and each evidence file must live in the slice's evidence scope
 * and bind to the slice's own task ID. An empty slice list, duplicate task
 * IDs, or unverifiable paths are malformed input and fail closed to blocked.
 */
export function verifyParallelMerge(
  cwd: string,
  slices: SliceOutcome[],
  options: MergeVerifyOptions = {},
): MergeReport {
  if (slices.length === 0) return { verdict: "blocked", findings: [] };

  // The protected task-doc subtree defaults to docs/tasks; an unverifiable
  // override falls back to the default rather than disabling protection.
  const taskDir = normalizeVerifiedPath(options.taskDir ?? "docs/tasks") ?? "docs/tasks";
  const findings: RankedFinding[] = [];

  // Slice identity must be unique — duplicated task IDs let one slice's diff
  // or evidence masquerade as another's and would mask write-collisions.
  const seenTaskIds = new Set<string>();
  for (const outcome of slices) {
    if (!outcome.taskId.trim()) {
      findings.push({
        code: "evidence-mismatch",
        taskId: outcome.taskId,
        message: "slice outcome has an empty task ID; evidence cannot be bound",
        severity: BLOCKED_SEVERITY,
      });
    } else if (seenTaskIds.has(outcome.taskId)) {
      findings.push({
        code: "write-collision",
        taskId: outcome.taskId,
        message: `duplicate slice outcome for ${outcome.taskId}; each slice must carry a unique task ID`,
        severity: BLOCKED_SEVERITY,
      });
    }
    seenTaskIds.add(outcome.taskId);
  }

  for (const outcome of slices) {
    const patterns: ScopePattern[] = [];
    for (const rawScope of outcome.declaredScope) {
      const pattern = parseScopeEntry(rawScope);
      if (pattern === null) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: rawScope,
          message: `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY,
        });
      } else {
        patterns.push(pattern);
      }
    }
    for (const raw of outcome.touchedPaths) {
      const touched = normalizeVerifiedPath(raw);
      if (touched === null) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: raw,
          message: `${outcome.taskId} touched path ${JSON.stringify(raw)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY,
        });
        continue;
      }
      if (patterns.some((pattern) => scopeContains(pattern, touched))) continue;
      const taskDocViolation = isTaskDocPath(touched, taskDir);
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
      const touched = normalizeVerifiedPath(raw) ?? raw;
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
    const taskDocPath = normalizeVerifiedPath(outcome.taskDocPath);
    if (taskDocPath === null) {
      findings.push({
        code: "evidence-mismatch",
        taskId: outcome.taskId,
        path: outcome.taskDocPath,
        message: `${outcome.taskId} taskDocPath ${JSON.stringify(outcome.taskDocPath)} is not a verifiable repo-relative path`,
        severity: BLOCKED_SEVERITY,
      });
    }
    for (const raw of outcome.evidencePaths) {
      const evidencePath = normalizeVerifiedPath(raw);
      if (evidencePath === null) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: raw,
          message: `${outcome.taskId} evidence path ${JSON.stringify(raw)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY,
        });
        continue;
      }
      if (taskDocPath === null || !isAllowedEvidencePath(evidencePath, taskDocPath)) {
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
