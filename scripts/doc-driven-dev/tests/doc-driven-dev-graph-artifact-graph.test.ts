import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { projectArtifactGraph, resolveContainedTaskDir } from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph";

/** Create a directory link inside the repo; false when the env cannot (skips). */
function linkDirectory(t: { skip: (message?: string) => void }, target: string, linkPath: string): boolean {
  try {
    // Junctions are Windows-only but need no privilege; POSIX uses dir symlinks.
    fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error: unknown) {
    t.skip(`cannot create symlinks/junctions here: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify("# Artifact\n", data), "utf8");
}

test("existing non-Markdown local relations are valid while missing files remain broken", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-local-file-"));
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/example.py"), "VALUE = 1\n", "utf8");
  writeArtifact(repo, "docs/specs/0001-spec.md", {
    id: "SPEC-0001",
    type: "spec",
    status: "approved",
    relations: {
      source: ["../../src/example.py", "../../src/missing.py"],
    },
  });

  const graph = projectArtifactGraph({ cwd: repo });
  const sourceEdges = graph.edges.filter((edge: { relation: string }) => edge.relation === "source");

  assert.equal(sourceEdges.length, 2);
  assert.ok(sourceEdges.every((edge: { to: string | null; external: boolean }) => (
    edge.to === null && edge.external === false
  )));
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/example.py")), false);
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/missing.py")), true);
  assert.equal(graph.issues.filter((issue: { code: string }) => issue.code === "broken-relation").length, 1);
});

test("projectArtifactGraph refuses a taskDir that escapes the checkout", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-taskdir-"));
  for (const taskDir of ["../outside", "./../outside", path.dirname(repo)]) {
    assert.throws(
      () => projectArtifactGraph({ cwd: repo, taskDir }),
      /--task-dir escapes the checkout/,
      `taskDir ${taskDir} must be rejected`,
    );
  }
  // Contained values — default, redundant, and custom — scan normally.
  for (const taskDir of ["docs/tasks", "./docs/tasks", "docs/../docs/tasks", "docs/work-items"]) {
    assert.doesNotThrow(() => projectArtifactGraph({ cwd: repo, taskDir }), taskDir);
  }
});

test("projectArtifactGraph refuses a taskDir that escapes through a link", (t) => {
  // An outside directory holding a task doc — if the scan followed the link
  // it would ingest outside Markdown.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-outside-"));
  fs.mkdirSync(path.join(outside, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(outside, "tasks/0001-task.md"), matter.stringify("# Task\n", {
    id: "TASK-0009", type: "task", status: "todo", title: "Outside", relations: {},
  }), "utf8");

  // The taskDir itself is a link inside the checkout pointing outside.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-linked-dir-"));
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  if (!linkDirectory(t, outside, path.join(repo, "docs/tasks-link"))) return;
  assert.throws(
    () => projectArtifactGraph({ cwd: repo, taskDir: "docs/tasks-link" }),
    /--task-dir escapes the checkout/,
  );

  // Same rule when a symlinked ancestor is the escape vector.
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-linked-root-"));
  if (!linkDirectory(t, outside, path.join(linked, "docs"))) return;
  assert.throws(
    () => projectArtifactGraph({ cwd: linked, taskDir: "docs/tasks" }),
    /--task-dir escapes the checkout/,
  );

  // A contained internal link still scans — realpath lands inside.
  const internal = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-internal-link-"));
  fs.mkdirSync(path.join(internal, "docs/tasks-real"), { recursive: true });
  if (!linkDirectory(t, path.join(internal, "docs/tasks-real"), path.join(internal, "docs/tasks"))) return;
  assert.doesNotThrow(() => projectArtifactGraph({ cwd: internal, taskDir: "docs/tasks" }));
});

test("resolveContainedTaskDir folds Windows interior case and extended-length prefixes", (t) => {
  if (process.platform !== "win32") {
    t.skip("case-folded and extended-length compares are Windows semantics");
    return;
  }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-case-"));
  fs.mkdirSync(path.join(repo, "docs/tasks"), { recursive: true });
  // Same path spelled with different interior case — win32 identity is
  // case-insensitive, so containment must accept rather than falsely reject.
  assert.equal(resolveContainedTaskDir(repo, `${repo.toUpperCase()}\\docs\\tasks`), "docs/tasks");
  // `\\?\` extended-length prefix is plumbing, not identity.
  assert.equal(resolveContainedTaskDir(repo, `\\\\?\\${path.join(repo, "docs", "tasks")}`), "docs/tasks");
});

test("resolveContainedTaskDir keeps POSIX containment case-sensitive", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX keeps case-sensitive path identity");
    return;
  }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-case-"));
  // A differently-cased absolute path is a different directory on POSIX —
  // flip a known segment so the spelling always differs.
  const altered = repo.replace("artifact-graph-case-", "ARTIFACT-GRAPH-CASE-");
  assert.notEqual(altered, repo);
  assert.throws(
    () => resolveContainedTaskDir(repo, altered),
    /--task-dir escapes the checkout/,
  );
});
