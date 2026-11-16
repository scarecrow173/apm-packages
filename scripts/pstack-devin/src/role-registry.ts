import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface RoleRef {
  /** Forward-slash path under the scanned root. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Backticked label a consumer names as a role. */
  role: string;
  /** The phrasing that marked this token a role reference. */
  context: string;
}

export interface RoleCheckResult {
  /** Role labels consumers name that roles.json does not register — a new
   *  upstream role must land in the registry, not pass silently. */
  unknown: RoleRef[];
  /** roles.json keys no consumer file references — stale registry
   *  entries the registry should drop. */
  dead: string[];
  /** Every role reference found, deduped by file:line:role. */
  referenced: RoleRef[];
}

/** Consumer docs are shipped Markdown files (skills, docs, README). */
const CONSUMER_DOC = /\.mdc?$/i;

/** A roles.json key is lowercase words joined by spaces, commas, or
 *  hyphens — "arena cross-judge pool", "feature, refactoring", "bug-fix".
 *  Letters only: a digit marks a model slug (`claude-fable-5-2-high`), a
 *  capital marks a field/flag name (`classDef`, `SomeFlag`), and
 *  `/ . : # * < > …` mark paths, rule names, JSON snippets, and
 *  placeholders — none of which are role labels even inside a
 *  role-reference phrasing. */
const ROLE_SHAPE = /^[a-z]+(?:[ ,-]+[a-z]+)*$/;

/** Phrasings that make a backticked token a role reference — each exists
 *  in the shipped tree today:
 *    "the `arena runners` line", "the `swarm workers` model",
 *    "in place of `arena runners`", "changes read `hardest tasks`",
 *    "Setup also configures `swarm workers`", and role/default table rows
 *    "| Judgment | `reflect tooling` | `claude-opus-5-5-high-fast` | …".
 *  A new phrasing upstream simply fails to extract — the dead-role side
 *  still guards every key, and extending this list is additive. */
const CONTEXTS: ReadonlyArray<{ context: string; re: RegExp }> = [
  { context: "`<role>` line", re: /`([^`]+)` lines?\b/gi },
  { context: "`<role>` model", re: /`([^`]+)` model\b/gi },
  { context: "in place of `<role>`", re: /in place of (?:the )?`([^`]+)`/gi },
  { context: "read `<role>`", re: /\bread `([^`]+)`/gi },
  { context: "configures `<role>`", re: /\bconfigures? `([^`]+)`/gi },
  // A role/default row: the role-shaped cell is followed by a digit-
  // carrying cell — the default model slug. Other single-backtick cells
  // (glossary-style tables) are not role rows.
  {
    context: "role table row",
    re: /\|\s*`([^`]+)`\s*\|\s*`[^`]*\d[^`]*`/g,
  },
];

/** Backticked tokens that satisfy ROLE_SHAPE inside a role-reference
 *  context but are not role labels. Every entry must carry a
 *  justification — an unexplained suppression is a silent pass.
 *  Currently empty: the shipped upstream tree extracts only real roles. */
const IGNORE = new Map<string, string>([
  // ["token", "why it matches a context but is not a role label"],
]);

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

/** Overlay-authored paths (additions + overwrites) per provenance.json, or
 *  null when the scanned root carries no provenance — e.g. a test fixture,
 *  where every file counts as a consumer. Overlay files are our own
 *  authored content: scanning them would let a stale roles.json entry
 *  stay "alive" after upstream drops every reference to it. */
function overlayPaths(root: string): Set<string> | null {
  const provPath = path.join(root, "provenance.json");
  if (!fs.existsSync(provPath)) return null;
  let doc: { overlay?: { additions?: unknown; overwrites?: unknown } };
  try {
    doc = JSON.parse(fs.readFileSync(provPath, "utf8"));
  } catch (e) {
    throw new Error(
      `invalid provenance.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const out = new Set<string>();
  for (const list of [doc.overlay?.additions, doc.overlay?.overwrites]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const p = (e as { path?: unknown }).path;
      if (typeof p === "string") out.add(p);
    }
  }
  return out;
}

/** Consumer .md/.mdc files under root — upstream files only when the root
 *  carries provenance naming overlay paths. */
function consumerFiles(root: string): string[] {
  const files = listFiles(root).filter((rel) => CONSUMER_DOC.test(rel));
  const overlay = overlayPaths(root);
  return overlay === null
    ? files
    : files.filter((rel) => !overlay.has(rel));
}

/** Read and validate roles.json: a `roles` array of entries each carrying
 *  a non-empty, role-shaped, unique `key`. Malformed input fails loudly —
 *  a broken registry must not degrade to an empty allowlist. */
export function loadRoleKeys(rolesJsonPath: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(rolesJsonPath, "utf8"));
  } catch (e) {
    throw new Error(
      `invalid roles.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const roles = (doc as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    throw new Error("roles.json: \"roles\" must be an array");
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of roles.entries()) {
    const key = (entry as { key?: unknown })?.key;
    if (typeof key !== "string" || key === "") {
      throw new Error(
        `roles.json roles[${i}].key must be a non-empty string`,
      );
    }
    if (!ROLE_SHAPE.test(key)) {
      throw new Error(
        `roles.json roles[${i}].key is not a role label: ${JSON.stringify(key)}`,
      );
    }
    if (seen.has(key)) {
      throw new Error(
        `roles.json: duplicate role key ${JSON.stringify(key)}`,
      );
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Check both directions of the registry contract:
 *  - unknown: every role label a consumer doc names (via the CONTEXTS
 *    phrasings and ROLE_SHAPE) must be a roles.json key — a role upstream
 *    adds without registry coverage is a loud failure, not a silent pass.
 *  - dead: every roles.json key must appear as a backticked literal in at
 *    least one consumer file — a key with no consumer reference is a stale
 *    registry entry. Plain-substring presence is not enough: the
 *    backticked form is what a role-line mention takes, and prose like
 *    "(feature, refactoring, bug fix)" must not keep a key alive. */
export function checkRoles(root: string, rolesJsonPath: string): RoleCheckResult {
  const keys = loadRoleKeys(rolesJsonPath);
  const keySet = new Set(keys);
  const files = consumerFiles(root);

  const bodies = new Map<string, string>();
  const refs = new Map<string, RoleRef>();
  for (const rel of files) {
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    bodies.set(rel, body);
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { context, re } of CONTEXTS) {
        re.lastIndex = 0; // shared module regexes — matchAll reads lastIndex
        for (const m of lines[i].matchAll(re)) {
          const role = m[1];
          if (!ROLE_SHAPE.test(role)) continue;
          if (IGNORE.has(role)) continue;
          const id = `${rel}:${i + 1}:${role}`;
          if (!refs.has(id)) {
            refs.set(id, { file: rel, line: i + 1, role, context });
          }
        }
      }
    }
  }

  const referenced = [...refs.values()];
  const unknown = referenced.filter((r) => !keySet.has(r.role));
  const dead = keys.filter((key) => {
    const lit = `\`${key}\``;
    for (const body of bodies.values()) {
      if (body.includes(lit)) return false;
    }
    return true;
  });
  return { unknown, dead, referenced };
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_REL = "packages/pstack-devin/devin-plugin";
const ROLES_REL =
  "packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/roles.json";
const MAX_LISTED = 20;

function main(): void {
  const dir = path.join(repoRoot, PLUGIN_REL);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${PLUGIN_REL} does not exist — run ` +
        "`pnpm --dir scripts/pstack-devin run build`",
    );
  }
  const rolesJson = path.join(repoRoot, ROLES_REL);
  const r = checkRoles(dir, rolesJson);
  const files = consumerFiles(dir);

  if (r.unknown.length > 0) {
    console.log(`unknown: ${r.unknown.length} findings`);
    for (const f of r.unknown.slice(0, MAX_LISTED)) {
      console.log(`  ${f.file}:${f.line}: \`${f.role}\` (${f.context})`);
    }
    if (r.unknown.length > MAX_LISTED) {
      console.log(`  ... and ${r.unknown.length - MAX_LISTED} more`);
    }
    console.log(
      "  add the role to " + ROLES_REL +
        ", or to IGNORE with justification if it is not a role label",
    );
  }
  if (r.dead.length > 0) {
    console.log(`dead: ${r.dead.length} findings`);
    for (const key of r.dead.slice(0, MAX_LISTED)) {
      console.log(`  ${key}`);
    }
    if (r.dead.length > MAX_LISTED) {
      console.log(`  ... and ${r.dead.length - MAX_LISTED} more`);
    }
    console.log(`  no consumer references this key — drop it from ${ROLES_REL}`);
  }

  console.log(
    `role registry: ${files.length} consumer docs scanned, ` +
      `${loadRoleKeys(rolesJson).length} roles, ` +
      `${r.referenced.length} references, ` +
      `${r.unknown.length} unknown, ${r.dead.length} dead`,
  );
  if (r.unknown.length > 0 || r.dead.length > 0) {
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
