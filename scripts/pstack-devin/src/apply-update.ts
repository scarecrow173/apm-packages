import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "js-yaml";
import type { BuildConfig } from "./config.js";
import { loadBuildConfig } from "./config.js";
import { workTreeRoot } from "./gittools.js";
import { stageOutput } from "./build.js";

const COMMIT_RE = /^[0-9a-f]{40}$/;

/** Repo-root-relative pathspecs the pipeline may change: the two pin
 *  files, the regenerated lockfile, the generated tree, and the package
 *  .gitignore (`apm install` may append `apm_modules/` to it — expected).
 *  The pre-flight cleanliness check, the rollback, and the commit staging
 *  all use exactly this set so nothing outside it is touched or swept up. */
const TOUCHED: string[] = [
  "packages/pstack-devin/upstream.yml",
  "packages/pstack-devin/apm.yml",
  "packages/pstack-devin/apm.lock.yaml",
  "packages/pstack-devin/.gitignore",
  "packages/pstack-devin/devin-plugin",
];

const PKG_PREFIX = "packages/pstack-devin/";

export type Runner = (cmd: string, args: string[], cwd: string) => void;

export interface ApplyResult {
  ok: boolean;
  /** New HEAD sha when the pin-update commit was created. */
  commit?: string;
  /** Name of the pipeline step that failed (see `steps` order below). */
  failedStep?: string;
  error?: string;
  /** Rollback ran without its own errors; worktree+index are clean for
   *  every TOUCHED path again. False means "inspect the worktree". */
  rolledBack: boolean;
}

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Production step runner: inherit stdio so the 5-9 minute build/verify
 *  progress is visible in the terminal/CI log. `shell` on win32 because
 *  mise's npm-backend `pnpm` is a .cmd shim execFile cannot spawn;
 *  args are fixed literals, never user input. */
const spawnRunner: Runner = (cmd, args, cwd) => {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.error !== undefined) throw res.error;
  if (res.status !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` exited with code ${res.status}`);
  }
};

function gitAt(top: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", top, ...args], {
      encoding: "utf8",
    }).trim();
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr;
    const detail =
      typeof stderr === "string" && stderr.trim() !== ""
        ? `: ${stderr.trim()}`
        : `: ${errMsg(e)}`;
    throw new Error(`git ${args.join(" ")} failed${detail}`);
  }
}

/** Replace the `commit:` value inside the top-level `upstream:` block,
 *  preserving every other byte (comments, the `observed:` audit block).
 *  Throws naming the missing anchor when the shape is not the expected
 *  `upstream:` → `commit:` one. */
export function setUpstreamCommit(yaml: string, sha: string): string {
  const lines = yaml.split("\n");
  const upIdx = lines.findIndex((l) => /^upstream:\s*$/.test(l));
  if (upIdx < 0) {
    throw new Error("upstream.yml: missing \"upstream:\" mapping");
  }
  for (let i = upIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    // A non-indented, non-comment line containing ':' starts the next
    // top-level key (e.g. `observed:`) — the upstream block ended.
    if (/^[^\s#][^\n]*:/.test(l)) break;
    const m = /^(\s+)commit:(\s*)(\S+)(.*)$/.exec(l);
    if (m === null) continue;
    lines[i] = `${m[1]}commit:${m[2]}${sha}${m[4]}`;
    return lines.join("\n");
  }
  throw new Error("upstream.yml: no \"commit:\" line under \"upstream:\"");
}

/** Replace the `ref:` value of the first `devDependencies.apm` list item,
 *  preserving every other byte. The scan ends at the first key whose
 *  indent is at or above `apm:`'s so a sibling section's `ref:` is never
 *  rewritten. Throws naming the missing anchor on unexpected shape. */
export function setDevDepRef(yaml: string, sha: string): string {
  const lines = yaml.split("\n");
  const depIdx = lines.findIndex((l) => /^devDependencies:\s*$/.test(l));
  if (depIdx < 0) {
    throw new Error("apm.yml: missing \"devDependencies:\" mapping");
  }
  let apmIndent = -1;
  for (let i = depIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
    const indent = l.length - l.trimStart().length;
    if (indent === 0) break; // left devDependencies:
    if (apmIndent < 0) {
      const m = /^(\s*)apm:\s*$/.exec(l);
      if (m !== null) apmIndent = m[1].length;
      continue;
    }
    if (indent <= apmIndent) break; // left the apm: block
    const m = /^(\s*(?:-\s+)?)ref:(\s*)(\S+)(.*)$/.exec(l);
    if (m === null) continue;
    lines[i] = `${m[1]}ref:${m[2]}${sha}${m[4]}`;
    return lines.join("\n");
  }
  if (apmIndent < 0) {
    throw new Error("apm.yml: no \"apm:\" key under \"devDependencies:\"");
  }
  throw new Error("apm.yml: no \"ref:\" line under \"devDependencies.apm\"");
}

/** Rewrite values under the top-level `observed:` block of upstream.yml,
 *  preserving every other byte (comments, key order, unrelated keys).
 *  Only keys listed in `fields` are rewritten; a `fields` key with no
 *  matching line is reported via `warn` — keys are never invented, so a
 *  deliberately trimmed block stays trimmed. An absent `observed:` block
 *  also just warns: these are informational audit fields, not the pin
 *  authority. */
export function setObservedFields(
  yaml: string,
  fields: Record<string, string>,
  warn: (s: string) => void,
): string {
  const lines = yaml.split("\n");
  const obsIdx = lines.findIndex((l) => /^observed:\s*$/.test(l));
  if (obsIdx < 0) {
    warn("upstream.yml: no \"observed:\" block — audit fields not refreshed");
    return yaml;
  }
  const seen = new Set<string>();
  for (let i = obsIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^[^\s#][^\n]*:/.test(l)) break; // next top-level key
    const m = /^(\s+)([A-Za-z_]+):(\s*)\S+(.*)$/.exec(l);
    if (m === null || !(m[2] in fields)) continue;
    seen.add(m[2]);
    lines[i] = `${m[1]}${m[2]}:${m[3]}${fields[m[2]]}${m[4]}`;
  }
  for (const k of Object.keys(fields)) {
    if (!seen.has(k)) {
      warn(`upstream.yml: observed.${k} line not found — left unset`);
    }
  }
  return lines.join("\n");
}

/** Undo every pipeline change under TOUCHED: unstage, restore tracked
 *  files to HEAD, and `git clean` the generated tree (the only place a
 *  partial build can leave untracked files — the pre-flight guaranteed
 *  nothing untracked lived there before, so clean removes only pipeline
 *  leftovers). Returns the rollback's own errors, [] when fully clean. */
function rollback(top: string): string[] {
  const problems: string[] = [];
  const tryGit = (args: string[]): void => {
    try {
      gitAt(top, args);
    } catch (e) {
      problems.push(errMsg(e));
    }
  };
  tryGit(["reset", "-q", "HEAD", "--", ...TOUCHED]);
  const tracked = TOUCHED.filter((p) => {
    try {
      return gitAt(top, ["ls-files", "--", p]) !== "";
    } catch (e) {
      problems.push(errMsg(e));
      return false;
    }
  });
  if (tracked.length > 0) {
    tryGit(["checkout", "--", ...tracked]);
  }
  tryGit(["clean", "-fdq", "--", "packages/pstack-devin/devin-plugin"]);
  return problems;
}

/** Stage TOUCHED (re-asserting devin-plugin exec bits via stageOutput so
 *  a fileMode=true `git add` cannot clobber the index modes the build
 *  set), refuse foreign staged paths, then create the single pin-update
 *  commit. Returns the new commit sha. */
function commitAll(top: string, candidateSha: string): string {
  // `git add` rejects a pathspec matching neither worktree nor index
  // (e.g. a package .gitignore that does not exist); keep entries that
  // exist on disk or are tracked (tracked-but-deleted must stage).
  const addable = TOUCHED.filter(
    (p) =>
      fs.existsSync(path.join(top, p)) ||
      gitAt(top, ["ls-files", "--", p]) !== "",
  );
  if (addable.length > 0) {
    gitAt(top, ["add", "-A", "--", ...addable]);
  }
  const provPath = path.join(
    top,
    "packages/pstack-devin/devin-plugin/provenance.json",
  );
  const prov = JSON.parse(fs.readFileSync(provPath, "utf8")) as {
    executables?: unknown;
  };
  const executables = Array.isArray(prov.executables)
    ? (prov.executables as string[])
    : [];
  // `git add -A` above staged worktree bytes; on fileMode=true hosts that
  // resets exec bits to 644, so re-run the build's stage+chmod pass last.
  stageOutput(top, executables);

  const staged = gitAt(top, ["diff", "--cached", "--name-only"]);
  const foreign = staged
    .split("\n")
    .filter((p) => p !== "" && !p.startsWith(PKG_PREFIX));
  if (foreign.length > 0) {
    throw new Error(
      "unrelated staged changes outside " + PKG_PREFIX +
        " — refusing to fold them into the pin-update commit:\n  " +
        foreign.join("\n  "),
    );
  }
  const short = candidateSha.slice(0, 7);
  gitAt(top, [
    "commit",
    "-m",
    `chore(pstack-devin): update upstream pin to ${short}`,
  ]);
  return gitAt(top, ["rev-parse", "HEAD"]);
}

/** Atomic upstream-pin adoption: (a) upstream.yml commit, (b) apm.yml
 *  devDep ref, (c) `mise exec -- apm install` (lockfile regenerated, never
 *  hand-edited), (d) `pnpm run build`, (e) refresh the `observed:` audit
 *  block from the new lockfile/provenance, (f) `check-generated`,
 *  (g) full `verify` — then ONE commit carrying refs + lockfile +
 *  generated tree + provenance. Any step failure restores every TOUCHED
 *  path to HEAD and reports the failing step: all-or-nothing, never
 *  half-committed. */
export function applyUpdate(
  cfg: BuildConfig,
  candidateSha: string,
  opts: { repoRoot: string; runner?: Runner; log?: (s: string) => void },
): ApplyResult {
  if (!COMMIT_RE.test(candidateSha)) {
    throw new Error(`candidate sha is not a 40-hex commit: ${candidateSha}`);
  }
  if (candidateSha === cfg.upstream.commit) {
    throw new Error(
      `candidate ${candidateSha} equals the current pin — nothing to apply`,
    );
  }
  const top = workTreeRoot(opts.repoRoot);
  if (top === null) {
    throw new Error(
      "apply-update requires the repo root to be a git work tree root " +
        "(rollback and the atomic commit need git)",
    );
  }
  const dirty = gitAt(top, ["status", "--porcelain", "--", ...TOUCHED]);
  if (dirty !== "") {
    throw new Error(
      "uncommitted changes in pipeline-owned paths — commit or stash " +
        "them before apply-update (rollback restores HEAD and would " +
        "discard them):\n" + dirty,
    );
  }

  const runner = opts.runner ?? spawnRunner;
  const log = opts.log ?? ((s: string) => console.log(s));
  const scriptsDir = path.join(opts.repoRoot, "scripts", "pstack-devin");
  const pkg = cfg.packageDir;

  // Every check-generated invocation inside this run is pre-commit: the
  // regenerated tree legitimately differs from HEAD until the single
  // commit at the end, so the index-vs-HEAD clean gate cannot apply yet
  // (the rebuild compare and exec-bit gate still do). The env var reaches
  // both the standalone step and the `check-generated` nested inside
  // `pnpm run verify`'s `verify:l1`, which no CLI flag can pass through.
  process.env.PSTACK_DEVIN_CHECK_PRECOMMIT = "1";

  const editFile = (rel: string, edit: (yaml: string) => string): void => {
    const p = path.join(pkg, rel);
    fs.writeFileSync(p, edit(fs.readFileSync(p, "utf8")));
  };

  /** Refresh the informational `observed:` audit block in upstream.yml
   *  after `apm install` + build produced the new lockfile and generated
   *  tree — the pipeline is the only pin mover, so it is also the only
   *  place these fields can be re-observed. Values come from the same
   *  artifacts the commit carries: `upstream_version`/`file_count` from
   *  `devin-plugin/provenance.json`, `apm_content_hash`/`package_type`
   *  from the regenerated lockfile. Missing sources or keys warn and are
   *  left untouched — observed fields are audit metadata, never the
   *  pin authority (build.ts warns on drift rather than failing). */
  const refreshObserved = (): void => {
    const provPath = path.join(
      pkg,
      "devin-plugin",
      "provenance.json",
    );
    const prov = JSON.parse(fs.readFileSync(provPath, "utf8")) as {
      upstream?: { version?: unknown; file_count?: unknown };
    };
    const lock = load(
      fs.readFileSync(path.join(pkg, "apm.lock.yaml"), "utf8"),
    ) as {
      dependencies?: {
        resolved_commit?: unknown;
        content_hash?: unknown;
        package_type?: unknown;
      }[];
    } | null;
    const deps = lock?.dependencies ?? [];
    const dep =
      deps.find((d) => d.resolved_commit === candidateSha) ?? deps[0];
    const fields: Record<string, string> = {};
    const v = prov.upstream?.version;
    if (typeof v === "string" && v !== "") {
      fields.upstream_version = JSON.stringify(v);
    }
    const fc = prov.upstream?.file_count;
    if (typeof fc === "number") {
      fields.upstream_file_count = String(fc);
    }
    if (typeof dep?.content_hash === "string" && dep.content_hash !== "") {
      fields.apm_content_hash = dep.content_hash;
    }
    if (typeof dep?.package_type === "string" && dep.package_type !== "") {
      fields.apm_package_type = dep.package_type;
    }
    if (Object.keys(fields).length === 0) {
      log("  observed: no fields could be re-observed — block left as-is");
      return;
    }
    editFile("upstream.yml", (y) => setObservedFields(y, fields, log));
  };

  const steps: { name: string; run: () => void }[] = [
    {
      name: "upstream.yml",
      run: () => editFile("upstream.yml", (y) => setUpstreamCommit(y, candidateSha)),
    },
    {
      name: "apm.yml",
      run: () => editFile("apm.yml", (y) => setDevDepRef(y, candidateSha)),
    },
    {
      name: "apm install",
      run: () => runner("mise", ["exec", "--", "apm", "install"], pkg),
    },
    {
      name: "build",
      run: () => runner("pnpm", ["run", "build"], scriptsDir),
    },
    {
      name: "observed refresh",
      run: refreshObserved,
    },
    {
      name: "check-generated",
      run: () => runner("pnpm", ["run", "check-generated"], scriptsDir),
    },
    {
      name: "verify",
      run: () => runner("pnpm", ["run", "verify"], scriptsDir),
    },
    {
      name: "commit",
      run: () => {
        result.commit = commitAll(top, candidateSha);
      },
    },
  ];

  const result: ApplyResult = { ok: false, rolledBack: false };
  for (const s of steps) {
    log(`[apply-update] step: ${s.name}`);
    try {
      s.run();
    } catch (e) {
      result.failedStep = s.name;
      result.error = errMsg(e);
      const problems = rollback(top);
      result.rolledBack = problems.length === 0;
      if (problems.length > 0) {
        result.error += "\nrollback problems:\n  " + problems.join("\n  ");
      }
      return result;
    }
  }
  result.ok = true;

  const leftover = gitAt(top, ["status", "--porcelain", "--", ...TOUCHED]);
  if (leftover !== "") {
    result.ok = false;
    result.failedStep = "commit";
    result.error =
      `commit ${result.commit} was created but pipeline-owned paths ` +
      "are still dirty — inspect before retrying:\n" + leftover;
  }
  return result;
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function main(argv: string[]): void {
  const candidateSha = argv[2];
  if (candidateSha === undefined || !COMMIT_RE.test(candidateSha)) {
    throw new Error("usage: tsx src/apply-update.ts <candidateSha>");
  }
  const res = applyUpdate(loadBuildConfig(repoRoot), candidateSha, {
    repoRoot,
    log: (s) => console.log(s),
  });
  if (!res.ok) {
    console.error(
      `apply-update FAILED at step "${res.failedStep}": ${res.error}`,
    );
    console.error(
      res.rolledBack
        ? "rollback complete — pipeline-owned files restored to HEAD"
        : "rollback incomplete — inspect the worktree before retrying",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`apply-update committed ${res.commit}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
