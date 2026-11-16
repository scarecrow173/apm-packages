import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadBuildConfig } from "../src/config.js";
import { buildPlugin } from "../src/build.js";
import { makeFixtureRepo, writeFixturePackage, tmpdir, git } from "./helpers.js";

const UP = "harness/pstack/claude-code";
const FIXTURE_VERSION = "0.1.0"; // writeFixturePackage's apm.yml version

const DEVIN_MANIFEST = {
  path: ".devin-plugin/plugin.json",
  content:
    JSON.stringify({ name: "pstack", version: FIXTURE_VERSION }) + "\n",
};

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

function fixtureCfg(
  repo: { dir: string; commit: string },
  overlayFiles: { path: string; content: string }[],
): ReturnType<typeof loadBuildConfig> {
  return loadBuildConfig(
    writeFixturePackage(tmpdir(), {
      commit: repo.commit,
      upstreamRepoUrl: repo.dir,
      overlayFiles,
    }),
  );
}

/** Recursive rel-path → sha256 map of a directory tree. */
function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string, rel: string): void => {
    for (const de of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(path.join(d, de.name), r);
      } else {
        out.set(
          r,
          createHash("sha256")
            .update(fs.readFileSync(path.join(d, de.name)))
            .digest("hex"),
        );
      }
    }
  };
  walk(dir, "");
  return out;
}

test("buildPlugin produces upstream-verbatim output + overlay + provenance", async () => {
  const files = upstreamFiles();
  const repo = makeFixtureRepo(files);
  const cfg = fixtureCfg(repo, [DEVIN_MANIFEST]);
  const outDir = path.join(tmpdir(), "out");
  const res = await buildPlugin(cfg, { outDir });

  for (const f of files) {
    const rel = f.path.slice(UP.length + 1);
    assert.equal(
      fs.readFileSync(path.join(outDir, rel), "utf8"),
      f.content,
      rel,
    );
  }
  assert.equal(
    fs.readFileSync(path.join(outDir, ".devin-plugin/plugin.json"), "utf8"),
    DEVIN_MANIFEST.content,
  );
  const prov = JSON.parse(
    fs.readFileSync(path.join(outDir, "provenance.json"), "utf8"),
  );
  assert.equal(prov.upstream.version, "9.9.9");
  assert.equal(prov.upstream.commit, repo.commit);
  assert.equal(
    prov.upstream.tree_sha,
    git(repo.dir, "rev-parse", `${repo.commit}:${UP}`),
  );
  assert.equal(prov.upstream.file_count, files.length);
  assert.deepEqual(prov.executables, ["skills/x/run.sh"]);
  assert.deepEqual(prov.overlay.overwrites, []);
  assert.deepEqual(
    prov.overlay.additions.map((a: { path: string }) => a.path),
    [".devin-plugin/plugin.json"],
  );
  // input count + 1 overlay addition + provenance.json itself
  assert.equal(res.fileCount, files.length + 1 + 1);
  assert.equal(res.treeSha, prov.upstream.tree_sha);
  assert.equal(res.outDir, outDir);
});

test("rebuild is byte-identical (determinism)", async () => {
  const repo = makeFixtureRepo(upstreamFiles());
  const cfg = fixtureCfg(repo, [DEVIN_MANIFEST]);
  const a = path.join(tmpdir(), "a");
  const b = path.join(tmpdir(), "b");
  await buildPlugin(cfg, { outDir: a });
  await buildPlugin(cfg, { outDir: b });
  assert.deepEqual(hashTree(a), hashTree(b));
});

test("failed build preserves a previous output dir", async () => {
  const repo = makeFixtureRepo(upstreamFiles());
  const cfg = fixtureCfg(repo, [
    DEVIN_MANIFEST,
    { path: "skills/x/SKILL.md", content: "sabotage — not allowlisted" },
  ]);
  const outDir = path.join(tmpdir(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "SENTINEL.txt"), "keep me");
  await assert.rejects(
    buildPlugin(cfg, { outDir }),
    /allowlist|skills\/x\/SKILL\.md/i,
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, "SENTINEL.txt"), "utf8"),
    "keep me",
  );
  assert.deepEqual(fs.readdirSync(outDir), ["SENTINEL.txt"]);
});
