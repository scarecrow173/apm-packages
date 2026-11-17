"use strict";

// ---------------------------------------------------------------------------
// Execution Store v1 — state-root boundary (Issue #236)
// ---------------------------------------------------------------------------
//
// Where the store may put state, verified BEFORE anything is written:
//
//   default root    <checkout>/.apm/state/doc-driven-dev — always inside the
//                   worktree, per-worktree by construction.
//   shared root     an explicit `stateRoot` outside the checkout — allowed
//                   only with `allowExternalRoot`; the store never picks an
//                   outside location on its own.
//   gitignore       inside a work tree, `git check-ignore` must cover the
//                   root; outside Git, `.gitignore` files are evaluated
//                   directly. Unconfigured coverage refuses the write —
//                   execution state must never become committable by
//                   accident. `initStateRoot` is the explicit safe init: it
//                   writes the coverage line itself.
//   tracked         `git ls-files` must report nothing under the root —
//                   already-tracked state files refuse, since new writes
//                   would keep landing in Git.
//   containment     inside-checkout roots must stay inside lexically and by
//                   real path (a symlinked `.apm` or `state` ancestor cannot
//                   smuggle the store out); run ids are validated before a
//                   path is ever joined.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isInside, isInsideCheckout } from "../document_utils";
import { EXECUTION_STATE_ROOT } from "../schema_preflight";
import { StoreError } from "./atomic";
import { isValidId } from "./types";

type StoreRootOptions = {
  // Explicit root override — the only way a shared store location is used.
  stateRoot?: string;
  // Authorization for a `stateRoot` that resolves outside the checkout.
  allowExternalRoot?: boolean;
};

type ResolvedRoot = {
  root: string;
  external: boolean;
  // Checkout-relative path (posix separators) when `external` is false.
  repoRelative: string | null;
};

function toRepoRelative(cwd: string, absolute: string): string {
  return path.relative(path.resolve(cwd), absolute).split(path.sep).join("/");
}

function resolveStateRoot(cwd: string, options: StoreRootOptions = {}): ResolvedRoot {
  const checkout = path.resolve(cwd);
  if (options.stateRoot === undefined) {
    return {
      root: path.join(checkout, EXECUTION_STATE_ROOT),
      external: false,
      repoRelative: EXECUTION_STATE_ROOT,
    };
  }
  const root = path.resolve(checkout, options.stateRoot);
  if (isInside(checkout, root)) {
    return { root, external: false, repoRelative: toRepoRelative(checkout, root) };
  }
  if (options.allowExternalRoot !== true) {
    throw new StoreError(
      "external-root-not-authorized",
      `state root ${options.stateRoot} resolves outside the checkout — a shared/external store requires explicit allowExternalRoot`,
      { stateRoot: options.stateRoot },
    );
  }
  return { root, external: true, repoRelative: null };
}

// ---------------------------------------------------------------------------
// Git probes — exact answers when the checkout is a real work tree
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
  };
}

type GitContext =
  | { kind: "worktree" }
  | { kind: "none" };

// `git rev-parse` answers inside-work-tree for the directory itself AND for
// any parent-level work tree (the state root could live in a subdirectory
// checkout where `.git` only exists at an ancestor). When `.git` exists at
// the checkout but git cannot verify it, the environment is inconsistent —
// fail closed rather than fall back to the weaker file scan.
function gitContext(cwd: string): GitContext {
  const probe = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (probe.status === 0 && probe.stdout.trim() === "true") {
    return { kind: "worktree" };
  }
  if (fs.existsSync(path.join(cwd, ".git"))) {
    throw new StoreError(
      "boundary-git-unavailable",
      `.git exists at ${cwd} but \`git rev-parse\` failed (${probe.stderr || `exit ${probe.status}`}) — execution-state coverage cannot be verified`,
    );
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// .gitignore evaluation for the no-worktree fallback
// ---------------------------------------------------------------------------

type IgnorePattern = {
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  segments: string[];
};

function parseIgnorePattern(raw: string): IgnorePattern | null {
  let line = raw.replace(/\r$/, "");
  // Trailing spaces are literal unless escaped; comment/negation escapes are
  // only special as the first character.
  line = line.replace(/(?<!\\) +$/, "");
  if (line === "" || line.startsWith("#")) return null;
  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  }
  line = line.replace(/\\([!#\\ ])/g, "$1");
  let dirOnly = false;
  if (line.endsWith("/")) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  let anchored = false;
  if (line.startsWith("/")) {
    anchored = true;
    line = line.slice(1);
  } else if (line.includes("/")) {
    // A slash anywhere but the end anchors the pattern at the ignore file.
    anchored = true;
  }
  const segments = line.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) return null;
  return { negated, dirOnly, anchored, segments };
}

function segmentMatches(pattern: string, text: string): boolean {
  // fnmatch subset: `*` (in-segment), `?`, `[class]` — no escapes beyond the
  // first-char cases handled by parseIgnorePattern.
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")}$`,
  );
  return regex.test(text);
}

function patternMatchesPath(pattern: IgnorePattern, relSegments: string[], isDir: boolean): boolean {
  if (pattern.dirOnly && !isDir) return false;
  const target = pattern.anchored
    ? relSegments
    : relSegments.slice(Math.max(0, relSegments.length - pattern.segments.length));
  if (target.length !== pattern.segments.length) {
    // A non-anchored pattern shorter than the path only matches the tail;
    // `**` handling below deals with spanning patterns.
    if (!pattern.segments.includes("**")) return false;
  }
  // Match pattern segments against the candidate tail (or the whole path
  // when anchored) with `**` spanning zero or more segments.
  const matchFrom = (pi: number, ti: number): boolean => {
    if (pi === pattern.segments.length) return ti === target.length;
    const p = pattern.segments[pi];
    if (p === "**") {
      for (let skip = 0; ti + skip <= target.length; skip += 1) {
        if (matchFrom(pi + 1, ti + skip)) return true;
      }
      return false;
    }
    if (ti >= target.length || !segmentMatches(p, target[ti])) return false;
    return matchFrom(pi + 1, ti + 1);
  };
  return matchFrom(0, 0);
}

// Evaluate gitignore semantics against `relPath` (posix, checkout-relative)
// using the ignore files present at the checkout: `.git/info/exclude`, the
// root `.gitignore`, and `.gitignore` files in directories along the path —
// same precedence as Git (deepest file wins; within a file, last line wins).
// This fallback only runs outside a work tree, where Git itself cannot be
// asked; inside a work tree `git check-ignore` is the authority.
function ignoreDecision(cwd: string, relPath: string, isDir: boolean): boolean {
  const segments = relPath.split("/").filter(Boolean);
  const sources: Array<{ file: string; base: string[] }> = [
    { file: path.join(cwd, ".git", "info", "exclude"), base: [] },
    { file: path.join(cwd, ".gitignore"), base: [] },
  ];
  for (let i = 1; i < segments.length; i += 1) {
    const dir = segments.slice(0, i).join("/");
    sources.push({ file: path.join(cwd, dir, ".gitignore"), base: segments.slice(0, i) });
  }

  const isIgnored = (candidate: string, candidateIsDir: boolean): boolean => {
    const candSegments = candidate.split("/").filter(Boolean);
    // Deepest ignore file first — the first source with any matching
    // pattern decides, last matching line inside the file wins.
    for (let s = sources.length - 1; s >= 0; s -= 1) {
      const { file, base } = sources[s];
      if (base.length > candSegments.length) continue;
      if (!base.every((seg, i) => seg === candSegments[i])) continue;
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch { continue; }
      const rel = candSegments.slice(base.length);
      let decision: boolean | null = null;
      for (const line of raw.split("\n")) {
        const pattern = parseIgnorePattern(line);
        if (pattern === null) continue;
        if (patternMatchesPath(pattern, rel, candidateIsDir)) {
          decision = !pattern.negated;
        }
      }
      if (decision !== null) return decision;
    }
    return false;
  };

  // An excluded ancestor directory cannot be re-included below — the probe
  // is ignored the moment any parent directory matches.
  for (let depth = 1; depth < segments.length; depth += 1) {
    if (isIgnored(segments.slice(0, depth).join("/"), true)) return true;
  }
  return isIgnored(relPath, isDir);
}

// ---------------------------------------------------------------------------
// Boundary enforcement
// ---------------------------------------------------------------------------

// A single probe path inside the root stands in for every state file: if the
// deepest path we would write is ignored, the whole store is covered.
function coverageProbe(resolved: ResolvedRoot): string {
  return `${resolved.repoRelative}/runs/.probe/manifest.json`;
}

function requireGitignoreCoverage(cwd: string, resolved: ResolvedRoot, context: GitContext): void {
  const probe = coverageProbe(resolved);
  if (context.kind === "worktree") {
    const result = git(["check-ignore", "-q", "--", probe], cwd);
    if (result.status === 0) return;
    if (result.status === 1) {
      throw new StoreError(
        "boundary-gitignore",
        `${resolved.repoRelative} is not covered by any ignore rule — refusing to write execution state that could be committed; run \`execution_store.js init\` or add an ignore entry for ${resolved.repoRelative}/`,
        { repoRelative: resolved.repoRelative },
      );
    }
    throw new StoreError(
      "boundary-git-unavailable",
      `git check-ignore failed (${result.stderr || `exit ${result.status}`}) — execution-state coverage cannot be verified`,
    );
  }
  if (!ignoreDecision(cwd, probe, false)) {
    throw new StoreError(
      "boundary-gitignore",
      `${resolved.repoRelative} is not covered by .gitignore — refusing to write execution state that could become tracked; run \`execution_store.js init\` or add an ignore entry for ${resolved.repoRelative}/`,
      { repoRelative: resolved.repoRelative },
    );
  }
}

function requireNoTrackedState(cwd: string, resolved: ResolvedRoot, context: GitContext): void {
  if (context.kind !== "worktree") return;
  // The `.apm/state/` namespace must be untracked as a whole — a tracked
  // file anywhere under it means the repo committed state it promised to
  // ignore. Custom roots check their own path.
  const trackedRoot = resolved.repoRelative !== null && resolved.repoRelative.startsWith(".apm/state")
    ? ".apm/state"
    : resolved.repoRelative;
  const result = git(["ls-files", "-z", "--", `${trackedRoot}`], cwd);
  if (result.status !== 0) {
    throw new StoreError(
      "boundary-git-unavailable",
      `git ls-files failed (${result.stderr || `exit ${result.status}`}) — tracked execution state cannot be ruled out`,
    );
  }
  if (result.stdout.length > 0) {
    const tracked = result.stdout.split("\0").filter(Boolean).slice(0, 5);
    throw new StoreError(
      "boundary-tracked",
      `${resolved.repoRelative} already contains Git-tracked files (${tracked.join(", ")}${result.stdout.split("\0").filter(Boolean).length > 5 ? ", …" : ""}) — untrack them before writing execution state`,
      { tracked },
    );
  }
}

// The writeManifest pattern from schema_migrate: the nearest existing
// ancestor must realpath inside the checkout BEFORE mkdir, because
// mkdirSync(recursive) through a linked directory would already have
// created state outside the checkout by the time a post-write check ran.
function requireContainedTarget(cwd: string, resolved: ResolvedRoot): void {
  if (resolved.external) {
    if (fs.existsSync(resolved.root) && !fs.statSync(resolved.root).isDirectory()) {
      throw new StoreError(
        "boundary-escape",
        `external state root ${resolved.root} exists and is not a directory`,
      );
    }
    return;
  }
  let probe = resolved.root;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      throw new StoreError(
        "boundary-escape",
        `cannot verify ${resolved.repoRelative} stays inside the checkout`,
      );
    }
    probe = parent;
  }
  if (!isInsideCheckout(cwd, probe)) {
    throw new StoreError(
      "boundary-escape",
      `${resolved.repoRelative} resolves outside the checkout through a linked ancestor — refusing to write execution state`,
      { repoRelative: resolved.repoRelative },
    );
  }
}

// Full write boundary for an inside-checkout or authorized-external root:
// containment, ignore coverage, and no tracked content — every refusal
// happens before a single byte is written.
function ensureStateRootBoundary(cwd: string, resolved: ResolvedRoot): void {
  requireContainedTarget(cwd, resolved);
  if (resolved.external) return;
  const context = gitContext(cwd);
  requireGitignoreCoverage(cwd, resolved, context);
  requireNoTrackedState(cwd, resolved, context);
}

// The explicit safe initialization: add the ignore entry that coverage
// checks require. Idempotent — when coverage already exists this is a no-op
// report, never a duplicate line.
function initStateRoot(cwd: string, options: StoreRootOptions = {}): { initialized: boolean; gitignorePath: string; entry: string; alreadyCovered: boolean } {
  const resolved = resolveStateRoot(cwd, options);
  if (resolved.external) {
    throw new StoreError(
      "invalid-argument",
      "init only applies to a checkout-local state root — an external root has no repository ignore coverage to write",
    );
  }
  requireContainedTarget(cwd, resolved);
  const context = gitContext(cwd);
  try {
    requireGitignoreCoverage(cwd, resolved, context);
    return { initialized: false, gitignorePath: ".gitignore", entry: "", alreadyCovered: true };
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === "boundary-git-unavailable") throw error;
    // boundary-gitignore → the point of init is to fix exactly that.
  }
  // The issue's contract covers `.apm/state/` as the state namespace — the
  // default root writes that umbrella entry (other state components share
  // it); a custom inside-checkout root gets its own precise path.
  const repoRelative = resolved.repoRelative ?? EXECUTION_STATE_ROOT;
  const entry = repoRelative.startsWith(".apm/state")
    ? "/.apm/state/"
    : `/${repoRelative}/`;
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = fs.readFileSync(gitignorePath, "utf8");
  } catch { /* absent .gitignore is created below */ }
  const newline = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const block = `${newline}\n# doc-driven-dev execution state — per-worktree, never committed\n${entry}\n`;
  fs.writeFileSync(gitignorePath, `${existing}${block}`, "utf8");
  // Fail closed: a deeper .gitignore or an unusual source can still negate
  // coverage — report that instead of claiming a safe init.
  try {
    requireGitignoreCoverage(cwd, resolved, context);
  } catch (error: unknown) {
    throw new StoreError(
      "boundary-gitignore",
      `wrote ${entry} to .gitignore but ${resolved.repoRelative} is still not ignored — a deeper .gitignore or another source overrides it`,
      { entry, repoRelative: resolved.repoRelative, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return { initialized: true, gitignorePath: ".gitignore", entry, alreadyCovered: false };
}

// Resolve and verify the run directory for `runId` under an already-checked
// root — the id is validated before it ever becomes a path segment, so a
// path escape through the run name is impossible.
function runDirFor(resolved: ResolvedRoot, runId: string): string {
  if (!isValidId(runId)) {
    throw new StoreError(
      "invalid-argument",
      `invalid run id ${JSON.stringify(runId)} — ids match [A-Za-z0-9][A-Za-z0-9._-]{0,127} and never contain path separators`,
    );
  }
  return path.join(resolved.root, "runs", runId);
}

export {
  ensureStateRootBoundary,
  gitContext,
  ignoreDecision,
  initStateRoot,
  resolveStateRoot,
  runDirFor,
};

export type { ResolvedRoot, StoreRootOptions };
