"use strict";

import fs from "node:fs";
import path from "node:path";

/**
 * Canonical doc-bearing directories — the single authority for the doc-suite
 * layout, shared by the artifact scan, graph-state bootstrap reasons, the
 * caller-runner workspace "." fingerprint, the L2 canonical-doc check, and
 * the scaffold/index targets (Issues #141, #156). A custom `--task-dir`
 * extends, never replaces, this set.
 */
const CANONICAL_DOC_DIRS = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
] as const;

type CanonicalDocDir = typeof CANONICAL_DOC_DIRS[number];

/**
 * `relations:` keys whose values are metadata rather than document
 * references: `changes` carries a change set and `test-spec-skip` carries a
 * human reason string for skipping test-spec evidence. The ingestion
 * boundaries (`extractRelations` in the repository model, `relationValues`
 * in the artifact graph) exempt these keys from artifact-target resolution
 * so no consumer ever treats their values as links (Issue #165).
 */
const nonReferenceRelationKeys: ReadonlySet<string> = new Set([
  "changes",
  "test-spec-skip",
]);

function normalizeDir(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/g, "");
}

/**
 * Strip the Windows extended-length prefix (`\\?\`, or `\\?\UNC\` → `\\`).
 * `fs.realpathSync` emits it and verbatim absolute inputs may carry it; it is
 * plumbing, not path identity.
 */
function stripExtendedLengthPrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

/**
 * Containment compare key — fold a path to what identifies it for
 * inside-checks. `path.win32.resolve` folds the drive letter but keeps
 * interior case, so an absolute path spelled with different case is still
 * the same directory and must not falsely fail containment; POSIX stays
 * case-sensitive.
 */
function containmentKey(value: string): string {
  const normalized = stripExtendedLengthPrefix(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Identity key for repo-relative paths — the same case fold as
 * `containmentKey`, so a `DOCS/TASKS` spelling cannot mint a second logical
 * path on a case-insensitive filesystem.
 */
function repoPathKey(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Lexical containment with platform identity (case fold, extended-length
 * strip). This is the lexical half of the checkout rule — legitimate on its
 * own only where a caller already holds real paths or where realpath
 * enforcement happens at a separate boundary (a not-yet-created write
 * target, for example). Anything that reads content must use
 * `isInsideCheckout`/`isInsideRealpath` instead.
 */
function isInside(cwd: string, candidate: string): boolean {
  const root = containmentKey(cwd);
  const resolved = containmentKey(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/**
 * Real-path containment: a symlinked path inside the checkout can resolve
 * outside it, and readdirSync/readFileSync follow the link. Both sides are
 * realpathed so casing stays consistent; any failure fails closed.
 */
function isInsideRealpath(cwd: string, candidate: string): boolean {
  try {
    return isInside(fs.realpathSync(cwd), fs.realpathSync(candidate));
  } catch {
    return false;
  }
}

/**
 * Whether `candidate` stays inside the checkout — lexically and, when the
 * path exists, by real path so a symlinked entry cannot smuggle outside
 * content through a passing prefix check. A nonexistent path cannot yield
 * content, so the realpath branch only runs on existing paths (the same
 * tolerance the scan applies to absent directories).
 */
function isInsideCheckout(cwd: string, candidate: string): boolean {
  const resolved = path.resolve(cwd, candidate);
  if (!isInside(cwd, resolved)) return false;
  return !fs.existsSync(resolved) || isInsideRealpath(cwd, resolved);
}

// The root dir itself normalizes to "" — the same spelling
// `resolveContainedTaskDir` produced for a root taskDir, which
// `isCanonicalDocPath` treats as "every contained doc path".
function toRepoRelative(cwd: string, absolute: string): string {
  return path.relative(path.resolve(cwd), absolute).split(path.sep).join("/");
}

/**
 * Resolve a user-supplied directory selector (`--dir`, `--from`,
 * `--task-dir`) to its normalized checkout-relative form and enforce the one
 * containment rule: the directory must stay inside the checkout. An
 * absolute-outside or `..`-escaping value is a caller error — the boundary
 * fails closed by throwing before any file is read or written. Lexical
 * containment alone is not enough — an existing target that resolves
 * outside through a symlink is rejected the same way.
 *
 * An existing directory resolves to its real path, so a case-variant or
 * linked alias of a canonical directory normalizes to the on-disk identity —
 * the same files can never be scanned under two spellings (phantom
 * duplicate IDs on a case-insensitive filesystem, Issue #156).
 */
function resolveContainedDir(cwd: string, dir: string, flag = "--dir"): string {
  const resolved = path.resolve(cwd, dir);
  if (!isInside(cwd, resolved)) {
    throw new Error(`${flag} escapes the checkout: ${dir}`);
  }
  if (fs.existsSync(resolved)) {
    if (!isInsideRealpath(cwd, resolved)) {
      throw new Error(`${flag} escapes the checkout through a link: ${dir}`);
    }
    return toRepoRelative(
      stripExtendedLengthPrefix(fs.realpathSync(cwd)),
      stripExtendedLengthPrefix(fs.realpathSync(resolved)),
    );
  }
  return toRepoRelative(cwd, stripExtendedLengthPrefix(resolved));
}

/**
 * Identity key for one scan root: the real directory when it exists, else
 * the lexical form. Two selectors naming the same physical directory share
 * one key, so a scan set dedupes aliases instead of reading twice.
 */
function scanRootKey(cwd: string, directory: string): string {
  const absolute = path.resolve(cwd, directory);
  try {
    return containmentKey(stripExtendedLengthPrefix(fs.realpathSync(absolute)));
  } catch {
    return containmentKey(absolute);
  }
}

function isIndexFileName(file: string): boolean {
  return /^(readme|index)(\.[a-z0-9_-]+)?\.md$/i.test(file);
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !isIndexFileName(file))
    .sort();
}

function slugify(title: string, fallback: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function findDocumentDir(cwd: string, explicitDir: string | undefined, candidateDirs: readonly string[], defaultDir: string): string {
  // An explicit --dir is a directory selector like --task-dir: it must stay
  // inside the checkout. Rejecting here keeps every --dir CLI — read-only
  // scanners and writers alike — from scanning or writing outside the repo.
  if (explicitDir) return resolveContainedDir(cwd, explicitDir);
  const existing = candidateDirs.filter((candidate) => fs.existsSync(path.join(cwd, candidate)));
  return existing.length === 0 ? defaultDir : existing[0];
}

export {
  CANONICAL_DOC_DIRS,
  findDocumentDir,
  isIndexFileName,
  isInside,
  isInsideCheckout,
  isInsideRealpath,
  listMarkdownFiles,
  nonReferenceRelationKeys,
  normalizeDir,
  repoPathKey,
  resolveContainedDir,
  scanRootKey,
  slugify,
};

export type { CanonicalDocDir };
