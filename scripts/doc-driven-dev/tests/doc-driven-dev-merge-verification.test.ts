import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { commitAll, createFixtureRepo, writeArtifact } from "./e2e/harness/fixture_manager";
import {
  collectChangedPaths,
  verifyEvidenceBinding,
  verifyParallelMerge,
  type SliceOutcome,
} from "../src/skills/implementation-flow/scripts/lib/merge_verification";

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

/**
 * Write a `## Affected Files` scope into a fixture task doc, preserving front
 * matter. The doc side is the authority for supplied declaredScope entries —
 * every test that supplies a scope declares it here.
 */
function declareTaskScope(repo: string, index: number, entries: string[]): void {
  const file = path.join(repo, `docs/tasks/${String(index).padStart(4, "0")}-task.md`);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const body = `# Task\n\n## Affected Files\n\n${entries.map((entry) => `- ${entry}`).join("\n")}\n\n## Verification\n\n- [ ] node --test\n`;
  fs.writeFileSync(file, matter.stringify(body, parsed.data), "utf8");
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
  commitAll(repo);
  assert.deepEqual(collectChangedPaths(repo, "HEAD~1"), ["src/a.ts", "src/new.ts"]);
  // A clean working tree diffs to nothing against HEAD itself.
  assert.deepEqual(collectChangedPaths(repo), []);
});

test("collectChangedPaths rejects option-like and unresolvable baseRefs", () => {
  const repo = createFixtureRepo();
  assert.throws(() => collectChangedPaths(repo, "--help"));
  assert.throws(() => collectChangedPaths(repo, "-q"));
  assert.throws(() => collectChangedPaths(repo, "refs/heads/definitely-missing"));
});

test("collectChangedPaths reports filenames with spaces unquoted", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "src/with space.ts", "export const spaced = 0;\n");
  assert.deepEqual(collectChangedPaths(repo), ["src/with space.ts"]);
});

test("collectChangedPaths reports both endpoints of a staged rename", () => {
  const repo = createFixtureRepo();
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, ["mv", "docs/tasks/0001-task.md", "src/renamed.ts"]);
  const changed = collectChangedPaths(repo);
  assert.ok(changed.includes("docs/tasks/0001-task.md"), `missing rename source in ${JSON.stringify(changed)}`);
  assert.ok(changed.includes("src/renamed.ts"));
});

test("collectChangedPaths reports both endpoints of a committed rename via baseRef", () => {
  const repo = createFixtureRepo();
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, ["mv", "docs/tasks/0001-task.md", "src/renamed.ts"]);
  commitAll(repo);
  const changed = collectChangedPaths(repo, "HEAD~1");
  assert.ok(changed.includes("docs/tasks/0001-task.md"), `missing rename source in ${JSON.stringify(changed)}`);
  assert.ok(changed.includes("src/renamed.ts"));
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
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  declareTaskScope(repo, 1, ["src/a.ts"]);
  declareTaskScope(repo, 2, ["src/auth/"]);
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
      "docs/tasks/0001-task.md": "# Task\n\n## Affected Files\n\n- src/a.ts\n\nEvidence for TASK-0001.\n",
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
  declareTaskScope(repo, 1, ["src/a.ts"]);
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
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "docs/tasks/0003-task.md"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "docs/tasks/0003-task.md");
});

test("another task's doc is blocked even when the task-dir is scope-declared", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["docs/tasks/"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["docs/tasks/"], touchedPaths: ["docs/tasks/0002-task.md"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "docs/tasks/0002-task.md");
});

test("the own task doc and declared docs/impl/ evidence need no scope declaration", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/0001-record.md", "# Record\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts", "docs/tasks/0001-task.md", "docs/impl/0001-record.md"],
      evidencePaths: ["docs/impl/0001-record.md"],
    }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("the same path touched by two slices is a write-collision", () => {
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  declareTaskScope(repo, 1, ["src/shared.ts"]);
  declareTaskScope(repo, 2, ["src/shared.ts"]);
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
  declareTaskScope(repo, 1, ["src/a.ts"]);
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
  declareTaskScope(repo, 1, ["src/a.ts"]);
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
  declareTaskScope(repo, 1, ["src/a.ts"]);
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
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  declareTaskScope(repo, 1, ["src/a.ts"]);
  declareTaskScope(repo, 2, ["src/b.ts"]);
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

// --- unverifiable path rejection (fail closed) ------------------------------

test("a traversal in a touched path is a blocked scope-violation, not in-scope", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/"], touchedPaths: ["src/../outside.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/../outside.ts");
});

test("a traversal in an evidence path cannot escape docs/impl/", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/../tasks/0001-task.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.equal(report.findings[0].path, "docs/impl/../tasks/0001-task.md");
});

test("a whitespace-padded traversal is still rejected after trimming", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/"], touchedPaths: [".. "] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
});

test("unverifiable declared scope entries are blocked scope-violations", () => {
  const repo = createFixtureRepo();
  for (const badScope of ["../outside.ts", "C:/temp/x.ts", "/etc/passwd", "src/gen/**/x.ts", "../outside.ts "]) {
    const report = verifyParallelMerge(repo, [slice({ declaredScope: [badScope] })]);
    assert.equal(report.verdict, "blocked", `scope ${badScope}`);
    assert.equal(report.findings[0].code, "scope-violation");
  }
});

test("an unverifiable taskDocPath is an evidence-mismatch", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
      taskDocPath: "../outside-task.md",
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(report.findings.some((finding) => finding.code === "evidence-mismatch" && finding.path === "../outside-task.md"));
});

test("verifyEvidenceBinding rejects unverifiable paths without reading outside cwd", () => {
  const repo = createFixtureRepo();
  assert.equal(verifyEvidenceBinding(repo, "../outside.md", "TASK-0001"), false);
  assert.equal(verifyEvidenceBinding(repo, "/etc/passwd", "TASK-0001"), false);
});

test("verifyEvidenceBinding rejects an empty task ID instead of matching everything", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/evidence.md", "# Evidence\n");
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/evidence.md", ""), false);
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/evidence.md", "  "), false);
});

// --- bad-input fail-closed checks --------------------------------------------

test("duplicate slice taskIds are blocked instead of masking collisions", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts", "src/b.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({ declaredScope: ["src/b.ts"], touchedPaths: ["src/shared.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(report.findings.some((finding) => finding.code === "write-collision" && finding.taskId === "TASK-0001"));
});

test("an empty slice list fails closed to blocked, not a vacuous merge", () => {
  const report = verifyParallelMerge(createFixtureRepo(), []);
  assert.equal(report.verdict, "blocked");
});

test("an empty slice taskId fails closed instead of binding any evidence", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/evidence.md", "# Evidence\n");
  const report = verifyParallelMerge(repo, [
    slice({
      taskId: "",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/evidence.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
});

// --- taskDir option -----------------------------------------------------------

test("the taskDir option relocates the protected task-doc boundary", () => {
  const repo = createFixtureRepo();
  // The slice's own doc must live under the relocated task dir to bind.
  writeArtifact(repo, "custom/tasks/0001-task.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "TASK-0001",
  }, "# Task\n\n## Affected Files\n\n- src/a.ts\n");
  const blocked = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["custom/tasks/0003-task.md"],
      taskDocPath: "custom/tasks/0001-task.md",
    }),
  ], { taskDir: "custom/tasks" });
  assert.equal(blocked.verdict, "blocked");
  assert.equal(blocked.findings[0].code, "scope-violation");
  const review = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["docs/tasks/0003-task.md"],
      taskDocPath: "custom/tasks/0001-task.md",
    }),
  ], { taskDir: "custom/tasks" });
  assert.equal(review.verdict, "merge-review");
});

test("an escaping taskDir is rejected instead of falling back to docs/tasks", () => {
  const repo = createFixtureRepo();
  for (const taskDir of ["../outside", "./../outside", path.dirname(repo), "docs/../../outside"]) {
    assert.throws(
      () => verifyParallelMerge(repo, [], { taskDir }),
      /--task-dir escapes the checkout/,
      `taskDir ${taskDir} must be rejected`,
    );
  }
  // The same check runs at check_parallel's --task-dir boundary, but the
  // library fails closed on its own so no caller can verify against an
  // outside or silently defaulted directory.
});

test("a taskDir escaping through a link is rejected", (t) => {
  const repo = createFixtureRepo();
  const outside = fs.mkdtempSync(path.join(path.dirname(repo), "merge-outside-"));
  try {
    fs.symlinkSync(outside, path.join(repo, "docs/tasks-link"), process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("cannot create symlinks/junctions here");
    return;
  }
  assert.throws(
    () => verifyParallelMerge(repo, [], { taskDir: "docs/tasks-link" }),
    /--task-dir escapes the checkout/,
  );
});

// --- declared-scope authority (task doc ## Affected Files) --------------------

test("a supplied scope entry wider than the task doc declaration is blocked", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/");
});

test("a supplied scope entry absent from the task doc declaration is blocked", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts", "src/other.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  const inflated = report.findings.filter((finding) => finding.code === "scope-violation");
  assert.deepEqual(inflated.map((finding) => finding.path), ["src/other.ts"]);
});

test("a narrower supplied scope verifies against a dir-declared task doc", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("an opaque entry in the task doc blocks every supplied scope claim", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["auth module"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/a.ts");
});

test("a fenced ## Affected Files section does not declare scope", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/tasks/0001-task.md": {
        frontmatter: { id: "TASK-0001", type: "task", status: "todo", title: "TASK-0001" },
        body: "# Task\n\n```md\n## Affected Files\n\n- src/a.ts\n```\n\n## Verification\n\n- [ ] node --test\n",
      },
    },
  });
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
});

test("a non-path declaredScope entry is blocked, not a file pattern", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  for (const badScope of ["auth module", "README", "src/<module>.ts", "{{src/a.ts}}"]) {
    const report = verifyParallelMerge(repo, [slice({ declaredScope: [badScope] })]);
    assert.equal(report.verdict, "blocked", `scope ${badScope}`);
    assert.equal(report.findings[0].code, "scope-violation");
    assert.equal(report.findings[0].path, badScope);
  }
});

// --- case-folded path comparison -----------------------------------------------

test("paths compare case-insensitively for scope, task-doc, and collisions", () => {
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  declareTaskScope(repo, 1, ["SRC/A.TS"]);
  declareTaskScope(repo, 2, ["src/a.ts"]);
  const clean = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["Src/A.ts"] }),
  ]);
  assert.equal(clean.verdict, "merge");
  const collision = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["SRC/SHARED.TS"],
      taskDocPath: "docs/tasks/0002-task.md",
    }),
  ]);
  assert.ok(
    collision.findings.some((finding) => finding.code === "write-collision"),
    "case-folded collision expected",
  );
});

// --- evidence symlink containment ----------------------------------------------

test("an evidence symlink escaping the repo fails binding", () => {
  const repo = createFixtureRepo();
  const outside = fs.mkdtempSync(path.join(repo, "..", "evidence-outside-"));
  writeFile(outside, "leak.md", "# Leak\n\nTASK-0001\n");
  try {
    fs.symlinkSync(path.join(outside, "leak.md"), path.join(repo, "docs/impl/leak.md"));
  } catch {
    return; // platform without symlink permission (e.g. Windows without dev mode)
  }
  assert.equal(verifyEvidenceBinding(repo, "docs/impl/leak.md", "TASK-0001"), false);
});

// --- task doc binding (taskDocPath is asserted, not trusted) -------------------

test("a taskDocPath outside the task-doc subtree is blocked and grants no exemption", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts", "docs/plans/0001-graph.md"],
      taskDocPath: "docs/plans/0001-graph.md",
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "evidence-mismatch" && finding.path === "docs/plans/0001-graph.md",
    ),
    `expected a taskDocPath finding in ${JSON.stringify(report.findings)}`,
  );
});

test("another task's doc claimed as taskDocPath is blocked and grants no authority", () => {
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  declareTaskScope(repo, 2, ["docs/tasks/"]);
  const report = verifyParallelMerge(repo, [
    slice({
      taskId: "TASK-0001",
      declaredScope: ["docs/tasks/"],
      touchedPaths: ["docs/tasks/0002-task.md"],
      taskDocPath: "docs/tasks/0002-task.md",
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "evidence-mismatch" && finding.path === "docs/tasks/0002-task.md",
    ),
    `expected a binding finding in ${JSON.stringify(report.findings)}`,
  );
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "scope-violation" && finding.path === "docs/tasks/0002-task.md",
    ),
    `expected the claimed doc write to stay blocked in ${JSON.stringify(report.findings)}`,
  );
});

test("a taskDocPath whose doc carries a different task ID is blocked even with a matching body mention", () => {
  const repo = createFixtureRepo({ taskStatuses: ["todo", "todo"] });
  // The victim doc references TASK-0001 in its body but its identity is TASK-0002.
  declareTaskScope(repo, 2, ["src/b.ts"]);
  const file = path.join(repo, "docs/tasks/0002-task.md");
  fs.appendFileSync(file, "\nDepends on TASK-0001.\n", "utf8");
  const report = verifyParallelMerge(repo, [
    slice({ taskDocPath: "docs/tasks/0002-task.md" }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.equal(report.findings[0].path, "docs/tasks/0002-task.md");
});

test("a missing taskDocPath is a blocked evidence-mismatch, not a silent skip", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      taskDocPath: "docs/tasks/0099-missing.md",
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "evidence-mismatch" && finding.path === "docs/tasks/0099-missing.md",
    ),
    `expected a missing-doc finding in ${JSON.stringify(report.findings)}`,
  );
});

test("a taskDocPath naming the task dir itself is blocked", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, [slice({ taskDocPath: "docs/tasks" })]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
});

// --- declared-evidence boundary ----------------------------------------------

test("an undeclared docs/impl/ write needs scope like any other path", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/0001-record.md", "# Record\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "docs/impl/0001-record.md"] }),
  ]);
  assert.equal(report.verdict, "merge-review");
  assert.deepEqual(
    report.findings.map((finding) => ({ code: finding.code, path: finding.path })),
    [{ code: "scope-violation", path: "docs/impl/0001-record.md" }],
  );
});

// --- doc-authority coverage kinds ----------------------------------------------

test("a doc file entry does not cover a supplied directory claim", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a"]);
  const report = verifyParallelMerge(repo, [
    slice({ declaredScope: ["src/a/"], touchedPaths: ["src/a/x.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/a/");
});
