import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** What a reference names. The first five are resolvable forms — they assert
 *  a target that either exists or is reported `broken`. The rest are
 *  classified non-tree refs — audited, counted, never silently passed. */
export type RefKind =
  | "mdlink"      // ](relative/path) — file-relative link
  | "path"        // backticked path anchored in a tree namespace
  | "skill"       // /<name>, /pstack:<name>, the **name** skill, **n** principle
  | "agent"       // pstack:<name>
  | "url"         // http(s)://, mailto:, bare host/path — external
  | "runtime"     // consumer-machine paths: ~, %ENV%, /abs, .dotdirs, unanchored
  | "placeholder" // <meta> vars, globs *, literal metanames like `/name`
  | "builtin"     // /loop, /create-skill… — harness built-in commands
  | "external"    // /deslop… — skills/commands shipped by other plugins
  | "upstream"    // paths into the upstream repo (harness/, cursor/plugins)
  | "gitref";     // origin/HEAD — git refs, not paths

export interface RefFinding {
  file: string;
  line: number;
  ref: string;
  kind: RefKind;
}

export interface LinkResult {
  /** Refs verified against a real on-disk target. */
  checked: number;
  /** Resolvable-form refs whose target is missing. */
  broken: RefFinding[];
  /** Refs whose kind is unknown — reported so nothing passes silently. */
  unresolved: RefFinding[];
  /** Classified non-tree refs, kept for auditability. */
  skipped: RefFinding[];
}

const SCAN_EXT = new Set([".md", ".mdc"]);

/** Names that, written as `/<name>` or "the **name** skill", refer outside
 *  the shipped tree. Every row is a documented classification in the
 *  corpus — `poteto-help`'s "Not in pstack" list, the adapter tables, the
 *  guide text. A slash command or marked mention matching none of these
 *  and no shipped skill is a finding, never a silent pass. */
const OUTSIDE_NAMES = new Map<string, RefKind>([
  // Harness built-in commands — "Cursor built-ins" per poteto-help.
  ["loop", "builtin"],
  ["create-skill", "builtin"],
  ["autopilot", "builtin"],
  ["plugin", "builtin"],
  ["add-plugin", "builtin"],
  ["in-cloud", "builtin"],
  // Other plugins' commands — deslop/control-cli/control-ui ship in
  // cursor-team-kit and reach APM consumers as claude_skill deps outside
  // this tree; /orchestrate is another plugin's skill per poteto-help.
  ["deslop", "external"],
  ["control-cli", "external"],
  ["control-ui", "external"],
  ["visualize", "external"],
  ["orchestrate", "external"],
  // Literal metavariables — adapter tables' `/name`, "the **name** skill".
  ["name", "placeholder"],
  ["skill", "placeholder"],
  ["agent", "placeholder"],
]);

/** First segments naming the upstream repo or a git remote rather than a
 *  path inside this tree. */
const UPSTREAM_SEGMENTS = new Set(["harness", "cursor"]);
const GITREF_SEGMENTS = new Set(["origin", "upstream", "HEAD"]);

const BACKTICK_SPAN = /`([^`\n]+)`/g;
const MDLINK = /\]\((?:<([^>]*)>|([^\s)]+))/g;
const PSTACK_SKILL = /(?<![\w./:+-])\/pstack:([\w*<][\w-]*)/g;
const PSTACK_AGENT = /(?<![\w./:+-])pstack:([\w*<][\w-]*)/g;
const SKILL_MENTION = /(?:\*\*|`)([a-z][a-z0-9*-]*?)(?:\*\*|`)\s+skills?\b/gi;
const PRINCIPLE_MENTION = /(?:\*\*|`)([a-z][a-z0-9-]+)(?:\*\*|`)\s+principles?\b/gi;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const PATH_SHAPED = /^[\w.-]+(\/[\w.-]*)+$/;
const SLASH_COMMAND = /^\/[a-z][a-z0-9-]*$/;
const NAMESPACED_SLASH = /^\/([A-Za-z][\w-]*):([\w-]+)$/;
const BARE_PREFIX = /^\/[\w-]+:$/;
const HOST_PATH = /^[\w-]+(\.[\w-]+)+\//;

type Verdict =
  | { t: "none" }
  | { t: "ok" }
  | { t: "skip" | "broken" | "unresolved"; kind: RefKind; ref: string };

const NONE: Verdict = { t: "none" };
const OK: Verdict = { t: "ok" };
const skip = (kind: RefKind, ref: string): Verdict => ({ t: "skip", kind, ref });
const broken = (kind: RefKind, ref: string): Verdict => ({ t: "broken", kind, ref });
const unresolved = (kind: RefKind, ref: string): Verdict => ({ t: "unresolved", kind, ref });

interface Ctx {
  root: string;
  skillsDir: string;
  pkgDir: string;
  repoDir: string;
  fileDir: string;
  /** `skills/<s>` abs dir when the scanned file lives inside a skill. */
  skillDir: string | null;
  /** Path-namespace first segments: every real dir at the root plus every
   *  real subdir of any skill (playbooks/, references/, scripts/). */
  anchors: Set<string>;
}

function dirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** `](target)` — a markdown link is file-relative by spec. Anchors are
 *  stripped; a pure `#frag` resolves to the file itself. Absolute targets
 *  are ambiguous (site root? repo root?) and must fail loudly. */
function classifyLink(raw: string, ctx: Ctx): Verdict {
  const t = raw.trim();
  if (t === "") return NONE;
  if (/[<*>]/.test(t)) return skip("placeholder", t);
  const sc = SCHEME.exec(t);
  if (sc !== null) {
    const s = sc[1].toLowerCase();
    if (s === "http" || s === "https" || s === "mailto") {
      return skip("url", t);
    }
    return unresolved("mdlink", t);
  }
  if (t.startsWith("~")) return skip("runtime", t);
  if (t.startsWith("/")) return unresolved("mdlink", t);
  const p = t.split("#", 1)[0];
  if (p === "") return OK;
  return fs.existsSync(path.join(ctx.fileDir, p)) ? OK : broken("mdlink", t);
}

/** A `the **name** skill` / "the `name` skill" mention — a skill reference
 *  asserted by prose markup. Registry names skip with their documented
 *  kind; otherwise `skills/<name>/SKILL.md` must exist. */
function classifySkillMention(name: string, ctx: Ctx): Verdict {
  if (/[*<]/.test(name)) return skip("placeholder", name);
  const outside = OUTSIDE_NAMES.get(name);
  if (outside !== undefined) return skip(outside, name);
  return fs.existsSync(path.join(ctx.skillsDir, name, "SKILL.md"))
    ? OK
    : broken("skill", name);
}

/** A `**name** principle` mention — the principle skills carry the
 *  `principle-` prefix on disk but are cited without it. */
function classifyPrincipleMention(name: string, ctx: Ctx): Verdict {
  return fs.existsSync(
    path.join(ctx.skillsDir, `principle-${name}`, "SKILL.md"),
  )
    ? OK
    : broken("skill", `principle-${name}`);
}

/** First whitespace token of a backtick span. Span content is code by
 *  convention in this corpus: the token may be a command (`/name`, a
 *  `/plugin:skill`, `pstack:<agent>`), a path, or a non-ref literal. */
function classifyToken(raw: string, ctx: Ctx): Verdict {
  const tok = raw
    .trim()
    .replace(/^["'([]+/, "")
    .replace(/["')\],;.]+$/, "");
  if (tok === "") return NONE;
  // `<meta>` and `*` can never be literal paths — templates and globs.
  if (/[<*>]/.test(tok)) return skip("placeholder", tok);
  // `VAR=value` is an assignment, not a path.
  if (tok.includes("=")) return NONE;

  if (tok.startsWith("/")) {
    const ns = NAMESPACED_SLASH.exec(tok);
    if (ns !== null) {
      // /<plugin>:<skill> — the pstack namespace resolves inside the tree.
      if (ns[1] === "pstack") return slashSkill(ns[2], tok, ctx);
      return skip("external", tok);
    }
    if (BARE_PREFIX.test(tok)) return skip("placeholder", tok);
    if (SLASH_COMMAND.test(tok)) {
      const name = tok.slice(1);
      const outside = OUTSIDE_NAMES.get(name);
      if (outside !== undefined) return skip(outside, tok);
      return fs.existsSync(path.join(ctx.root, "skills", name, "SKILL.md"))
        ? OK
        : unresolved("skill", tok);
    }
    return skip("runtime", tok); // /abs/path — consumer-machine location
  }

  if (tok.startsWith("pstack:")) {
    const name = tok.slice("pstack:".length);
    if (name === "") return skip("placeholder", tok);
    return fs.existsSync(path.join(ctx.root, "agents", `${name}.md`))
      ? OK
      : broken("agent", tok);
  }

  const sc = SCHEME.exec(tok);
  if (sc !== null) {
    if (/^[A-Za-z]:[\\/]/.test(tok)) return skip("runtime", tok); // C:\
    const s = sc[1].toLowerCase();
    if (s === "http" || s === "https" || s === "mailto") {
      return skip("url", tok);
    }
    // `key:` and `key:value` literals (`environment:`, `profile:`,
    // `file:line`, `wip:N`) are field notation, not refs. An unknown
    // scheme only claims a resource when it carries a path-like rest.
    if (tok.slice(sc[0].length).includes("/")) return unresolved("path", tok);
    return NONE;
  }
  if (/^[~%]/.test(tok)) return skip("runtime", tok);
  // Leading-dot dirs (.cursor/, .devin/, .audit/, .devin-plugin/…) name
  // consumer project or install state, not doc cross-references.
  if (/^\.[^./]/.test(tok)) return skip("runtime", tok);
  if (tok.startsWith("./") || tok.startsWith("../")) {
    return fs.existsSync(path.join(ctx.fileDir, tok))
      ? OK
      : broken("path", tok);
  }
  if (HOST_PATH.test(tok)) return skip("url", tok); // host.tld/path
  const seg0 = tok.split("/", 1)[0];
  if (UPSTREAM_SEGMENTS.has(seg0)) return skip("upstream", tok);
  if (GITREF_SEGMENTS.has(seg0)) return skip("gitref", tok);
  if (seg0 === "pstack") {
    // `pstack/` spells the plugin root itself (<pstack> in the adapters).
    return fs.existsSync(path.join(ctx.root, tok.slice("pstack/".length)))
      ? OK
      : broken("path", tok);
  }
  if (PATH_SHAPED.test(tok)) {
    // Only tree-anchored paths are checked: a token whose first segment is
    // a real tree namespace (skills/, docs/, playbooks/…) claims an in-tree
    // target. Everything else describes the consumer's environment —
    // agent-transcripts/, features/, plugin caches — runtime state.
    if (!ctx.anchors.has(seg0)) return skip("runtime", tok);
    for (const base of resolveBases(ctx)) {
      if (fs.existsSync(path.join(base, tok))) return OK;
    }
    return broken("path", tok);
  }
  return NONE;
}

function slashSkill(name: string, ref: string, ctx: Ctx): Verdict {
  return fs.existsSync(path.join(ctx.root, "skills", name, "SKILL.md"))
    ? OK
    : broken("skill", ref);
}

/** Resolution bases for an anchored relative path, nearest first: the
 *  scanned file's dir, its skill dir when inside a skill (a playbook's
 *  `playbooks/x` means the skill's playbooks dir), the plugin root, then
 *  the source package and repo — docs legitimately point at
 *  `docs/devin-adapter-decisions.md` and `scripts/pstack-devin`. */
function resolveBases(ctx: Ctx): string[] {
  const out = [ctx.fileDir];
  if (ctx.skillDir !== null) out.push(ctx.skillDir);
  out.push(ctx.root, ctx.pkgDir, ctx.repoDir);
  return [...new Set(out)];
}

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

function stripSpans(line: string): string {
  return line.replace(BACKTICK_SPAN, "");
}

/** Resolve every reference inside shipped `.md`/`.mdc` files under `root`
 *  (the devin-plugin tree). See the RefKind taxonomy above — every
 *  suppression is a justified ref kind, and anything unclassifiable lands
 *  in `unresolved` rather than passing silently. */
export function checkLinks(root: string): LinkResult {
  const skillsDir = path.join(root, "skills");
  const anchors = new Set(dirNames(root));
  for (const s of dirNames(skillsDir)) {
    for (const d of dirNames(path.join(skillsDir, s))) anchors.add(d);
  }
  const pkgDir = path.dirname(root);
  const repoDir = path.resolve(root, "../../..");
  const files = listFiles(root).filter((rel) =>
    SCAN_EXT.has(path.extname(rel).toLowerCase()),
  );

  const result: LinkResult = {
    checked: 0,
    broken: [],
    unresolved: [],
    skipped: [],
  };
  const seen = new Set<string>();
  const emit = (
    v: Verdict,
    rel: string,
    line: number,
    ref: string,
  ): void => {
    if (v.t === "none") return;
    // Dedup by verdict kind too: the same token can legitimately be both a
    // resolved backticked path and a broken mdlink on one line (`x/y` may
    // resolve root-relative yet fail file-relative).
    const key = `${rel}:${line}:${v.t}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (v.t === "ok") {
      result.checked++;
      return;
    }
    const f = { file: rel, line, ref: v.ref, kind: v.kind };
    if (v.t === "skip") result.skipped.push(f);
    else if (v.t === "broken") result.broken.push(f);
    else result.unresolved.push(f);
  };

  for (const rel of files) {
    const abs = path.join(root, rel);
    const body = fs.readFileSync(abs, "utf8");
    const sm = /^skills\/([^/]+)/.exec(rel);
    const ctx: Ctx = {
      root,
      skillsDir,
      pkgDir,
      repoDir,
      fileDir: path.dirname(abs),
      skillDir: sm === null ? null : path.join(skillsDir, sm[1]),
      anchors,
    };
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      // Shared module regexes — matchAll's clone inherits lastIndex.
      for (const re of [
        PSTACK_SKILL,
        PSTACK_AGENT,
        SKILL_MENTION,
        PRINCIPLE_MENTION,
        BACKTICK_SPAN,
        MDLINK,
      ]) {
        re.lastIndex = 0;
      }
      for (const m of line.matchAll(PSTACK_SKILL)) {
        emit(
          /[<*>]/.test(m[1])
            ? skip("placeholder", m[0])
            : slashSkill(m[1], m[0], ctx),
          rel,
          ln,
          m[0],
        );
      }
      for (const m of line.matchAll(PSTACK_AGENT)) {
        const v = /[<*>]/.test(m[1])
          ? skip("placeholder", m[0])
          : fs.existsSync(path.join(root, "agents", `${m[1]}.md`))
            ? OK
            : broken("agent", m[0]);
        emit(v, rel, ln, m[0]);
      }
      for (const m of line.matchAll(SKILL_MENTION)) {
        emit(classifySkillMention(m[1], ctx), rel, ln, m[1]);
      }
      for (const m of line.matchAll(PRINCIPLE_MENTION)) {
        emit(classifyPrincipleMention(m[1], ctx), rel, ln, m[1]);
      }
      for (const m of line.matchAll(BACKTICK_SPAN)) {
        const tok = m[1].trim().split(/\s+/, 1)[0];
        emit(classifyToken(tok, ctx), rel, ln, tok);
      }
      const masked = stripSpans(line);
      for (const m of masked.matchAll(MDLINK)) {
        const target = m[1] ?? m[2] ?? "";
        emit(classifyLink(target, ctx), rel, ln, target);
      }
    }
  }
  return result;
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_REL = "packages/pstack-devin/devin-plugin";
const MAX_LISTED = 20;

function main(): void {
  const dir = path.join(repoRoot, PLUGIN_REL);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${PLUGIN_REL} does not exist — run ` +
        "`pnpm --dir scripts/pstack-devin run build`",
    );
  }
  const r = checkLinks(dir);
  const skipCounts = new Map<string, number>();
  for (const s of r.skipped) {
    skipCounts.set(s.kind, (skipCounts.get(s.kind) ?? 0) + 1);
  }
  const skipText = [...skipCounts.entries()]
    .sort()
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ");

  for (const f of r.broken.slice(0, MAX_LISTED)) {
    console.log(`  broken ${f.file}:${f.line}: [${f.kind}] ${f.ref}`);
  }
  if (r.broken.length > MAX_LISTED) {
    console.log(`  ... and ${r.broken.length - MAX_LISTED} more broken`);
  }
  if (r.broken.length > 0) {
    console.log(
      "  fix the reference, restore the missing target, or — for a " +
        "documented outside name — add an OUTSIDE_NAMES row",
    );
  }
  for (const f of r.unresolved.slice(0, MAX_LISTED)) {
    console.log(`  unresolved ${f.file}:${f.line}: [${f.kind}] ${f.ref}`);
  }
  if (r.unresolved.length > MAX_LISTED) {
    console.log(`  ... and ${r.unresolved.length - MAX_LISTED} more unresolved`);
  }
  if (r.unresolved.length > 0) {
    console.log(
      "  classify each: a real shipped target, or a justified skip kind " +
        "— never a blanket pass",
    );
  }
  const files = listFiles(dir).filter((rel) =>
    SCAN_EXT.has(path.extname(rel).toLowerCase()),
  );
  console.log(
    `link-check: ${files.length} files scanned, ${r.checked} refs resolved, ` +
      `${r.skipped.length} skipped (${skipText}), ` +
      `${r.broken.length} broken, ${r.unresolved.length} unresolved`,
  );
  if (r.broken.length > 0 || r.unresolved.length > 0) {
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
