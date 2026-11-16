/** Per-(file, label) suppressions for `safety-scan.ts`. This list STARTS
 *  EMPTY: a real-tree secret hit must either be fixed by removing the
 *  upstream token (and documenting the divergence) or, when the match is
 *  verifiably not a credential — e.g. a documented example shape — be
 *  suppressed here with a justification that says why it is safe. The
 *  justification is the contract: an entry with an empty one is ignored,
 *  so a bare suppression can never silently silence the scan.
 *
 *  An entry suppresses findings at exactly `path` carrying exactly `label`
 *  — a second label firing in the same file is still reported. */
export interface AllowlistEntry {
  /** Tree-relative path with forward slashes (e.g. "docs/guide/setup.md"). */
  path: string;
  /** `SECRET_PATTERNS` label to suppress for that file. */
  label: string;
  /** Why this match is not a real secret. Empty or whitespace = ignored. */
  justification: string;
}

export const ALLOWLIST: AllowlistEntry[] = [];
