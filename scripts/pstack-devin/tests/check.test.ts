import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBuildConfig } from "../src/config.js";
import { buildPlugin } from "../src/build.js";
import { checkGenerated } from "../src/check.js";
import { makeFixtureRepo, writeFixturePackage, tmpdir } from "./helpers.js";

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
