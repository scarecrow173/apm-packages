import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBuildConfig } from "../src/config.js";
import {
  applyUpdate,
  setDepRefs,
  setDevDepRef,
  setObservedFields,
  setUpstreamCommit,
} from "../src/apply-update.js";
import type { Runner } from "../src/apply-update.js";
import { writeFixturePackage, tmpdir, git } from "./helpers.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

// --- setUpstreamCommit --------------------------------------------------

test("setUpstreamCommit rewrites only the commit line, comments intact", () => {
  const yaml = [
    "# header comment",
    "upstream:",
    "  repo: cursor/plugins",
    "  host: github.com",
    "  path: harness/pstack/claude-code",
    `  commit: ${SHA_A}`,
    "# observed comment",
    "observed:",
    '  upstream_version: "0.15.42"',
    "",
  ].join("\n");
  const out = setUpstreamCommit(yaml, SHA_B);
  assert.match(out, new RegExp(`^  commit: ${SHA_B}$`, "m"));
  assert.ok(!out.includes(SHA_A));
  assert.ok(out.includes("# header comment"));
  assert.ok(out.includes("# observed comment"));
  assert.ok(out.includes('upstream_version: "0.15.42"'));
  assert.ok(out.includes("  repo: cursor/plugins"));
});

test("setUpstreamCommit throws when upstream.commit is missing", () => {
  assert.throws(
    () => setUpstreamCommit("upstream:\n  repo: x\n", SHA_B),
    /commit/,
  );
  assert.throws(() => setUpstreamCommit("foo: bar\n", SHA_B), /upstream/);
});

// --- setDevDepRef --------------------------------------------------------

test("setDevDepRef rewrites only the apm devDep ref", () => {
  const yaml = [
    "name: pstack-devin",
    "version: 0.1.0",
    "devDependencies:",
    "  apm:",
    "    - git: https://github.com/cursor/plugins.git",
    "      path: harness/pstack/claude-code",
    `      ref: ${SHA_A}`,
    "      targets: [copilot]",
    "",
  ].join("\n");
  const out = setDevDepRef(yaml, SHA_B);
  assert.match(out, new RegExp(`^      ref: ${SHA_B}$`, "m"));
  assert.ok(!out.includes(SHA_A));
  assert.ok(out.includes("git: https://github.com/cursor/plugins.git"));
  assert.ok(out.includes("targets: [copilot]"));
});

test("setDevDepRef stops at the end of the apm block", () => {
  const ref2 = "c".repeat(40);
  const yaml = [
    "devDependencies:",
    "  apm:",
    "    - git: https://example/repo.git",
    `      ref: ${SHA_A}`,
    "  npm:",
    `    ref: ${ref2}`,
    "",
  ].join("\n");
  const out = setDevDepRef(yaml, SHA_B);
  assert.match(out, new RegExp(`^      ref: ${SHA_B}$`, "m"));
  assert.ok(out.includes(`ref: ${ref2}`), "sibling section ref untouched");
});

test("setDevDepRef throws when the apm devDep has no ref", () => {
  assert.throws(
    () => setDevDepRef("devDependencies:\n  apm:\n    - git: x\n", SHA_B),
    /ref/,
  );
  assert.throws(() => setDevDepRef("name: x\n", SHA_B), /devDependencies/);
});

// --- setDepRefs ----------------------------------------------------------

test("setDepRefs rewrites every shorthand #ref under dependencies.apm", () => {
  const yaml = [
    "dependencies:",
    "  apm:",
    "    # a comment stays",
    `    - cursor/plugins/cursor-team-kit/skills/deslop#${SHA_A}`,
    `    - cursor/plugins/cursor-team-kit/skills/control-ui#${SHA_A}`,
    "devDependencies:",
    "  apm:",
    `    - git: x`,
    `      ref: ${SHA_A}`,
    "",
  ].join("\n");
  const out = setDepRefs(yaml, SHA_B);
  assert.equal(out.match(new RegExp(`#${SHA_B}`, "g"))?.length, 2);
  assert.ok(out.includes(`ref: ${SHA_A}`), "devDep ref untouched");
  assert.ok(out.includes("# a comment stays"));
});

test("setDepRefs is a no-op without dependencies or hex refs", () => {
  const yaml = [
    "devDependencies:",
    "  apm:",
    `    - git: x`,
    `      ref: ${SHA_A}`,
  ].join("\n");
  assert.equal(setDepRefs(yaml, SHA_B), yaml);
  const branchRef = [
    "dependencies:",
    "  apm:",
    "    - owner/repo/skills/x#main",
  ].join("\n");
  assert.equal(
    setDepRefs(branchRef, SHA_B),
    branchRef,
    "non-hex refs are left for config.ts to reject loudly",
  );
});

// --- setObservedFields ---------------------------------------------------

test("setObservedFields rewrites listed values, comments and order intact", () => {
  const yaml = [
    "upstream:",
    "  commit: " + SHA_B,
    "# audit comment",
    "observed:",
    '  upstream_version: "0.15.42"',
    "  apm_package_type: agent_plugin",
    "  apm_content_hash: sha256:old",
    "  upstream_file_count: 546",
    "",
  ].join("\n");
  const out = setObservedFields(
    yaml,
    {
      upstream_version: '"0.15.43"',
      apm_content_hash: "sha256:new",
      upstream_file_count: "537",
    },
    () => {},
  );
  assert.ok(out.includes('  upstream_version: "0.15.43"'));
  assert.ok(out.includes("  apm_content_hash: sha256:new"));
  assert.ok(out.includes("  upstream_file_count: 537"));
  assert.ok(out.includes("  apm_package_type: agent_plugin"), "untouched");
  assert.ok(out.includes("# audit comment"), "comment preserved");
});

test("setObservedFields warns on a missing key and on a missing block", () => {
  const warns: string[] = [];
  const warn = (s: string): void => {
    warns.push(s);
  };
  // Block present, one field key absent → only that key warns.
  const out = setObservedFields(
    "observed:\n  upstream_version: \"1\"\n",
    { upstream_version: '"2"', upstream_file_count: "3" },
    warn,
  );
  assert.ok(out.includes('  upstream_version: "2"'));
  assert.deepEqual(warns, [
    "upstream.yml: observed.upstream_file_count line not found — left unset",
  ]);
  // No observed block at all → one warning, yaml untouched.
  warns.length = 0;
  const yaml2 = "upstream:\n  repo: x\n";
  assert.equal(setObservedFields(yaml2, { a: "1" }, warn), yaml2);
  assert.match(warns[0] ?? "", /no "observed:" block/);
});

// --- applyUpdate (fixture git repo) --------------------------------------

/** Fixture repo root with the package committed (plus one tracked
 *  devin-plugin file + provenance), so workTreeRoot and the rollback
 *  checkout have a real HEAD to work against. */
function fixtureWorktree(): { root: string; pkg: string } {
  const root = tmpdir();
  git(root, "init", "-q", ".");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@test");
  // The real repo forces eol=lf via .gitattributes; without it a Windows
  // checkout (autocrlf) would restore CRLF bytes and the byte-compare
  // assertions below would fail on line endings, not content.
  git(root, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
  writeFixturePackage(root, { commit: SHA_A });
  const pkg = path.join(root, "packages", "pstack-devin");
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

/** Recording runner — every step is a no-op by default; `failAt` names the
 *  step's command line (`run check-generated`, `exec -- apm install`, …) at
 *  which the runner throws, and `onBuild` simulates partial build output. */
function recordingRunner(
  calls: string[],
  opts: { failAt?: string; onBuild?: (pkg: string) => void } = {},
  pkg = "",
): Runner {
  return (cmd, args, _cwd) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (opts.onBuild !== undefined && line === "pnpm run build") {
      opts.onBuild(pkg);
    }
    if (opts.failAt !== undefined && line.endsWith(opts.failAt)) {
      throw new Error(`simulated failure at ${line}`);
    }
  };
}

test("apply-update: happy path commits pin+lockfile+tree in one commit", () => {
  const { root } = fixtureWorktree();
  const cfg = loadBuildConfig(root);
  const calls: string[] = [];
  const res = applyUpdate(cfg, SHA_B, {
    repoRoot: root,
    runner: recordingRunner(calls),
    log: () => {},
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.failedStep, undefined);
  const commit = git(root, "rev-parse", "HEAD");
  assert.equal(res.commit, commit);
  assert.match(
    git(root, "log", "-1", "--format=%s"),
    new RegExp(
      `^chore\\(pstack-devin\\): update upstream pin to ${SHA_B.slice(0, 7)}`,
    ),
  );
  // The commit contains the ref edits and nothing outside the package.
  const names = git(root, "diff", "--name-only", "HEAD~1", "HEAD")
    .split("\n")
    .sort();
  assert.deepEqual(names, [
    "packages/pstack-devin/apm.yml",
    "packages/pstack-devin/upstream.yml",
  ]);
  // Every step ran in order.
  assert.deepEqual(
    calls.map((c) => c.replace(/^(mise|pnpm) /, "")),
    [
      "exec -- apm install",
      "run build",
      "run check-generated",
      "run verify",
    ],
  );
  // Post-commit: pipeline-owned paths are clean.
  assert.equal(
    git(root, "status", "--porcelain", "--", "packages/pstack-devin"),
    "",
  );
});

test("apply-update: build failure restores every touched file", () => {
  const { root, pkg } = fixtureWorktree();
  const cfg = loadBuildConfig(root);
  const beforeUp = fs.readFileSync(path.join(pkg, "upstream.yml"), "utf8");
  const beforeApm = fs.readFileSync(path.join(pkg, "apm.yml"), "utf8");
  const calls: string[] = [];
  const res = applyUpdate(cfg, SHA_B, {
    repoRoot: root,
    runner: recordingRunner(calls, {
      failAt: "check-generated",
      onBuild: (p) => {
        // Simulated partial build: modifies a tracked file and adds a new
        // untracked one inside the generated tree.
        fs.writeFileSync(
          path.join(p, "devin-plugin", "tracked.md"),
          "DIRTY\n",
        );
        fs.writeFileSync(
          path.join(p, "devin-plugin", "new-file.md"),
          "pipeline leftover\n",
        );
      },
    }, pkg),
    log: () => {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.failedStep, "check-generated");
  assert.equal(res.rolledBack, true);
  assert.match(res.error ?? "", /simulated failure/);
  assert.equal(
    fs.readFileSync(path.join(pkg, "upstream.yml"), "utf8"),
    beforeUp,
  );
  assert.equal(fs.readFileSync(path.join(pkg, "apm.yml"), "utf8"), beforeApm);
  assert.equal(
    fs.readFileSync(path.join(pkg, "devin-plugin", "tracked.md"), "utf8"),
    "original content\n",
  );
  assert.equal(
    fs.existsSync(path.join(pkg, "devin-plugin", "new-file.md")),
    false,
    "untracked pipeline leftover removed",
  );
  assert.equal(
    git(root, "status", "--porcelain", "--", "packages/pstack-devin"),
    "",
    "worktree+index fully clean after rollback",
  );
  assert.match(git(root, "log", "-1", "--format=%s"), /^init$/);
});

test("apply-update: failure at apm install still rolls back the ref edits", () => {
  const { root, pkg } = fixtureWorktree();
  const cfg = loadBuildConfig(root);
  const beforeUp = fs.readFileSync(path.join(pkg, "upstream.yml"), "utf8");
  const calls: string[] = [];
  const res = applyUpdate(cfg, SHA_B, {
    repoRoot: root,
    runner: recordingRunner(calls, { failAt: "exec -- apm install" }),
    log: () => {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.failedStep, "apm install");
  assert.equal(res.rolledBack, true);
  assert.equal(fs.readFileSync(path.join(pkg, "upstream.yml"), "utf8"), beforeUp);
  assert.match(git(root, "log", "-1", "--format=%s"), /^init$/);
});

test("apply-update refuses to run over uncommitted pipeline-path changes", () => {
  const { root, pkg } = fixtureWorktree();
  // Load cfg BEFORE dirtying — main() does the same (config load precedes
  // the pre-flight dirty check that must reject this run).
  const cfg = loadBuildConfig(root);
  fs.appendFileSync(path.join(pkg, "upstream.yml"), "\n# dirty edit\n");
  assert.throws(
    () =>
      applyUpdate(cfg, SHA_B, {
        repoRoot: root,
        runner: recordingRunner([]),
        log: () => {},
      }),
    /uncommitted/,
  );
});

test("apply-update rejects a candidate equal to the current pin", () => {
  const { root } = fixtureWorktree();
  const cfg = loadBuildConfig(root);
  assert.throws(
    () =>
      applyUpdate(cfg, SHA_A, {
        repoRoot: root,
        runner: recordingRunner([]),
        log: () => {},
      }),
    /current pin/,
  );
});
