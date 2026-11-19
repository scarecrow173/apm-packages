"use strict";

import { spawnSync } from "node:child_process";
import { scopeFromEntries, scopeKey, toScopeEntry, type ScopePattern } from "./scope_entry";
import { loadRun, resolveStateRoot, type TaskRecord } from "../../../lib/execution_store";

export type SliceOutcome = {
  taskId: string;
  declaredScope: string[];     // normalized paths from the task record's scope (files + dir prefixes)
  touchedPaths: string[];      // actual diff (from collectChangedPaths or supplied)
};
export type MergeFinding = {
  code: "scope-violation" | "write-collision";
  taskId?: string; path?: string; message: string;
};
export type MergeReport = { verdict: "merge" | "merge-review" | "blocked"; findings: MergeFinding[] };
export type MergeVerifyOptions = {
  /** Execution Store root override — the protected subtree a slice's diff may never enter. */
  stateRoot?: string;
  /** Authorization for a state root that resolves outside the checkout. */
  allowExternalRoot?: boolean;
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
 * scope_entry.ts `normalizeScopePath`: absolute paths (POSIX root, UNC,
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
 * Whether a task-record-declared pattern covers a supplied scope claim. A file
 * entry covers only an identical file claim; a dir entry covers any claim
 * inside its prefix. A file entry never covers a directory claim — `src/a`
 * declared as a file does not authorize the `src/a/` subtree.
 */
function declaredCovers(declared: ScopePattern, claim: ScopePattern): boolean {
  if (claim.kind === "dir" && declared.kind === "file") return false;
  return scopeContains(declared, claim.path);
}

/**
 * The Execution Store holds every task record's authority (status, deps,
 * scope): a slice diff reaching inside the state root could rewrite a task
 * record out-of-band, exactly the authority bypass the v2 task-doc subtree
 * protection existed to stop. A touched path inside the resolved root is
 * therefore blocked-severity, never merge-review. External roots are outside
 * the checkout by definition — a repo-relative diff cannot reach them, so the
 * check is vacuous when `repoRelative` is null.
 */
function isStorePath(normalized: string, storeRootRelative: string | null): boolean {
  if (storeRootRelative === null) return false;
  const key = scopeKey(normalized);
  const rootKey = scopeKey(storeRootRelative);
  return key === rootKey || key.startsWith(`${rootKey}/`);
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

// Severity ladder: store-path scope violations, unverifiable paths, and
// malformed slice inputs are blocked-severity (2); write-collision and
// other scope violations are merge-review-severity (1). Bad input always
// fails closed. Findings sort severity-descending so the worst kinds
// surface first; the sort is stable, preserving discovery order.
const BLOCKED_SEVERITY = 2;
const REVIEW_SEVERITY = 1;

type RankedFinding = MergeFinding & { severity: number };

/**
 * Verified binding between a slice and its claimed task record. The task
 * record is the scope authority (its `scope` field declares what the task
 * may write), so the claim is verified before it is used. A slice naming a
 * task that is not in the run is blocked — tasks from a different run (or
 * invented ids) can never bind scope.
 */
type RunTaskBinding = {
  /** The bound record once the claim holds; null otherwise. */
  record: TaskRecord | null;
  /** The record's declared scope once bound; null otherwise. */
  docScope: { patterns: ScopePattern[]; hasOpaque: boolean } | null;
};

/**
 * Bind a slice's `taskId` to a task record in the run and read its declared
 * scope. A missing binding pushes a blocked finding — the claim grants no
 * scope authority — while a bound record's `scope` resolves through the
 * shared scope-entry rules: an empty declaration (or an opaque entry) means
 * nothing supplied can be confirmed declared, so every claim inflates.
 */
function bindRunTask(
  outcome: SliceOutcome,
  runId: string,
  tasksById: Map<string, TaskRecord>,
  findings: RankedFinding[],
): RunTaskBinding {
  const record = tasksById.get(outcome.taskId);
  if (!record) {
    findings.push({
      code: "scope-violation",
      taskId: outcome.taskId,
      message: `${outcome.taskId} is not a task in run ${runId}; the slice cannot bind its declared scope`,
      severity: BLOCKED_SEVERITY,
    });
    return { record: null, docScope: null };
  }
  return {
    record,
    // An empty scope resolves to zero patterns, so every supplied scope
    // entry is an inflated claim — identical to the v2 absent-section rule.
    docScope: scopeFromEntries(record.scope) ?? { patterns: [], hasOpaque: false },
  };
}

/**
 * Deterministic merge verification over completed slices: the actual diff of
 * each slice must stay inside its task record's declared scope, and no two
 * slices may touch the same path. The claimed `taskId`
 * binds to the run before it grants anything — a claim that does not verify
 * blocks. An empty slice list, duplicate task IDs, or unverifiable paths are
 * malformed input and fail closed to blocked. Verification evidence is an
 * Evidence Store concern (Git-untracked records under `.apm/state/`) — it
 * never appears in a merge diff, so this check has no repo-path evidence
 * surface (Issue #249 removed the `docs/impl/` one).
 */
export function verifyParallelMerge(
  cwd: string,
  runId: string,
  slices: SliceOutcome[],
  options: MergeVerifyOptions = {},
): MergeReport {
  // The run supplies task membership + declared-scope authority; the state
  // root supplies the protected subtree a slice diff may never enter. Both
  // resolve before any slice is examined — a store failure is a hard error,
  // never a silently-unprotected verify.
  const resolvedRoot = resolveStateRoot(cwd, {
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  });
  const snapshot = loadRun(cwd, runId, {
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  });
  const tasksById = new Map(snapshot.tasks.map((task) => [task.taskId, task]));

  if (slices.length === 0) return { verdict: "blocked", findings: [] };

  const findings: RankedFinding[] = [];

  // Slice identity must be unique — duplicated task IDs let one slice's diff
  // masquerade as another's and would mask write-collisions.
  const seenTaskIds = new Set<string>();
  for (const outcome of slices) {
    if (!outcome.taskId.trim()) {
      findings.push({
        code: "scope-violation",
        taskId: outcome.taskId,
        message: "slice outcome has an empty task ID; it cannot bind a task record's scope",
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

  // taskId is asserted, not trusted: bind each claim to a run task before
  // it is used as scope authority. A failed binding is already a blocked
  // finding and grants nothing.
  const bound = slices.map((outcome) => bindRunTask(outcome, runId, tasksById, findings));

  for (const [index, outcome] of slices.entries()) {
    const { docScope } = bound[index];
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
      // Scope inflation: a supplied entry not covered by the task record's own
      // declaration is a claim wider than authorized → blocked. When the
      // record's scope is unverifiable (opaque entries), nothing supplied can
      // be confirmed declared — every entry blocks.
      if (docScope !== null) {
        const covered = !docScope.hasOpaque
          && docScope.patterns.some((declared) => declaredCovers(declared, pattern));
        if (!covered) {
          findings.push({
            code: "scope-violation",
            taskId: outcome.taskId,
            path: rawScope,
            message: docScope.hasOpaque
              ? `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} cannot be verified: the task record's scope is not verifiable`
              : `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} is not declared by the task record's scope`,
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
      // The Execution Store is never writable via a repo diff: a touched
      // path inside the state root would bypass the record CAS that guards
      // task status/scope — blocked-severity, checked before the scope
      // short-circuit on purpose.
      if (isStorePath(touched, resolvedRoot.repoRelative)) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: touched,
          message: `${outcome.taskId} touched ${touched} inside the execution state root ${resolvedRoot.repoRelative} — store records are not writable worktree paths`,
          severity: BLOCKED_SEVERITY,
        });
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
