import test from "node:test";
import assert from "node:assert/strict";
import { loadBuildConfig, assertSafeRelPath } from "../src/config.js";
import { writeFixturePackage, tmpdir } from "./helpers.js";

test("loadBuildConfig parses the real package and enforces 3-way equality", () => {
  const cfg = loadBuildConfig(writeFixturePackage(tmpdir(), {}));
  assert.equal(cfg.upstream.commit.length, 40);
  assert.equal(cfg.upstream.repoUrl, "https://github.com/cursor/plugins.git");
  assert.equal(cfg.overlay.dir.endsWith("overlay"), true);
});

test("loadBuildConfig hard-fails when devDep ref diverges and names the side", () => {
  const root = writeFixturePackage(tmpdir(), { devDepRef: "0".repeat(40) });
  assert.throws(() => loadBuildConfig(root), /devDep.*ref.*does not match|mismatch/i);
});

test("loadBuildConfig hard-fails when lockfile resolved_commit diverges", () => {
  const root = writeFixturePackage(tmpdir(), { lockCommit: "1".repeat(40) });
  assert.throws(() => loadBuildConfig(root), /resolved_commit/i);
});

test("assertSafeRelPath rejects traversal and absolute forms", () => {
  for (const bad of ["../x", "a/../../b", "/abs", "C:\\win", "a\\..\\b", "a\0b", ""]) {
    assert.throws(() => assertSafeRelPath(bad, "test"), /unsafe|traversal|invalid/i, bad);
  }
  assertSafeRelPath("skills/setup-pstack/SKILL.md", "test"); // no throw
});
