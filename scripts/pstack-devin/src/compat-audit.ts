import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VOCABULARY } from "./compat-vocabulary.js";
import type { TokenClass, VocabEntry } from "./compat-vocabulary.js";

export { VOCABULARY } from "./compat-vocabulary.js";
export type { TokenClass, VocabEntry } from "./compat-vocabulary.js";

export interface AuditFinding {
  file: string;
  line: number;
  match: string;
  cls: TokenClass;
  label: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  unknowns: AuditFinding[];
}

/** Only text that can carry harness-API references is scanned — this also
 *  skips binary assets (images, fonts) and skill script sources whose
 *  identifiers are not API references. Exported so diff-aware callers can
 *  filter *before* materializing blobs (no point downloading a PNG). */
export const TEXT_EXT = new Set([".md", ".sh", ".mdc", ".json"]);

/** API-shaped tokens with no prose meaning in this tree (capitalized tool
 *  names) plus backticked CamelCase identifiers that may be novel harness
 *  tools. A match is suppressed when some vocabulary row already
 *  classifies that token. */
const TOOL_TOKEN = new RegExp(
  [
    /\b(Grep|Glob|WebFetch|WebSearch|NotebookEdit|TodoRead|LS|Bash)\b/.source,
    // `Write`/`Edit` count only when backticked — bare uses collide with
    // imperative prose ("Write the failing test"), unavoidable noise.
    /`(Write|Edit)`/.source,
    // Backticked CamelCase catches novel tool names (`MultiEdit`,
    // `TaskCreate`, `WebFetch`) — the audit's core purpose.
    /`([A-Z][a-z]+[A-Z][a-zA-Z]*)`/.source,
  ].join("|"),
  "g",
);
// Case-insensitive: `SUBAGENT_TYPE: <value>` must be audited like lowercase —
// the vocabulary row already matches the field name case-insensitively, so
// an uppercase unknown value would otherwise pass silently as "supported".
const SUBAGENT_TYPE = /subagent_type:\s*["']?([\w-]+)/gi;
const KNOWN_SUBAGENT_TYPES = new Set([
  "generalpurpose",   // Cursor value
  "poteto-agent",
  "comment-sicko",
  "general-purpose",  // claude-code.md adapter values
  "explore",
]);
const AGENT_PROFILE = /^agents\/[^/]+\.md$/;
const FRONTMATTER_KEY = /^([\w-]+):/;
const KNOWN_FRONTMATTER_KEYS = new Set([
  "name", "description", "model", "allowed-tools", "tools",
  "max-nesting", "is_background",
]);

const CLS_ORDER: TokenClass[] = [
  "supported", "alternative", "skip", "error",
  "unavailable-external", "devin-only",
];
const MAX_LISTED = 8;

/** Line index of the closing `---` of a leading frontmatter block, or -1. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0] !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i;
  }
  return -1;
}

/** True when the token text is already classified by some vocabulary row. */
function classified(token: string): boolean {
  return VOCABULARY.some((v) => v.pattern.test(token));
}

/** Scan each materialized upstream file line-by-line: every line is matched
 *  against `VOCABULARY` (collecting `findings`), then API-shaped text with
 *  no vocabulary row is collected as `unknowns`: capitalized tool names
 *  (backtick-only for `Write`/`Edit`), backticked CamelCase tokens that may
 *  be novel tool names, `subagent_type:` values outside the known set, and
 *  frontmatter keys in `agents/*.md` outside the Devin profile schema. */
export function auditTree(root: string, upstreamFiles: string[]): AuditResult {
  const findings: AuditFinding[] = [];
  const unknowns: AuditFinding[] = [];
  const unknown = (file: string, line: number, match: string): void => {
    unknowns.push({ file, line, match, cls: "error", label: "unknown" });
  };
  for (const rel of upstreamFiles) {
    if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    const lines = body.split("\n");
    const fmEnd = AGENT_PROFILE.test(rel) ? frontmatterEnd(lines) : -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const entry of VOCABULARY) {
        const m = entry.pattern.exec(line);
        if (m !== null) {
          findings.push({
            file: rel, line: i + 1, match: m[0],
            cls: entry.cls, label: entry.label,
          });
        }
      }
      for (const m of line.matchAll(TOOL_TOKEN)) {
        const token = m[1] ?? m[2] ?? m[3];
        if (!classified(token)) unknown(rel, i + 1, token);
      }
      for (const m of line.matchAll(SUBAGENT_TYPE)) {
        if (!KNOWN_SUBAGENT_TYPES.has(m[1].toLowerCase())) {
          unknown(rel, i + 1, m[1]);
        }
      }
      if (fmEnd > 0 && i > 0 && i < fmEnd) {
        const key = FRONTMATTER_KEY.exec(line);
        if (key !== null && !KNOWN_FRONTMATTER_KEYS.has(key[1])) {
          unknown(rel, i + 1, key[1]);
        }
      }
    }
  }
  return { findings, unknowns };
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_REL = "packages/pstack-devin/devin-plugin";
/** Generated-only files at the tree root — not upstream content. */
const GENERATED_ONLY = new Set(["AGENTS.md", "provenance.json"]);

/** Recursive rel-path list (forward slashes, sorted). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const dirents = fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const de of dirents) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(path.join(abs, de.name), r);
      } else if (de.isFile()) {
        out.push(r);
      }
    }
  };
  walk(dir, "");
  return out;
}

function main(): void {
  const dir = path.join(repoRoot, PLUGIN_REL);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${PLUGIN_REL} does not exist — run ` +
        "`pnpm --dir scripts/pstack-devin run build`",
    );
  }
  const files = listFiles(dir).filter(
    (rel) => !rel.startsWith(".devin-plugin/") && !GENERATED_ONLY.has(rel),
  );
  const { findings, unknowns } = auditTree(dir, files);

  const notes = new Map<string, { cls: TokenClass; note: string }>();
  for (const v of VOCABULARY) notes.set(v.label, v);
  for (const cls of CLS_ORDER) {
    const group = findings.filter((f) => f.cls === cls);
    if (group.length === 0) continue;
    console.log(`${cls}: ${group.length} findings`);
    const byLabel = new Map<string, AuditFinding[]>();
    for (const f of group) {
      const arr = byLabel.get(f.label) ?? [];
      arr.push(f);
      byLabel.set(f.label, arr);
    }
    for (const [label, list] of [...byLabel.entries()].sort()) {
      console.log(`  ${label} (${list.length}) — ${notes.get(label)?.note}`);
      for (const f of list.slice(0, MAX_LISTED)) {
        console.log(`    ${f.file}:${f.line}: ${f.match}`);
      }
      if (list.length > MAX_LISTED) {
        console.log(`    ... and ${list.length - MAX_LISTED} more`);
      }
    }
  }

  console.log(
    `compat audit: ${files.length} files scanned, ` +
      `${findings.length} findings, ${unknowns.length} unknowns`,
  );
  if (unknowns.length > 0) {
    console.log("unknowns — add vocabulary rows for real upstream usages:");
    for (const u of unknowns) {
      console.log(`  ${u.file}:${u.line}: ${u.match}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
