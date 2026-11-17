import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadBuildConfig } from "../src/config.js";
import { applyUpdate } from "../src/apply-update.js";
import type { Runner } from "../src/apply-update.js";
import { writeFixturePackage, tmpdir, git } from "./helpers.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/**
 * Bounded-exhaustive verification of apply-update rollback atomicity.
 *
 * Property under test (one sentence): for EVERY pipeline step k, if step k
 * fails, then after rollback every pipeline-touched path — tracked file
 * bytes on disk, the index, and untracked leftovers under devin-plugin/ —
 * equals the pre-run state, and HEAD did not move.
 *
 * The model is the real `applyUpdate` state machine run against a fixture
 * git repo, enumerated over the full single-failure space:
 *   model states  = the 8 entries of `steps[]` in src/apply-update.ts
 *   transitions   = { step succeeds, step fails } — the failure injection
 *                   point is placed at every step, in every failure mode
 *                   that step can physically realize:
 *     - "clean":   the step throws before its own side-effects land
 *                  (runner throws immediately; a committed precondition
 *                  makes an internal step throw before its write).
 *     - "dirty":   the step throws after partial side-effects inside
 *                  TOUCHED (runner mutates tracked files, drops untracked
 *                  files, and stages an edit; the commit step's own
 *                  `git add` has already staged TOUCHED when the
 *                  foreign-staged guard throws).
 *   Single-file-edit steps (upstream.yml, apm.yml, observed refresh) write
 *   through one fs.writeFileSync — one indivisible step in the code, so
 *   "dirty" is not separately realizable for them; their precondition
 *   failures are enumerated instead. Failing at step k also means steps
 *   1..k-1 ran for real, so accumulated earlier side-effects are always
 *   part of every k>1 case.
 *
 * Bounds (stated, not implied): at most one step fails per run; steps are
 *   sequential; rollback's own git commands are assumed to work (a
 *   rollback-internal failure surfaces as `rolledBack:false` and is
 *   reported, not enumerated); side-effects OUTSIDE the TOUCHED pathspecs
 *   (e.g. an apm_modules/ install artifact — gitignored and possibly
 *   pre-existing) are out of scope: rollback only owns TOUCHED.
 *
 * If a scenario's post-run snapshot differs from pre-run, the test prints
 * the differing paths — the counterexample in the code's own terms.
 */

/** Repo-root-relative pathspecs the pipeline may change — mirrored from
 *  the `TOUCHED` constant in src/apply-update.ts. If these drift apart the
 *  snapshot no longer covers what rollback owns; the step-name guard test
 *  below and the skill's coverage record are the tripwires. */
const TOUCHED: string[] = [
  "packages/pstack-devin/upstream.yml",
  "packages/pstack-devin/apm.yml",
  "packages/pstack-devin/apm.lock.yaml",
  "packages/pstack-devin/.gitignore",
  "packages/pstack-devin/devin-plugin",
];

/** Fixture repo root with the package committed, a package .gitignore
 *  (TOUCHED includes it), and two tracked devin-plugin files so the
 *  rollback checkout/clean have real state to restore. */
function fixtureWorktree(): { root: string; pkg: string } {
  const root = tmpdir();
  git(root, "init", "-q", ".");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@test");
  // Match the real repo's eol=lf so Windows checkouts restore LF bytes and
  // byte comparisons measure content, not line endings.
  git(root, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
  writeFixturePackage(root, { commit: SHA_A });
  const pkg = path.join(root, "packages", "pstack-devin");
  fs.writeFileSync(path.join(pkg, ".gitignore"), "apm_modules/\nbuild/\n");
  fs.mkdirSync(path.join(pkg, "devin-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "devin-plugin", "provenance.json"),
    JSON.stringify({ executables: [] }) + "\n",
  );
  fs.writeFileSync(
    path.join(pkg, "devin-plugin", "tracked.md"),
    "original content\n",
  );
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return { root, pkg };
}

// --- repo-state snapshot -------------------------------------------------

interface Snapshot {
  /** `git rev-parse HEAD` — catches a commit that should not exist. */
  head: string;
  /** `git ls-files -s` over the whole index — staged leftovers and
   *  preserved foreign staged paths are both visible here. */
  index: string;
  /** `git status --porcelain` over the whole repo — catches worktree
   *  changes, unstaged/untracked leftovers, and verifies nothing outside
   *  TOUCHED was swept up (gitignored files are invisible by design). */
  status: string;
  /** Every path under the TOUCHED pathspecs on disk, mapped to a content
   *  hash ("file <sha256>") or "dir" — catches byte-level drift and empty
   *  directories porcelain would collapse away. */
  disk: Record<string, string>;
}

function walkDisk(
  root: string,
  rel: string,
  out: Record<string, string>,
): void {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    out[rel + "/"] = "dir";
    for (const name of fs.readdirSync(abs).sort()) {
      walkDisk(root, `${rel}/${name}`, out);
    }
    return;
  }
  const bytes = fs.readFileSync(abs);
  out[rel] =
    "file " + crypto.createHash("sha256").update(bytes).digest("hex");
}

function snapshot(root: string): Snapshot {
  const disk: Record<string, string> = {};
  for (const rel of TOUCHED) walkDisk(root, rel, disk);
  return {
    head: git(root, "rev-parse", "HEAD"),
    index: git(root, "ls-files", "-s"),
    status: git(root, "status", "--porcelain"),
    disk,
  };
}

/** Human-readable list of every way `post` differs from `pre` — the
 *  counterexample narrative in repo terms, not a diff of internals. */
function diffSnapshots(pre: Snapshot, post: Snapshot): string[] {
  const diffs: string[] = [];
  if (pre.head !== post.head) {
    diffs.push(
      `HEAD moved: ${pre.head.slice(0, 7)} -> ${post.head.slice(0, 7)} ` +
        "(a commit was created or lost)",
    );
  }
  if (pre.index !== post.index) {
    diffs.push(
      "index differs (staged paths before -> after):\n" +
        `  ${pre.index.split("\n").join("\n  ")}\n` +
        "  ----\n" +
        `  ${post.index.split("\n").join("\n  ")}`,
    );
  }
  if (pre.status !== post.status) {
    diffs.push(
      "git status --porcelain differs (before -> after):\n" +
        `  ${JSON.stringify(pre.status)}\n  ${JSON.stringify(post.status)}`,
    );
  }
  const keys = new Set([...Object.keys(pre.disk), ...Object.keys(post.disk)]);
  for (const k of [...keys].sort()) {
    const a = pre.disk[k];
    const b = post.disk[k];
    if (a === b) continue;
    if (a === undefined) {
      diffs.push(`untracked leftover on disk: ${k}`);
    } else if (b === undefined) {
      diffs.push(`file missing after rollback: ${k}`);
    } else {
      diffs.push(`file content differs after rollback: ${k}`);
    }
  }
  return diffs;
}

// --- failure injection ----------------------------------------------------

/** Simulate a failed step's partial side-effects, all inside TOUCHED:
 *  dirties a tracked generated file, drops untracked files (file + dir),
 *  appends to the tracked pin/lock/ignore files, and stages one edit —
 *  exercising all three rollback operations (reset / checkout / clean). */
function dirtyTree(root: string, pkg: string): void {
  const plugin = path.join(pkg, "devin-plugin");
  fs.writeFileSync(path.join(plugin, "tracked.md"), "DIRTY\n");
  fs.writeFileSync(path.join(plugin, "leftover.md"), "pipeline leftover\n");
  fs.mkdirSync(path.join(plugin, "partial"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "partial", "new.md"), "partial\n");
  fs.appendFileSync(path.join(pkg, "upstream.yml"), "\n# partial write\n");
  fs.appendFileSync(path.join(pkg, "apm.lock.yaml"), "\n# partial write\n");
  fs.appendFileSync(path.join(pkg, ".gitignore"), "# partial write\n");
  git(root, "add", "packages/pstack-devin/upstream.yml");
}

interface Scenario {
  /** Value res.failedStep must report — proves the failure landed at the
   *  intended step (and that every step can actually be reached). */
  step: string;
  /** Human label for the failure mode, used in the test name. */
  mode: string;
  /** Fixture preparation run AFTER cfg load and BEFORE the snapshot —
   *  e.g. commit a malformed file, or stage a path outside TOUCHED. */
  setup?: (root: string, pkg: string) => void;
  /** Runner command-line suffix at which the step first dirties the tree. */
  mutateAt?: string;
  /** Runner command-line suffix at which the step throws. When equal to
   *  `mutateAt` the call dirties first, then throws — a dirty failure. */
  failAt?: string;
}

function commitFile(root: string, rel: string, content: string): void {
  fs.writeFileSync(path.join(root, rel), content);
  git(root, "add", rel);
  git(root, "commit", "-qm", `corrupt ${rel}`);
}

/** The full single-failure space: every `steps[]` entry in
 *  src/apply-update.ts appears, in every failure mode it can realize.
 *  Keep this in 1:1 step coverage with that array — the guard test below
 *  derives the step list from the source and fails on a gap. */
const SCENARIOS: Scenario[] = [
  {
    step: "upstream.yml",
    mode: "missing commit anchor (precondition)",
    setup: (root) =>
      commitFile(
        root,
        "packages/pstack-devin/upstream.yml",
        [
          "upstream:",
          "  repo: cursor/plugins",
          "  host: github.com",
          "  path: harness/pstack/claude-code",
          "observed:",
          '  upstream_version: "0.15.42"',
          "",
        ].join("\n"),
      ),
  },
  {
    step: "apm.yml",
    mode: "missing ref anchor (precondition)",
    // upstream.yml was already rewritten by step 1 — rollback must undo
    // it even though the step-2 edit never wrote a byte.
    setup: (root) =>
      commitFile(
        root,
        "packages/pstack-devin/apm.yml",
        [
          "name: pstack-devin",
          "version: 0.1.0",
          "description: fixture",
          "license: MIT",
          "targets: [codex, copilot, cursor, claude, windsurf, agent-skills]",
          "devDependencies:",
          "  apm:",
          "    - git: https://github.com/cursor/plugins.git",
          "      path: harness/pstack/claude-code",
          "      targets: [copilot]",
          "",
        ].join("\n"),
      ),
  },
  { step: "apm install", mode: "clean", failAt: "exec -- apm install" },
  {
    step: "apm install",
    mode: "dirty",
    mutateAt: "exec -- apm install",
    failAt: "exec -- apm install",
  },
  { step: "build", mode: "clean", failAt: "run build" },
  {
    step: "build",
    mode: "dirty",
    mutateAt: "run build",
    failAt: "run build",
  },
  {
    step: "observed refresh",
    mode: "unparseable provenance.json (precondition)",
    setup: (root) =>
      commitFile(
        root,
        "packages/pstack-devin/devin-plugin/provenance.json",
        "{ not valid json\n",
      ),
  },
  {
    step: "check-generated",
    mode: "clean",
    failAt: "run check-generated",
  },
  {
    step: "check-generated",
    mode: "dirty",
    mutateAt: "run check-generated",
    failAt: "run check-generated",
  },
  { step: "verify", mode: "clean", failAt: "run verify" },
  {
    step: "verify",
    mode: "dirty",
    mutateAt: "run verify",
    failAt: "run verify",
  },
  {
    step: "commit",
    mode: "foreign staged path",
    // A staged path outside TOUCHED slips past the TOUCHED-scoped
    // pre-flight check, so commitAll discovers it only after its own
    // `git add` + stageOutput already ran — the step fails mid-side-effects
    // and rollback must unstage TOUCHED without disturbing the foreign
    // staged path.
    setup: (root) => {
      fs.writeFileSync(path.join(root, "outside-pkg.txt"), "foreign\n");
      git(root, "add", "outside-pkg.txt");
    },
  },
  {
    step: "commit",
    mode: "foreign staged path + leftovers from earlier steps",
    // An earlier step succeeded but left its partial output behind;
    // commit then fails and rollback must undo both.
    mutateAt: "run verify",
    setup: (root) => {
      fs.writeFileSync(path.join(root, "outside-pkg.txt"), "foreign\n");
      git(root, "add", "outside-pkg.txt");
    },
  },
];

function injectedRunner(root: string, pkg: string, sc: Scenario): Runner {
  return (cmd, args, _cwd) => {
    const line = `${cmd} ${args.join(" ")}`;
    if (sc.mutateAt !== undefined && line.endsWith(sc.mutateAt)) {
      dirtyTree(root, pkg);
    }
    if (sc.failAt !== undefined && line.endsWith(sc.failAt)) {
      throw new Error(`simulated failure at ${line}`);
    }
  };
}

test("atomicity sanity: a run with no failure commits and stays clean", () => {
  const { root } = fixtureWorktree();
  const cfg = loadBuildConfig(root);
  const res = applyUpdate(cfg, SHA_B, {
    repoRoot: root,
    runner: () => {},
    log: () => {},
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(
    git(root, "status", "--porcelain", "--", ...TOUCHED),
    "",
    "pipeline-owned paths clean after the commit",
  );
});

test("atomicity coverage: a failure scenario exists for every step in src/apply-update.ts", () => {
  // The step list lives inside applyUpdate; derive it from the source so a
  // newly added pipeline step that has no scenario fails here instead of
  // silently shrinking the verified space.
  const src = fs.readFileSync(
    fileURLToPath(new URL("../src/apply-update.ts", import.meta.url)),
    "utf8",
  );
  const start = src.indexOf("const steps");
  const end = src.indexOf("];", start);
  assert.ok(start > 0 && end > start, "steps array not found in source");
  const declared = [
    ...src.slice(start, end).matchAll(/name: "([^"]+)"/g),
  ].map((m) => m[1]);
  const covered = new Set(SCENARIOS.map((s) => s.step));
  const missing = declared.filter((n) => !covered.has(n));
  assert.deepEqual(
    missing,
    [],
    `pipeline steps with no failure scenario: ${missing.join(", ")}`,
  );
});

for (const sc of SCENARIOS) {
  test(`atomicity[${sc.step} | ${sc.mode}]: failure restores pre-run state`, () => {
    const { root, pkg } = fixtureWorktree();
    // cfg loads from the VALID package first — a corrupt-fixture setup
    // commits its corruption afterwards, exactly like a maintainer whose
    // on-disk files degraded after config was read.
    const cfg = loadBuildConfig(root);
    sc.setup?.(root, pkg);
    const pre = snapshot(root);
    const res = applyUpdate(cfg, SHA_B, {
      repoRoot: root,
      runner: injectedRunner(root, pkg, sc),
      log: () => {},
    });
    const post = snapshot(root);

    assert.equal(res.ok, false, "run should report failure");
    assert.equal(
      res.failedStep,
      sc.step,
      `failure should be reported at step "${sc.step}"`,
    );
    assert.equal(
      res.rolledBack,
      true,
      `rollback itself reported problems: ${res.error}`,
    );
    assert.equal(res.commit, undefined, "no commit may be produced");
    const diffs = diffSnapshots(pre, post);
    assert.deepEqual(
      diffs,
      [],
      `atomicity violation — step "${sc.step}" failed (${sc.mode}) but ` +
        "post-rollback state differs from pre-run state:\n  " +
        diffs.join("\n  "),
    );
  });
}
