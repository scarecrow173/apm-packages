import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

/** L3 distribution checks — everything `verify:l3` can prove without a
 *  consumer install: the Devin manifest schema, the generated tree's
 *  layout, that APM (`.apm/`) and Devin (`devin-plugin/`) outputs never
 *  conflate, and the observed behavior of the repo-pinned `apm` binary
 *  (`pack --dry-run`, `compile --validate`). What L3 deliberately cannot
 *  prove — a real consumer install, a real Devin session — is the manual
 *  `l3-consumer` probe and issue `#218`; see
 *  `packages/pstack-devin/docs/verification-matrix.md`. */

export interface Finding {
  /** Path the finding names ("" when not file-bound). */
  file: string;
  issue: string;
}

export interface PackProbe {
  /** match: observed file set == EXPECTED_PACK_MANIFESTS.
   *  drift: the command ran but produced something else — loud failure.
   *  skipped: `apm`/`mise` unavailable — printed, never a silent pass. */
  status: "match" | "drift" | "skipped";
  expected: string[];
  observed: string[];
  note: string;
}

export interface CompileProbe {
  /** expected-na: either documented skill-only result — non-zero exit +
   *  "No instruction files found" (no installed deps), or exit 0 +
   *  "Validated 0 primitives" (an installed `apm_modules/` makes apm
   *  validate the context instead and find zero instruction-shaped
   *  primitives — the same N/A). unexpected: anything else — APM or the
   *  package's primitive set changed, investigate. */
  status: "expected-na" | "unexpected" | "skipped";
  exitCode: number | null;
  note: string;
}

export interface L3Result {
  manifest: Finding[];
  layout: Finding[];
  separation: Finding[];
  pack: PackProbe;
  compile: CompileProbe;
}

const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MANIFEST_REL = ".devin-plugin/plugin.json";

/** Entries the generated `devin-plugin/` tree must carry. `.devin-plugin/`
 *  and `provenance.json` are ours; `AGENTS.md`, `skills/`, `agents/` come
 *  from upstream+overlay; `docs/harness/devin.md` is the adapter of record
 *  every skill depends on. */
const REQUIRED_ENTRIES: ReadonlyArray<{ rel: string; kind: "dir" | "file" }> =
  [
    { rel: ".devin-plugin", kind: "dir" },
    { rel: "AGENTS.md", kind: "file" },
    { rel: "agents", kind: "dir" },
    { rel: "skills", kind: "dir" },
    { rel: "provenance.json", kind: "file" },
    { rel: "docs/harness/devin.md", kind: "file" },
  ];

/** What `apm pack --dry-run` emits for this manifest (a `targets:` block,
 *  no `dependencies:`): the ecosystem manifests for the `.apm` skill,
 *  written under the package root — not the `devin-plugin/` tree, which
 *  `apm pack` does not consume. Recorded 2026-11-17 against apm 0.33.0
 *  (see docs/l3-verification.md). Drift = APM changed what it would
 *  write; verify and re-record deliberately, never blanket-pass. */
export const EXPECTED_PACK_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".github/plugin/plugin.json",
];

/** `apm compile --validate` counts instruction/agent primitives only —
 *  a skill-only package gets this exact "not applicable" result and a
 *  non-zero exit (packages/pstack-devin/AGENTS.md records the same
 *  outcome for the repo's other skills-only packages). */
export const COMPILE_NA_PHRASE = "No instruction files found";

/** The post-install form of the same N/A: once `apm install` has created
 *  `apm_modules/`, apm 0.33.0 treats the directory as a valid APM context
 *  and `apm compile --validate` exits 0 reporting zero primitives of
 *  every instruction-shaped kind — still "not applicable", not a pass of
 *  real instruction content. Requiring the literal "0" counts keeps any
 *  genuinely-present instruction primitive an unexpected finding. */
export const COMPILE_NA_PHRASE_INSTALLED = "Validated 0 primitives";

/** apm hard-wraps long lines mid-token at a fixed width (CRLF, observed
 *  2026-11-17 piping stdout on Windows) — a `Would write` path arrives
 *  split across physical lines. Continuation lines never carry apm's
 *  `[x]` message marker, so newlines followed by a non-marker line are
 *  rejoined (empty separator: the wrap splits mid-token, not at spaces)
 *  before the record regex runs. */
const WRAP_JOIN = /\r?\n(?!\[)/g;
const WOULD_WRITE = /Would write plugin manifest to\s+(.+?\.json)\b/g;
const MISE_TIMEOUT_MS = 180_000;

export interface CmdOut {
  code: number;
  output: string;
}

export type CmdRunner = (argv: string[], cwd: string) => CmdOut;

export class ToolMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolMissingError";
  }
}

/** Repo-managed tools run through `mise exec --` so the mise.toml pins
 *  apply (root AGENTS.md). A spawn ENOENT means mise itself is absent —
 *  surfaced to callers as a skip, never a pass. */
export const runViaMise: CmdRunner = (argv, cwd) => {
  const r = spawnSync("mise", ["exec", "--", ...argv], {
    cwd,
    encoding: "utf8",
    timeout: MISE_TIMEOUT_MS,
  });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ToolMissingError(
        "`mise` not found on PATH — run `mise install` and re-run via `mise exec`",
      );
    }
    throw r.error;
  }
  return {
    code: r.status ?? 1,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
};

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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `.devin-plugin/plugin.json` is the one file whose contents this
 *  package owns outright — pin the full distribution schema, not just
 *  the name/platforms triple safety-scan also guards. */
export function checkManifest(pluginDir: string): Finding[] {
  const out: Finding[] = [];
  const fail = (issue: string): void => {
    out.push({ file: MANIFEST_REL, issue });
  };
  const abs = path.join(pluginDir, MANIFEST_REL);
  if (!fs.existsSync(abs)) {
    fail("missing");
    return out;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    fail(`invalid JSON: ${errMsg(e)}`);
    return out;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    fail("must be a JSON object");
    return out;
  }
  const m = doc as Record<string, unknown>;
  if (m.name !== "pstack") {
    fail(`name must be "pstack", got ${JSON.stringify(m.name)}`);
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    fail(`version must be semver, got ${JSON.stringify(m.version)}`);
  }
  if (typeof m.description !== "string" || m.description.trim() === "") {
    fail("description must be a non-empty string");
  }
  const author = m.author as { name?: unknown } | null | undefined;
  if (
    author === null ||
    typeof author !== "object" ||
    typeof author.name !== "string" ||
    author.name.trim() === ""
  ) {
    fail("author.name must be a non-empty string");
  }
  if (m.license !== "MIT") {
    fail(`license must be "MIT", got ${JSON.stringify(m.license)}`);
  }
  if (
    !Array.isArray(m.keywords) ||
    m.keywords.length === 0 ||
    m.keywords.some((k) => typeof k !== "string")
  ) {
    fail("keywords must be a non-empty string array");
  }
  if (
    !Array.isArray(m.platforms) ||
    m.platforms.length !== 1 ||
    m.platforms[0] !== "local"
  ) {
    fail(`platforms must be ["local"], got ${JSON.stringify(m.platforms)}`);
  }
  return out;
}

/** Required generated-tree entries exist with the right shape — this is
 *  the tree the `devin-plugin/` AGENTS.md and every shipped skill
 *  assumes when it names `docs/harness/devin.md` the adapter of record. */
export function checkLayout(pluginDir: string): Finding[] {
  const out: Finding[] = [];
  for (const { rel, kind } of REQUIRED_ENTRIES) {
    const abs = path.join(pluginDir, rel);
    const ok =
      kind === "dir"
        ? fs.existsSync(abs) && fs.statSync(abs).isDirectory()
        : fs.existsSync(abs) && fs.statSync(abs).isFile();
    if (!ok) {
      out.push({ file: rel, issue: `missing ${kind} in devin-plugin/` });
    }
  }
  return out;
}

/** `.apm/` and `devin-plugin/` are sibling product trees serving
 *  different consumers (AGENTS.md "Artifact boundary"). Conflation —
 *  an `.apm` segment inside the Devin tree, a `devin-plugin`/
 *  `.devin-plugin` segment inside the APM tree — means a build bug
 *  shipped one product inside the other. */
export function checkSeparation(pkgRoot: string): Finding[] {
  const out: Finding[] = [];
  const apmDir = path.join(pkgRoot, ".apm");
  const pluginDir = path.join(pkgRoot, "devin-plugin");
  if (!fs.existsSync(apmDir) || !fs.statSync(apmDir).isDirectory()) {
    out.push({ file: ".apm", issue: "missing — the APM primitive tree" });
    return out;
  }
  if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
    // The layout check names this tree missing; separation has nothing
    // to compare without it.
    return out;
  }
  for (const rel of listFiles(pluginDir)) {
    if (rel.split("/").includes(".apm")) {
      out.push({
        file: `devin-plugin/${rel}`,
        issue:
          ".apm segment inside the Devin plugin tree — APM and Devin outputs conflated",
      });
    }
  }
  for (const rel of listFiles(apmDir)) {
    for (const bad of ["devin-plugin", ".devin-plugin"]) {
      if (rel.split("/").includes(bad)) {
        out.push({
          file: `.apm/${rel}`,
          issue:
            `${bad} segment inside the APM primitive tree — ` +
            "Devin and APM outputs conflated",
        });
      }
    }
  }
  return out;
}

/** null = apm reachable via `mise exec --`; a string = the skip reason. */
function apmUnavailable(run: CmdRunner, cwd: string): string | null {
  let v: CmdOut;
  try {
    v = run(["apm", "--version"], cwd);
  } catch (e) {
    if (e instanceof ToolMissingError) return e.message;
    throw e;
  }
  return v.code === 0
    ? null
    : "`apm` unavailable via `mise exec --` " +
        `(exit ${v.code}) — run \`mise install\`, then re-run`;
}

/** Normalize a `Would write …` path to a pkgRoot-relative forward-slash
 *  path; paths outside the package keep their absolute form so they
 *  surface as drift rather than match by accident. */
function toPkgRel(abs: string, pkgRoot: string): string {
  const norm = abs.trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
  const root = `${path.resolve(pkgRoot).replace(/\\/g, "/")}/`;
  return norm.toLowerCase().startsWith(root.toLowerCase())
    ? norm.slice(root.length)
    : norm;
}

/** `apm pack --dry-run` — observed-behavior check. Asserts the manifest
 *  set APM says it would write; any drift (extra file, missing file,
 *  non-zero exit) fails with the recorded-vs-observed diff. */
export function probePack(
  pkgRoot: string,
  run: CmdRunner = runViaMise,
): PackProbe {
  const expected = [...EXPECTED_PACK_MANIFESTS];
  const missing = apmUnavailable(run, pkgRoot);
  if (missing !== null) {
    return { status: "skipped", expected, observed: [], note: missing };
  }
  let out: CmdOut;
  try {
    out = run(["apm", "pack", "--dry-run"], pkgRoot);
  } catch (e) {
    if (e instanceof ToolMissingError) {
      return { status: "skipped", expected, observed: [], note: e.message };
    }
    throw e;
  }
  if (out.code !== 0) {
    return {
      status: "drift",
      expected,
      observed: [],
      note: `apm pack --dry-run exited ${out.code}:\n${out.output.trim()}`,
    };
  }
  const unwrapped = out.output.replace(WRAP_JOIN, "");
  const observed = [...unwrapped.matchAll(WOULD_WRITE)]
    .map((m) => toPkgRel(m[1], pkgRoot))
    .sort();
  const same =
    observed.length === expected.length &&
    observed.every((p, i) => p === expected[i]);
  return {
    status: same ? "match" : "drift",
    expected,
    observed,
    note: same
      ? "observed manifest set matches the recorded apm 0.33.0 behavior"
      : "observed manifest set differs from the recorded expectation — " +
        "verify deliberately, then update EXPECTED_PACK_MANIFESTS and " +
        "docs/l3-verification.md",
  };
}

/** `apm compile --validate` — recorded N/A for a skill-only package.
 *  Passes on either documented skill-only outcome (non-zero exit plus
 *  the no-files phrase, or exit 0 reporting literally zero primitives —
 *  the post-`apm install` shape); any other exit/message combination
 *  means APM or the package's primitive set changed and the N/A record
 *  is stale. */
export function probeCompile(
  pkgRoot: string,
  run: CmdRunner = runViaMise,
): CompileProbe {
  const missing = apmUnavailable(run, pkgRoot);
  if (missing !== null) {
    return { status: "skipped", exitCode: null, note: missing };
  }
  let out: CmdOut;
  try {
    out = run(["apm", "compile", "--validate"], pkgRoot);
  } catch (e) {
    if (e instanceof ToolMissingError) {
      return { status: "skipped", exitCode: null, note: e.message };
    }
    throw e;
  }
  // Prose wraps at word boundaries — collapse whitespace before the
  // phrase check so a wrapped "No instruction\nfiles found" still matches.
  const flat = out.output.replace(/\s+/g, " ");
  if (out.code !== 0 && flat.includes(COMPILE_NA_PHRASE)) {
    return {
      status: "expected-na",
      exitCode: out.code,
      note: `skill-only package — "${COMPILE_NA_PHRASE}", exit ${out.code}`,
    };
  }
  if (
    out.code === 0 &&
    flat.includes(COMPILE_NA_PHRASE_INSTALLED) &&
    flat.includes("0 instructions")
  ) {
    return {
      status: "expected-na",
      exitCode: out.code,
      note:
        `skill-only package (installed context) — ` +
        `"${COMPILE_NA_PHRASE_INSTALLED}", exit 0`,
    };
  }
  return {
    status: "unexpected",
    exitCode: out.code,
    note:
      out.code === 0
        ? "expected a skill-only N/A result, got exit 0 with:\n" +
          out.output.trim()
        : `expected "${COMPILE_NA_PHRASE}" in output, got:\n` +
          out.output.trim(),
  };
}

/** All deterministic L3 assertions for one package root — the directory
 *  carrying `apm.yml`, `.apm/`, and `devin-plugin/`. */
export function runL3Local(
  pkgRoot: string,
  opts: { run?: CmdRunner } = {},
): L3Result {
  const run = opts.run ?? runViaMise;
  const pluginDir = path.join(pkgRoot, "devin-plugin");
  return {
    manifest: checkManifest(pluginDir),
    layout: checkLayout(pluginDir),
    separation: checkSeparation(pkgRoot),
    pack: probePack(pkgRoot, run),
    compile: probeCompile(pkgRoot, run),
  };
}

export function hasFailures(r: L3Result): boolean {
  return (
    r.manifest.length +
      r.layout.length +
      r.separation.length >
      0 ||
    r.pack.status === "drift" ||
    r.compile.status === "unexpected"
  );
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PKG_REL = "packages/pstack-devin";
const MAX_LISTED = 20;

function report(kind: string, items: Finding[]): void {
  if (items.length === 0) return;
  console.log(`${kind}: ${items.length} findings`);
  for (const f of items.slice(0, MAX_LISTED)) {
    console.log(`  ${f.file}: ${f.issue}`);
  }
  if (items.length > MAX_LISTED) {
    console.log(`  ... and ${items.length - MAX_LISTED} more`);
  }
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--consumer")) {
    // The consumer install probe is manual (spawns apm, can hit the
    // network for the git form) — delegated to l3-consumer and never
    // part of the deterministic verify:l3 run.
    const m = await import("./l3-consumer.js");
    m.runConsumer(argv.filter((a) => a !== "--consumer"));
    return;
  }
  const unknown = argv.find((a) => a.startsWith("--"));
  if (unknown !== undefined) {
    throw new Error(`unknown argument: ${unknown} (usage: --consumer)`);
  }
  const pkgRoot = path.join(repoRoot, PKG_REL);
  const pluginDir = path.join(pkgRoot, "devin-plugin");
  if (!fs.existsSync(pluginDir)) {
    throw new Error(
      `${PKG_REL}/devin-plugin does not exist — run ` +
        "`pnpm --dir scripts/pstack-devin run build`",
    );
  }
  const r = runL3Local(pkgRoot);

  report("manifest", r.manifest);
  report("layout", r.layout);
  report("separation", r.separation);

  if (r.pack.status === "skipped") {
    console.log(`pack: skipped — ${r.pack.note}`);
  } else {
    console.log(`pack: ${r.pack.status} — ${r.pack.note}`);
    if (r.pack.status === "drift" && r.pack.observed.length > 0) {
      console.log(`  expected: ${JSON.stringify(r.pack.expected)}`);
      console.log(`  observed: ${JSON.stringify(r.pack.observed)}`);
    }
  }
  if (r.compile.status === "skipped") {
    console.log(`compile: skipped — ${r.compile.note}`);
  } else {
    console.log(`compile: ${r.compile.status} — ${r.compile.note}`);
  }

  console.log(
    `l3-dist: manifest ${r.manifest.length}, layout ${r.layout.length}, ` +
      `separation ${r.separation.length}, pack ${r.pack.status}, ` +
      `compile ${r.compile.status}`,
  );
  if (hasFailures(r)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
