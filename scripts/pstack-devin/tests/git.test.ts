import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchAtCommit, listTree, treeSha, catFileBlobs } from "../src/gittools.js";
import { scanTree } from "../src/inventory.js";
import { makeFixtureRepo, tmpdir, git } from "./helpers.js";

test("fetchAtCommit resolves the fixture commit in a fresh clone", () => {
  const repo = makeFixtureRepo([{ path: "a.txt", content: "hello" }]);
  const repoDir = fetchAtCommit(repo.dir, repo.commit, tmpdir());
  const entries = listTree(repoDir, repo.commit, "");
  assert.deepEqual(entries.map((e) => e.path), ["a.txt"]);
  assert.equal(entries[0].mode, "100644");
  assert.equal(entries[0].type, "blob");
});

test("fetchAtCommit also resolves commits not reachable from any ref", () => {
  const repo = makeFixtureRepo([{ path: "a.txt", content: "x" }]);
  const tree = git(repo.dir, "rev-parse", "main^{tree}");
  const orphan = git(repo.dir, "commit-tree", tree, "-m", "unreachable");
  const repoDir = fetchAtCommit(repo.dir, orphan, tmpdir());
  assert.deepEqual(listTree(repoDir, orphan, "").map((e) => e.path), ["a.txt"]);
});

test("fetchAtCommit hard-fails when the commit is absent after fallback", () => {
  const repo = makeFixtureRepo([{ path: "a.txt", content: "x" }]);
  assert.throws(() => fetchAtCommit(repo.dir, "1".repeat(40), tmpdir()));
});

test("listTree sorts entries and scopes subpaths to subtree-relative paths", () => {
  const repo = makeFixtureRepo([
    { path: "b/z.txt", content: "z" },
    { path: "a/y.txt", content: "y" },
    { path: "top.txt", content: "t" },
  ]);
  const repoDir = fetchAtCommit(repo.dir, repo.commit, tmpdir());
  assert.deepEqual(
    listTree(repoDir, repo.commit, "").map((e) => e.path),
    ["a/y.txt", "b/z.txt", "top.txt"],
  );
  const sub = listTree(repoDir, repo.commit, "b");
  assert.deepEqual(sub.map((e) => e.path), ["z.txt"]);
  const rootSha = treeSha(repoDir, repo.commit, "");
  const subSha = treeSha(repoDir, repo.commit, "b");
  assert.equal(rootSha, repo.commit); // empty subpath resolves the commitish itself
  assert.match(subSha, /^[0-9a-f]{40}$/);
  assert.notEqual(subSha, repo.commit);
});

test("catFileBlobs writes blob bytes verbatim including exec-bit files", async () => {
  const files = [
    { path: "skills/x/run.sh", content: "#!/bin/sh\necho hi\n", mode: "100755" },
    { path: "skills/x/SKILL.md", content: "---\nname: x\n---\nbody\n" },
    { path: "bin.dat", content: Buffer.from([0, 1, 2, 255, 254, 13, 10, 0]) },
  ];
  const repo = makeFixtureRepo(files);
  const repoDir = fetchAtCommit(repo.dir, repo.commit, tmpdir());
  const inv = scanTree(listTree(repoDir, repo.commit, ""));
  const runSh = inv.entries.find((e) => e.path === "skills/x/run.sh");
  assert.equal(runSh?.mode, "100755");
  assert.deepEqual(inv.executables, ["skills/x/run.sh"]);
  const outDir = path.join(tmpdir(), "out");
  await catFileBlobs(repoDir, inv.entries, outDir);
  for (const f of files) {
    const written = fs.readFileSync(path.join(outDir, f.path));
    const expected = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    assert.deepEqual(written, expected, f.path);
  }
});

test("listTree surfaces non-blob modes for the scanner to reject", () => {
  const repo = makeFixtureRepo([
    { path: "real.txt", content: "ok" },
    { path: "evil-link", content: "real.txt", mode: "120000" },
  ]);
  const repoDir = fetchAtCommit(repo.dir, repo.commit, tmpdir());
  const entries = listTree(repoDir, repo.commit, "");
  const link = entries.find((e) => e.path === "evil-link");
  assert.equal(link?.mode, "120000");
  assert.throws(() => scanTree(entries), /evil-link/);
});
