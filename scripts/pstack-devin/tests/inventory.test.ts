import test from "node:test";
import assert from "node:assert/strict";
import { scanTree } from "../src/inventory.js";

test("scanTree rejects symlinks, submodules, and unknown modes with the path in the error", () => {
  assert.throws(
    () => scanTree([{ path: "x", mode: "120000", type: "blob", sha: "a" }]),
    /x/,
  );
  assert.throws(
    () => scanTree([{ path: "y", mode: "160000", type: "commit", sha: "a" }]),
    /y/,
  );
  assert.throws(
    () => scanTree([{ path: "z", mode: "040000", type: "tree", sha: "a" }]),
    /z/,
  );
});

test("scanTree rejects case-insensitive path collisions", () => {
  assert.throws(
    () =>
      scanTree([
        { path: "skills/A.md", mode: "100644", type: "blob", sha: "a" },
        { path: "skills/a.md", mode: "100644", type: "blob", sha: "b" },
      ]),
    /collision|case/i,
  );
});

test("scanTree rejects unsafe upstream paths", () => {
  for (const bad of ["../escape.md", "a/../b.md", "/abs.md", "seg//double.md"]) {
    assert.throws(
      () => scanTree([{ path: bad, mode: "100644", type: "blob", sha: "a" }]),
      /unsafe|invalid/,
      bad,
    );
  }
});

test("scanTree collects executables and sorts entries", () => {
  const inv = scanTree([
    { path: "b.sh", mode: "100755", type: "blob", sha: "b" },
    { path: "a.md", mode: "100644", type: "blob", sha: "a" },
    { path: "c/z.sh", mode: "100755", type: "blob", sha: "c" },
  ]);
  assert.deepEqual(inv.executables, ["b.sh", "c/z.sh"]);
  assert.deepEqual(inv.entries.map((e) => e.path), ["a.md", "b.sh", "c/z.sh"]);
});
