import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFixtureRepo } from "./e2e/harness/fixture_manager";
import {
  collectChangedPaths,
  verifyEvidenceBinding,
  verifyParallelMerge,
  type SliceOutcome,
} from "../src/skills/implementation-flow/scripts/lib/merge_verification";

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function slice(overrides: Partial<SliceOutcome> = {}): SliceOutcome {
  return {
    taskId: "TASK-0001",
    declaredScope: [],
    touchedPaths: [],
    evidencePaths: [],
    taskDocPath: "docs/tasks/0001-task.md",
    ...overrides,
  };
}

// --- collectChangedPaths ---------------------------------------------------

test("collectChangedPaths returns modified and untracked paths, normalized and sorted", () => {
  const repo = createFixtureRepo({
    files: {
      "src/a.ts": "export const a = 0;\n",
      "src/clean.ts": "export const clean = 0;\n",
    },
  });
  writeFile(repo, "src/a.ts", "export const a = 1;\n");
  writeFile(repo, "src/new.ts", "export const added = 0;\n");
  assert.deepEqual(collectChangedPaths(repo), ["src/a.ts", "src/new.ts"]);
});

test("collectChangedPaths diffs against an explicit baseRef including committed changes", () => {
  const repo = createFixtureRepo({
    files: { "src/a.ts": "export const a = 0;\n" },
  });
  writeFile(repo, "src/a.ts", "export const a = 1;\n");
  writeFile(repo, "src/new.ts", "export const added = 0;\n");
  const committed = collectChangedPaths(repo);
  assert.deepEqual(committed, ["src/a.ts", "src/new.ts"]);
});

test("collectChangedPaths dedupes staged entries reported by porcelain and diff", () => {
  const repo = createFixtureRepo({
    files: { "src/a.ts": "export const a = 0;\n" },
  });
  writeFile(repo, "src/a.ts", "export const a = 1;\n");
  const first = collectChangedPaths(repo);
  const second = collectChangedPaths(repo);
  assert.deepEqual(first, ["src/a.ts"]);
  assert.deepEqual(second, first);
});

// --- verifyEvidenceBinding ----------------------------------------------------

test("verifyEvidenceBinding is true only when the file literally contains the task ID", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nImplements TASK-0001.\n");
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nImplements TASK-0002.\n");
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/0001-evidence.md", "TASK-0001"), true);
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/0002-evidence.md", "TASK-0001"), false);
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/missing.md", "TASK-0001"), false);
});

// --- verifyParallelMerge ------------------------------------------------------

test("clean slices with in-scope diffs and bound evidence merge", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nTASK-0002 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
    }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/auth/"],
      touchedPaths: ["src/auth/login.ts"],
      evidencePaths: ["docs/impl/0002-evidence.md"],
      taskDocPath: "docs/tasks/0002-task.md",
    }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("a slice's own task doc counts as an allowed evidence path", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/tasks/0001-task.md": "# Task\n\nEvidence for TASK-0001.\n",
    },
  });
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/tasks/0001-task.md"],
    }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("touching an undeclared path is a scope-violation needing merge-review", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "src/other.ts"] }),
  ]);
  assert.equal(report.verdict, "merge-review");
  assert.deepEqual(
    report.findings.map((finding) => ({ code: finding.code, taskId: finding.taskId, path: finding.path })),
    [{ code: "scope-violation", taskId: "TASK-0001", path: "src/other.ts" }],
  );
});

test("touching an undeclared task-doc status target is blocked, not merge-review", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "docs/tasks/0003-task.md"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "docs/tasks/0003-task.md");
});

test("the same path touched by two slices is a write-collision", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/shared.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/shared.ts"],
      touchedPaths: ["src/shared.ts"],
      taskDocPath: "docs/tasks/0002-task.md",
    }),
  ]);
  assert.equal(report.verdict, "merge-review");
  assert.deepEqual(
    report.findings.map((finding) => ({ code: finding.code, path: finding.path })),
    [{ code: "write-collision", path: "src/shared.ts" }],
  );
});

test("evidence bound to another task's ID is an evidence-mismatch and blocks", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0002 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.equal(report.findings[0].taskId, "TASK-0001");
  assert.equal(report.findings[0].path, "docs/impl/0001-evidence.md");
});

test("evidence outside docs/impl/ and the own task doc is an evidence-mismatch", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/notes/evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/notes/evidence.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.equal(report.findings[0].path, "docs/notes/evidence.md");
});

test("a missing evidence file is an evidence-mismatch and blocks", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/nonexistent.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
});

test("the worst verdict wins and findings sort blocked-severity first", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nTASK-0001 only.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts", "src/other.ts"],
    }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/b.ts"],
      touchedPaths: ["src/b.ts"],
      evidencePaths: ["docs/impl/0002-evidence.md"],
      taskDocPath: "docs/tasks/0002-task.md",
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["evidence-mismatch", "scope-violation"],
  );
});
