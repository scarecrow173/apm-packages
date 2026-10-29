"use strict";

/**
 * Shared scope-entry domain rules for the parallel-safety contract. Both
 * `parallel_safety.ts` (dispatch judgment) and `merge_verification.ts` (merge
 * verification) interpret `## Affected Files` / `declaredScope` entries — the
 * opaque-entry and path-normalization rules live here so the two sides cannot
 * drift (same domain rule, one place).
 */

/** Normalized scope pattern: file = exact match, dir = `/`-boundary prefix. */
export type ScopePattern = { kind: "file" | "dir"; path: string };

/** Parse result: either a verifiable pattern or opaque prose. */
export type ScopeResolution = { pattern: ScopePattern } | { opaque: string };

/**
 * Entries still containing code-span/link/brace/angle markup after cleaning
 * are prose, not verifiable paths — they must fail closed to opaque.
 */
export const MARKUP_CHARS = /[`[\]{}<>]/;

/**
 * Case-folded compare key: repo paths compare case-insensitively (the dev
 * environment is Windows, and a case-only drift must not bypass scope or
 * collision checks). Display strings keep their original case.
 */
export function scopeKey(text: string): string {
  return text.toLowerCase();
}

/**
 * Normalize a declared scope path to forward-slash repo-relative form.
 * Returns null for entries that cannot be verified deterministically:
 * absolute paths, `..` escapes, and embedded glob segments.
 */
export function normalizeScopePath(raw: string): { path: string; isDir: boolean } | null {
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

/**
 * Resolve one cleaned scope entry: markup leftovers and bare words without
 * path separators are opaque prose; anything that fails strict path
 * normalization is opaque too — never silently converted into a pattern.
 */
export function toScopeEntry(text: string): ScopeResolution {
  if (MARKUP_CHARS.test(text)) return { opaque: text };
  // A bare word with no path separators is a module/feature name, not a path.
  if (!text.includes("/") && !text.includes(".") && !text.includes("\\")) {
    return { opaque: text };
  }
  const normalized = normalizeScopePath(text);
  if (!normalized) return { opaque: text };
  return { pattern: { kind: normalized.isDir ? "dir" : "file", path: normalized.path } };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Remove fenced code blocks (``` / ~~~) before heading and entry extraction:
 * a `## Affected Files` heading or bullet inside a fence is documentation,
 * not a declaration, and must never verify as a real section. An unclosed
 * fence drops the remainder of the body — its content is code, not sections.
 */
export function stripFencedBlocks(body: string): string {
  const kept: string[] = [];
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of body.split(/\r?\n/)) {
    if (fenceChar === "") {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        const run = open[1];
        const info = line.slice(line.indexOf(run) + run.length);
        // CommonMark: a backtick fence's info string may not contain a
        // backtick and a tilde fence's may not contain a tilde — those lines
        // are ordinary text, not fence openers.
        if (info.includes(run[0])) {
          kept.push(line);
          continue;
        }
        fenceChar = run[0];
        fenceLen = run.length;
        continue;
      }
      kept.push(line);
      continue;
    }
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
      fenceChar = "";
      fenceLen = 0;
    }
    // Fenced content lines (and the closer) are dropped.
  }
  return kept.join("\n");
}
