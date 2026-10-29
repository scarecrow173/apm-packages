"use strict";

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import { parseAffectedScope } from "./parallel_safety";
import { scopeKey, toScopeEntry, type ScopePattern } from "./scope_entry";

export type SliceOutcome = {
  taskId: string;
  declaredScope: string[];     // normalized paths from ## Affected Files (files + dir prefixes)
  touchedPaths: string[];      // actual diff (from collectChangedPaths or supplied)
  evidencePaths: string[];
  taskDocPath: string;         // asserted; must bind to the slice's own doc (e.g. docs/tasks/0002-task.md)
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

/**
 * Interpret a declared-scope string via the shared scope-entry rules
 * (`scope_entry.ts`): opaque prose — bare words like `auth module`, markup-
 * wrapped text, non-path entries — and entries failing strict path rules
 * return null (unverifiable — the caller blocks).
 */
function parseScopeEntry(raw: string): ScopePattern | null {
  const resolution = toScopeEntry(raw);
  return "opaque" in resolution ? null : resolution.pattern;
}

/** Dir prefixes match only on a `/` boundary, same rule as overlapPath. */
function scopeContains(pattern: ScopePattern, touched: string): boolean {
  const key = scopeKey(touched);
  const patternKey = scopeKey(pattern.path);
  if (pattern.kind === "file") return key === patternKey;
  return key === patternKey || key.startsWith(`${patternKey}/`);
}

/**
 * Whether a task-doc-declared pattern covers a supplied scope claim. A file
 * entry covers only an identical file claim; a dir entry covers any claim
 * inside its prefix. A file entry never covers a directory claim — `src/a`
 * declared as a file does not authorize the `src/a/` subtree.
 */
function declaredCovers(declared: ScopePattern, claim: ScopePattern): boolean {
  if (claim.kind === "dir" && declared.kind === "file") return false;
  return scopeContains(declared, claim.path);
}

/**
 * Task documents under the task dir carry status/front matter; an out-of-scope
 * write there can silently mark a task done or rewrite its relations, so a
 * violation targeting this subtree is blocked rather than merge-review.
 */
function isTaskDocPath(normalized: string, taskDir: string): boolean {
  const key = scopeKey(normalized);
  const dirKey = scopeKey(taskDir);
  return key === dirKey || key.startsWith(`${dirKey}/`);
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
    // A repo-relative path can still escape the checkout through a symlink
    // (for example a docs/impl/ entry pointing outside the repo): resolve the
    // real path and require it to stay under the resolved cwd.
    const resolved = fs.realpathSync(path.join(cwd, normalized));
    const root = fs.realpathSync(cwd);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return false;
    return fs.readFileSync(resolved, "utf8").includes(taskId);
  } catch {
    return false;
  }
}

/**
 * An evidence artifact may only live under docs/impl/ or be the slice's own
 * task doc; anywhere else is out of the evidence scope by definition.
 */
function isAllowedEvidencePath(normalized: string, taskDocPath: string): boolean {
  const key = scopeKey(normalized);
  return key.startsWith("docs/impl/") || key === scopeKey(taskDocPath);
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
 * Verified binding between a slice and its claimed task document. The task
 * doc is scope authority and grants the own-doc write exemption, so the claim
 * is verified before either is used. A failed binding grants nothing: the
 * claimed path keeps its normal task-doc protection and supplied scope
 * entries cannot appeal to the doc's declaration.
 */
type TaskDocBinding = {
  /** Normalized own-doc path once bound; null when the claim failed. */
  ownTaskDoc: string | null;
  /** The doc's `## Affected Files` once bound; null otherwise. */
  docScope: { patterns: ScopePattern[]; hasOpaque: boolean } | null;
};

/**
 * Verify a slice's `taskDocPath` claim and, when it holds, read the doc's
 * declared scope. The claim is bound only when the normalized path sits
 * inside the task-doc subtree, the file exists and parses inside the
 * checkout, and it carries the slice's own task ID — front matter `id` (the
 * task-doc convention), else the task ID literally present in the body. A
 * different front matter `id` marks another task's document, and body
 * mentions never override it. Every failure pushes a blocked finding and
 * returns the unbound result — the claim grants no exemption or authority.
 */
function bindTaskDoc(
  cwd: string,
  outcome: SliceOutcome,
  taskDir: string,
  findings: RankedFinding[],
): TaskDocBinding {
  const unbound: TaskDocBinding = { ownTaskDoc: null, docScope: null };
  const taskDocPath = normalizeVerifiedPath(outcome.taskDocPath);
  if (taskDocPath === null) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: outcome.taskDocPath,
      message: `${outcome.taskId} taskDocPath ${JSON.stringify(outcome.taskDocPath)} is not a verifiable repo-relative path`,
      severity: BLOCKED_SEVERITY,
    });
    return unbound;
  }
  if (!isTaskDocPath(taskDocPath, taskDir)) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} is outside the task-doc subtree ${taskDir}; it cannot be the slice's own task document`,
      severity: BLOCKED_SEVERITY,
    });
    return unbound;
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    // Same containment rule as evidence binding: a symlinked task doc that
    // resolves outside the checkout cannot serve as scope authority.
    const resolved = fs.realpathSync(path.join(cwd, taskDocPath));
    const root = fs.realpathSync(cwd);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("task doc resolves outside the checkout");
    }
    parsed = matter(fs.readFileSync(resolved, "utf8"));
  } catch {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} is missing, unreadable, or resolves outside the repository; the slice's task document cannot be verified`,
      severity: BLOCKED_SEVERITY,
    });
    return unbound;
  }
  const frontId = typeof parsed.data.id === "string" ? parsed.data.id : null;
  const bound = outcome.taskId.trim().length > 0
    && (frontId !== null ? frontId === outcome.taskId : parsed.content.includes(outcome.taskId));
  if (!bound) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} does not carry the slice's task ID; it is not the slice's own task document`,
      severity: BLOCKED_SEVERITY,
    });
    return unbound;
  }
  return {
    ownTaskDoc: taskDocPath,
    // An absent or empty ## Affected Files resolves to zero patterns, so
    // every supplied scope entry is an inflated claim.
    docScope: parseAffectedScope(parsed.content) ?? { patterns: [], hasOpaque: false },
  };
}

/**
 * Deterministic merge verification over completed slices: the actual diff of
 * each slice must stay inside its declared scope, no two slices may touch the
 * same path, and each evidence file must live in the slice's evidence scope
 * and bind to the slice's own task ID. The claimed `taskDocPath` is bound to
 * the slice before it grants anything — scope authority or the own-doc write
 * exemption — and a claim that does not verify blocks. An empty slice list,
 * duplicate task IDs, or unverifiable paths are malformed input and fail
 * closed to blocked.
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

  // taskDocPath is asserted, not trusted: bind each claim to the slice before
  // it is used as scope authority or the own-doc write exemption. A failed
  // binding is already a blocked finding and grants nothing.
  const bound = slices.map((outcome) => bindTaskDoc(cwd, outcome, taskDir, findings));

  for (const [index, outcome] of slices.entries()) {
    const { ownTaskDoc, docScope } = bound[index];
    // Only the slice's declared evidence artifacts under docs/impl/ are
    // contract-implied writes; undeclared docs/impl/ writes go through the
    // normal scope check like any other path.
    const declaredEvidenceKeys = new Set(
      outcome.evidencePaths
        .map((raw) => normalizeVerifiedPath(raw))
        .filter((normalized): normalized is string => normalized !== null)
        .map(scopeKey)
        .filter((key) => key.startsWith("docs/impl/")),
    );
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
        continue;
      }
      patterns.push(pattern);
      // Scope inflation: a supplied entry not covered by the task doc's own
      // declaration is a claim wider than authorized → blocked. When the doc
      // side is unverifiable (opaque entries), nothing supplied can be
      // confirmed declared — every entry blocks.
      if (docScope !== null) {
        const covered = !docScope.hasOpaque
          && docScope.patterns.some((declared) => declaredCovers(declared, pattern));
        if (!covered) {
          findings.push({
            code: "scope-violation",
            taskId: outcome.taskId,
            path: rawScope,
            message: docScope.hasOpaque
              ? `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} cannot be verified: the task doc's ## Affected Files is not verifiable`
              : `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} is not declared by the task doc's ## Affected Files`,
            severity: BLOCKED_SEVERITY,
          });
        }
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
      const touchedKey = scopeKey(touched);
      // Another task's document is never writable: a scope declaration
      // cannot grant it, since status/front-matter writes silently alter
      // other tasks. Checked before the scope short-circuit on purpose.
      if (isTaskDocPath(touched, taskDir) && (ownTaskDoc === null || touchedKey !== scopeKey(ownTaskDoc))) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: touched,
          message: `${outcome.taskId} touched task document ${touched} outside its own task document`,
          severity: BLOCKED_SEVERITY,
        });
        continue;
      }
      // Contract-implied writes need no scope declaration: the slice's own
      // task doc (its required status/front-matter update) and the slice's
      // declared evidence artifacts under docs/impl/ (the required
      // implementation record listed in evidencePaths).
      if ((ownTaskDoc !== null && touchedKey === scopeKey(ownTaskDoc)) || declaredEvidenceKeys.has(touchedKey)) {
        continue;
      }
      if (patterns.some((pattern) => scopeContains(pattern, touched))) continue;
      findings.push({
        code: "scope-violation",
        taskId: outcome.taskId,
        path: touched,
        message: `${outcome.taskId} touched ${touched} outside its declared scope`,
        severity: REVIEW_SEVERITY,
      });
    }
  }

  const touchersByPath = new Map<string, { path: string; taskIds: string[] }>();
  for (const outcome of slices) {
    for (const raw of outcome.touchedPaths) {
      const touched = normalizeVerifiedPath(raw) ?? raw;
      if (!touched) continue;
      const key = scopeKey(touched);
      const entry = touchersByPath.get(key) ?? { path: touched, taskIds: [] };
      if (!entry.taskIds.includes(outcome.taskId)) entry.taskIds.push(outcome.taskId);
      touchersByPath.set(key, entry);
    }
  }
  for (const { path: touched, taskIds } of touchersByPath.values()) {
    if (taskIds.length < 2) continue;
    findings.push({
      code: "write-collision",
      path: touched,
      message: `${touched} was touched by multiple slices (${taskIds.join(", ")}); refusing last-writer-win`,
      severity: REVIEW_SEVERITY,
    });
  }

  for (const [index, outcome] of slices.entries()) {
    // The bound own-doc path, not the asserted one: an unbound claim may not
    // admit evidence "as the slice's own task doc" either.
    const taskDocPath = bound[index].ownTaskDoc;
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
