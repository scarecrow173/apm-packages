import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBuildConfig } from "../src/config.js";
import { buildPlugin } from "../src/build.js";
import { checkGenerated } from "../src/check.js";
import {
  commitFixture,
  git,
  makeFixtureRepo,
  writeFixturePackage,
  tmpdir,
} from "./helpers.js";

const UP = "harness/pstack/claude-code";
const FIXTURE_VERSION = "0.1.0"; // writeFixturePackage's apm.yml version

const DEVIN_MANIFEST = {
  path: ".devin-plugin/plugin.json",
  content:
    JSON.stringify({ name: "pstack", version: FIXTURE_VERSION }) + "\n",
};
const AGENTS_MD = { path: "AGENTS.md", content: "# pstack\n\noverlay rule\n" };

function upstreamFiles(): { path: string; content: string; mode?: string }[] {
  return [
    {
      path: `${UP}/plugin.json`,
      content: JSON.stringify({ name: "pstack", version: "9.9.9" }) + "\n",
    },
    { path: `${UP}/skills/x/SKILL.md`, content: "---\nname: x\n---\nbody\n" },
    {
      path: `${UP}/skills/x/run.sh`,
      content: "#!/bin/sh\necho hi\n",
      mode: "100755",
    },
  ];
}

// The fixture root is a plain tmpdir, not a git work tree, so checkGenerated's
// index/commit gates must degrade to skip-with-warning while the content
// compare still applies.
test("checkGenerated passes on a freshly built tree and fails after tamper", async () => {
  const repo = makeFixtureRepo(upstreamFiles());
  const root = writeFixturePackage(tmpdir(), {
    commit: repo.commit,
    upstreamRepoUrl: repo.dir,
    overlayFiles: [DEVIN_MANIFEST, AGENTS_MD],
  });
  const pkg = path.join(root, "packages", "pstack-devin");
  const cfg = loadBuildConfig(root);
  await buildPlugin(cfg); // default outDir → <pkg>/devin-plugin

  await checkGenerated(root);
  // check-out temp dir must be cleaned up after a run
  assert.ok(!fs.existsSync(path.join(pkg, "build", "check-out")));

  // Tamper with the generated tree: an appended byte must be caught by the
  // rebuild-vs-committed content compare even without git gates.
  fs.appendFileSync(path.join(pkg, "devin-plugin", "skills", "x", "SKILL.md"), "x");
  await assert.rejects(checkGenerated(root), /drift|diff/i);
});

/** A git work-tree fixture whose HEAD carries a committed generated tree
 *  at `commit1`, with the pin moved to `commit2` and the tree rebuilt —
 *  exactly the apply-update shape: worktree output legitimately differs
 *  from HEAD before the single atomic commit. */
async function preCommitFixture(): Promise<{ root: string; pkg: string }> {
  const repo = makeFixtureRepo(upstreamFiles());
  const root = tmpdir();
  git(root, "init", "-q", ".");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@test");
  git(root, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
  writeFixturePackage(root, {
    commit: repo.commit,
    upstreamRepoUrl: repo.dir,
    overlayFiles: [DEVIN_MANIFEST, AGENTS_MD],
  });
  const pkg = path.join(root, "packages", "pstack-devin");
  await buildPlugin(loadBuildConfig(root));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "pin1");

  // Upstream advances by one file; the pin moves and the tree is rebuilt
  // but not yet committed — HEAD's tree is now legitimately stale.
  const commit2 = commitFixture(
    repo.dir,
    [
      ...upstreamFiles(),
      { path: `${UP}/skills/x/NEW.md`, content: "new upstream file\n" },
    ],
    { parent: repo.commit, updateMain: true },
  );
  writeFixturePackage(root, {
    commit: commit2,
    upstreamRepoUrl: repo.dir,
    overlayFiles: [DEVIN_MANIFEST, AGENTS_MD],
  });
  await buildPlugin(loadBuildConfig(root));
  return { root, pkg };
}

test("checkGenerated preCommit mode skips only the vs-HEAD gate", async () => {
  const { root, pkg } = await preCommitFixture();
  // Default mode: the staged tree differs from HEAD — out of sync.
  await assert.rejects(checkGenerated(root), /out of sync/);
  // Pre-commit mode: same staged tree passes — the vs-HEAD gate is the
  // only part skipped.
  await checkGenerated(root, { preCommit: true });
  // The env spelling (what apply-update sets for spawned children,
  // including the check nested inside `pnpm run verify`) behaves the same.
  process.env.PSTACK_DEVIN_CHECK_PRECOMMIT = "1";
  try {
    await checkGenerated(root);
  } finally {
    delete process.env.PSTACK_DEVIN_CHECK_PRECOMMIT;
  }
  // The rebuild-vs-worktree content compare still applies in preCommit
  // mode — a tampered file is caught.
  fs.appendFileSync(
    path.join(pkg, "devin-plugin", "skills", "x", "SKILL.md"),
    "x",
  );
  await assert.rejects(
    checkGenerated(root, { preCommit: true }),
    /drift|diff/i,
  );
});
