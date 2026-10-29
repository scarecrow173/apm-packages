"use strict";

import fs from "node:fs";
import path from "node:path";

// ─── Types ───

export type LoadDirectiveKind =
  | "reference"
  | "script"
  | "sdp-artifact"
  | "skill-invoke"
  | "adapter";

export type LoadDirective = {
  kind: LoadDirectiveKind;
  target: string;
  line: number;
  optional: boolean;
};

export type FlowInventory = {
  flow: string;
  skillBytes: number;
  alwaysOnChars: number;
  directives: LoadDirective[];
  referencedFiles: Array<{ path: string; exists: boolean; bytes: number }>;
  totals: { directives: number; referencedBytes: number; missing: number };
};

export type PackageInventory = {
  flows: FlowInventory[];
  totals: {
    flows: number;
    skillBytes: number;
    alwaysOnChars: number;
    directives: number;
    referencedBytes: number;
    missing: number;
  };
};

// ─── Extraction rules ───
//
// Deterministic, line-based extraction applied to `SKILL.md` only. The English
// file is the authoritative instruction surface; `SKILL.ja.md` mirrors it, so
// scanning both would double-count. Every line is scanned, including front
// matter (the `description` field is stage-0 loaded text and can name
// `.sdp` artifacts). Line numbers are 1-based file lines.
//
// Load directive kinds and their patterns:
//
// - reference: any path token containing `references/<file>.md`, e.g.
//   `references/x.md`, `[x](references/x.md)`, `../<skill>/references/x.md`.
// - script: path tokens containing `scripts/<file>.js` (including
//   `node <path>/scripts/<file>.js`), `node <path>.js` invocations, and bare
//   `sdp <verb>` CLI invocations (`scan|infer|profile|validate|query`), which
//   resolve to this skill's `scripts/sdp.js` entry point.
// - sdp-artifact: `.sdp/<path>` file mentions (runtime outputs, e.g.
//   `.sdp/<flow>-default/<flow>-profile.json`). Bare `.sdp` without a path is
//   not a file mention and is not counted.
// - skill-invoke: a cross-skill invocation mention. A captured name must match
//   `[a-z0-9][a-z0-9_-]*-[a-z0-9_-]*` (every installed skill name contains a
//   hyphen, which excludes prose like "invoke Process-category skills").
//   Rules:
//   a. `invoke[s|d]` / `re-invoke[s|d]` + quoted skill name
//      (`invoke \`skill-discovery-protocol\``), with optional `from`
//      (`invoked from \`doc-driven-dev-graph\``);
//   b. the same invoke verbs + a bare hyphenated name;
//   c. `use[s]`/`using`/`run[s]`/`delegate[s] to` + quoted hyphenated name
//      (`use \`skill-discovery-protocol\``, `delegates to \`briefing-flow\``);
//   d. a quoted hyphenated name immediately before an invoke verb
//      (`\`doc-driven-dev-graph\` invokes this skill`);
//   e. a cross-skill link `../<skill>/SKILL.md` (target = the skill name).
//   Bare backticked skill-name mentions without an invocation verb are NOT
//   counted: e.g. "`task-doc` entries" names a document type, not a skill
//   load.
// - adapter: any path token containing `assets/adapters/<file>.yaml`, e.g.
//   `assets/adapters/x.yaml`, `.apm/skills/<skill>/assets/adapters/x.yaml`,
//   `<skill-root>/<skill>/assets/adapters/x.yaml`.
//
// `optional` is true when the directive's line contains a conditional marker:
// `if needed`, `as needed`, `see also`, `optional`, `optionally`
// (case-insensitive), or the line is a list item (`-`, `*`, `+`, or `N.`)
// whose first word is `if` or `when`.
//
// Target resolution (referencedFiles paths are packageRoot-relative, forward
// slashes):
// - Prefixes `<skill-root>/`, `.apm/skills/`, `.agents/skills/`,
//   `.claude/skills/` and leading `../` segments map onto the package skills
//   root, as does a first path segment that names a sibling skill directory
//   (e.g. `impl-doc/scripts/audit_impl_record.js`).
// - Bare paths resolve under the owning skill directory.
// - `sdp-artifact` targets are recorded verbatim (`.sdp/...`); they are
//   consumer-repo runtime outputs and are never present in the package.
// - `skill-invoke` targets resolve to `<packageRoot>/<skill>/SKILL.md`.
// - `sdp <verb>` script targets resolve to this skill's `scripts/sdp.js`.
//
// `missing` counts unique resolved files that do not exist AND were reached
// via `reference`, `script`, or `adapter` directives — files the package is
// expected to ship. `sdp-artifact` (generated at runtime) and `skill-invoke`
// (the named skill may live outside this package) never count as missing;
// they are still recorded with `exists: false` when absent.
//
// Ordering is deterministic: directives sort by (line, kind, target),
// referencedFiles sort by path, flows sort by name.

const SKILL_NAME_PATTERN = "[a-z0-9][a-z0-9_-]*-[a-z0-9_-]*";
const QUOTED_NAME = "[`'\"](" + SKILL_NAME_PATTERN + ")[`'\"]";

const REFERENCE_RE = /([A-Za-z0-9._<>/-]*references\/[A-Za-z0-9._-]+\.md)/g;
const SCRIPT_NODE_RE = /\bnode\s+[`'"]?([A-Za-z0-9._<>/-]+\.js)\b/g;
const SCRIPT_PATH_RE = /([A-Za-z0-9._<>/-]*scripts\/[A-Za-z0-9._-]+\.js)\b/g;
const SDP_CLI_RE = /\bsdp\s+(scan|infer|profile|validate|query)\b/g;
const SDP_ARTIFACT_RE = /(\.sdp\/[A-Za-z0-9._/-]*[A-Za-z0-9_-])/g;
const ADAPTER_RE = /([A-Za-z0-9._<>/-]*assets\/adapters\/[A-Za-z0-9._-]+\.ya?ml)/g;
const INVOKE_QUOTED_RE = new RegExp(
  "\\b(?:re-)?invoke[sd]?\\s+(?:from\\s+)?" + QUOTED_NAME,
  "g",
);
const INVOKE_BARE_RE = new RegExp(
  "\\b(?:re-)?invoke[sd]?\\s+(?:from\\s+)?(" + SKILL_NAME_PATTERN + ")\\b",
  "g",
);
const VERB_QUOTED_RE = new RegExp(
  "\\b(?:use[sd]?|using|runs?|delegates?\\s+to)\\s+" + QUOTED_NAME,
  "g",
);
const NAME_THEN_INVOKE_RE = new RegExp(
  QUOTED_NAME + "\\s+(?:re-)?invoke[sd]?\\b",
  "g",
);
const SKILL_LINK_RE = /\.\.\/([a-z0-9][a-z0-9_-]*)\/SKILL\.md/g;

const OPTIONAL_MARKERS = [
  /\bif needed\b/i,
  /\bas needed\b/i,
  /\bsee also\b/i,
  /\boptional(?:ly)?\b/i,
];
const OPTIONAL_BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(?:if|when)\b/i;

// Directive kinds whose targets are package-shipped files; missing targets of
// other kinds are recorded but never counted.
const MISSING_COUNTED_KINDS: ReadonlySet<LoadDirectiveKind> = new Set([
  "reference",
  "script",
  "adapter",
]);

function isOptionalLine(line: string): boolean {
  if (OPTIONAL_BULLET_RE.test(line)) return true;
  return OPTIONAL_MARKERS.some((marker) => marker.test(line));
}

function extractLineDirectives(
  line: string,
  lineNo: number,
): Array<{ kind: LoadDirectiveKind; target: string }> {
  const found: Array<{ kind: LoadDirectiveKind; target: string }> = [];
  const push = (kind: LoadDirectiveKind, target: string) => {
    if (!found.some((d) => d.kind === kind && d.target === target)) {
      found.push({ kind, target });
    }
  };
  const collect = (kind: LoadDirectiveKind, re: RegExp, group = 1) => {
    for (const match of line.matchAll(re)) push(kind, match[group]);
  };

  collect("reference", REFERENCE_RE);
  collect("script", SCRIPT_NODE_RE);
  collect("script", SCRIPT_PATH_RE);
  collect("sdp-artifact", SDP_ARTIFACT_RE);
  collect("adapter", ADAPTER_RE);
  for (const match of line.matchAll(SDP_CLI_RE)) {
    push("script", `sdp ${match[1]}`);
  }
  collect("skill-invoke", INVOKE_QUOTED_RE);
  collect("skill-invoke", INVOKE_BARE_RE);
  collect("skill-invoke", VERB_QUOTED_RE);
  collect("skill-invoke", NAME_THEN_INVOKE_RE);
  collect("skill-invoke", SKILL_LINK_RE);
  return found;
}

function listSiblingSkillNames(packageRoot: string): Set<string> {
  const names = new Set<string>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packageRoot, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) names.add(entry.name);
  }
  return names;
}

// Maps a raw extracted path token to a packageRoot-relative path (forward
// slashes). See "Target resolution" above for the prefix rules.
function resolveTargetPath(
  kind: LoadDirectiveKind,
  rawTarget: string,
  skillName: string,
  siblingNames: ReadonlySet<string>,
): string {
  if (kind === "skill-invoke") return `${rawTarget}/SKILL.md`;
  if (kind === "sdp-artifact") return rawTarget;
  if (rawTarget.startsWith("sdp ")) return `${skillName}/scripts/sdp.js`;

  let token = rawTarget.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const prefix of [
    "<skill-root>/",
    ".apm/skills/",
    ".agents/skills/",
    ".claude/skills/",
  ]) {
    if (token.startsWith(prefix)) return token.slice(prefix.length);
  }
  while (token.startsWith("../")) token = token.slice(3);
  const slash = token.indexOf("/");
  const firstSegment = slash === -1 ? token : token.slice(0, slash);
  if (siblingNames.has(firstSegment)) return token;
  return `${skillName}/${token}`;
}

function fileStat(absPath: string): { exists: boolean; bytes: number } {
  try {
    const stat = fs.statSync(absPath);
    return stat.isFile() ? { exists: true, bytes: stat.size } : { exists: false, bytes: 0 };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

function bodyAfterFrontMatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0] !== "---") return content;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") return lines.slice(i + 1).join("\n");
  }
  return content;
}

function inventoryFlow(skillDir: string, packageRoot: string): FlowInventory {
  const skillRoot = path.resolve(skillDir);
  const skillsPackageRoot = path.resolve(packageRoot);
  const flow = path.basename(skillRoot);
  const skillFile = path.join(skillRoot, "SKILL.md");
  const content = fs.readFileSync(skillFile, "utf8");
  const siblingNames = listSiblingSkillNames(skillsPackageRoot);

  const directives: LoadDirective[] = [];
  const resolved = new Map<
    string,
    { exists: boolean; bytes: number; countedIfMissing: boolean }
  >();

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const optional = isOptionalLine(lines[i]);
    for (const { kind, target } of extractLineDirectives(lines[i], lineNo)) {
      const normalizedTarget = target.replace(/\\/g, "/");
      directives.push({ kind, target: normalizedTarget, line: lineNo, optional });
      const rel = resolveTargetPath(kind, normalizedTarget, flow, siblingNames);
      const stat = fileStat(path.join(skillsPackageRoot, rel));
      const countedIfMissing = MISSING_COUNTED_KINDS.has(kind);
      const existing = resolved.get(rel);
      if (!existing) {
        resolved.set(rel, { ...stat, countedIfMissing });
      } else {
        existing.countedIfMissing = existing.countedIfMissing || countedIfMissing;
      }
    }
  }

  directives.sort(
    (a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target),
  );

  const referencedFiles = [...resolved.entries()]
    .map(([rel, entry]) => ({ path: rel, exists: entry.exists, bytes: entry.bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));

  let referencedBytes = 0;
  let missing = 0;
  for (const entry of resolved.values()) {
    if (entry.exists) {
      referencedBytes += entry.bytes;
    } else if (entry.countedIfMissing) {
      missing += 1;
    }
  }

  return {
    flow,
    skillBytes: fileStat(skillFile).bytes,
    alwaysOnChars: bodyAfterFrontMatter(content).length,
    directives,
    referencedFiles,
    totals: { directives: directives.length, referencedBytes, missing },
  };
}

function inventoryAll(packageRoot: string): PackageInventory {
  const skillsPackageRoot = path.resolve(packageRoot);
  const flows = [...listSiblingSkillNames(skillsPackageRoot)]
    .filter((name) => fileStat(path.join(skillsPackageRoot, name, "SKILL.md")).exists)
    .map((name) => inventoryFlow(path.join(skillsPackageRoot, name), skillsPackageRoot))
    .sort((a, b) => a.flow.localeCompare(b.flow));

  const totals = {
    flows: flows.length,
    skillBytes: flows.reduce((sum, f) => sum + f.skillBytes, 0),
    alwaysOnChars: flows.reduce((sum, f) => sum + f.alwaysOnChars, 0),
    directives: flows.reduce((sum, f) => sum + f.totals.directives, 0),
    referencedBytes: flows.reduce((sum, f) => sum + f.totals.referencedBytes, 0),
    missing: flows.reduce((sum, f) => sum + f.totals.missing, 0),
  };
  return { flows, totals };
}

export { inventoryFlow, inventoryAll };
