import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { commitAll, createFixtureRepo } from "./e2e/harness/fixture_manager";
import { createRun, updateTask } from "../src/skills/lib/execution_store";
import {
  collectChangedPaths,
  verifyEvidenceBinding,
  verifyParallelMerge,
  type SliceOutcome,
} from "../src/skills/implementation-flow/scripts/lib/merge_verification";

const RUN_ID = "e2e-run";

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
 * Declare a task's write scope on its Execution Store record — the scope
 * authority every supplied declaredScope entry is verified against
 * (Issue #237). Records start at version 1 in a fresh fixture.
 */
function declareTaskScope(repo: string, index: number, entries: string[]): void {
  const taskId = `TASK-${String(index).padStart(4, "0")}`;
  updateTask(repo, RUN_ID, taskId, { scope: entries }, { expectedVersion: 1 });
}

function slice(overrides: Partial<SliceOutcome> = {}): SliceOutcome {
  return {
    taskId: "TASK-0001",
    declaredScope: [],
    touchedPaths: [],
    evidencePaths: [],
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
  const repo = createFixtureRepo({
    taskStatuses: ["todo", "todo"],
    taskScopes: [["src/a.ts"], ["src/auth/"]],
  });
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nTASK-0002 done.\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
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
    }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("a legacy task doc is ordinary repo content, not evidence — only docs/impl/ binds", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      // v2 accepted the slice's own task doc as evidence; under the store the
      // doc is migration corpus — evidence lives under docs/impl/ only.
      evidencePaths: ["docs/tasks/0001-task.md"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "evidence-mismatch");
  assert.equal(report.findings[0].path, "docs/tasks/0001-task.md");
});

test("touching an undeclared path is a scope-violation needing merge-review", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "src/other.ts"] }),
  ]);
  assert.equal(report.verdict, "merge-review");
  assert.deepEqual(
    report.findings.map((finding) => ({ code: finding.code, taskId: finding.taskId, path: finding.path })),
    [{ code: "scope-violation", taskId: "TASK-0001", path: "src/other.ts" }],
  );
});

test("touching a legacy task doc is a normal scope question, not a protected write", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "docs/tasks/0003-task.md"] }),
  ]);
  // docs/tasks/* is migration corpus — no special protection, just scope.
  assert.equal(report.verdict, "merge-review");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "docs/tasks/0003-task.md");
});

test("a touched path inside the execution state root is blocked even when declared", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, [".apm/state/"]);
  const storePath = ".apm/state/doc-driven-dev/runs/e2e-run/tasks/TASK-0001.json";
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: [".apm/state/"], touchedPaths: [storePath] }),
  ]);
  // Store records are never writable worktree paths — a slice diff reaching
  // inside the state root would bypass the record CAS. Blocked, not review.
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, storePath);
});

test("declared docs/impl/ evidence needs no scope declaration; other paths still do", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/0001-record.md", "# Record\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts", "docs/impl/0001-record.md"],
      evidencePaths: ["docs/impl/0001-record.md"],
    }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("the same path touched by two slices is a write-collision", () => {
  const repo = createFixtureRepo({
    taskStatuses: ["todo", "todo"],
    taskScopes: [["src/shared.ts"], ["src/shared.ts"]],
  });
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/shared.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/shared.ts"],
      touchedPaths: ["src/shared.ts"],
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
  const report = verifyParallelMerge(repo, RUN_ID, [
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

test("evidence outside docs/impl/ is an evidence-mismatch", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/notes/evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
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
  const report = verifyParallelMerge(repo, RUN_ID, [
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
  const repo = createFixtureRepo({
    taskStatuses: ["todo", "todo"],
    taskScopes: [["src/a.ts"], ["src/b.ts"]],
  });
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nTASK-0001 only.\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
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
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/"], touchedPaths: ["src/../outside.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/../outside.ts");
});

test("a traversal in an evidence path cannot escape docs/impl/", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
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
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/"], touchedPaths: [".. "] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
});

test("unverifiable declared scope entries are blocked scope-violations", () => {
  const repo = createFixtureRepo();
  for (const badScope of ["../outside.ts", "C:/temp/x.ts", "/etc/passwd", "src/gen/**/x.ts", "../outside.ts "]) {
    const report = verifyParallelMerge(repo, RUN_ID, [slice({ declaredScope: [badScope] })]);
    assert.equal(report.verdict, "blocked", `scope ${badScope}`);
    assert.equal(report.findings[0].code, "scope-violation");
  }
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
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({ declaredScope: ["src/b.ts"], touchedPaths: ["src/shared.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(report.findings.some((finding) => finding.code === "write-collision" && finding.taskId === "TASK-0001"));
});

test("an empty slice list fails closed to blocked, not a vacuous merge", () => {
  const report = verifyParallelMerge(createFixtureRepo(), RUN_ID, []);
  assert.equal(report.verdict, "blocked");
});

test("an empty slice taskId fails closed instead of binding any evidence", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/evidence.md", "# Evidence\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
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

// --- state-root option --------------------------------------------------------
//
// v2 protected the task-doc subtree via --task-dir; v3 protects the resolved
// Execution Store root instead — the subtree where task records live.

test("a custom inside-checkout state root relocates the protected boundary", () => {
  const repo = createFixtureRepo({ run: false });
  const custom = { stateRoot: "custom/state" };
  // Inside-checkout roots need the same ignore coverage .apm/state gets.
  fs.appendFileSync(path.join(repo, ".gitignore"), "/custom/state/\n");
  createRun(repo, {
    runId: RUN_ID,
    plan: "# Plan\n",
    tasks: [{ taskId: "TASK-0001", scope: ["src/a.ts"] }],
  }, custom);

  const touched = "custom/state/runs/e2e-run/tasks/TASK-0001.json";
  const blocked = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: [touched] }),
  ], custom);
  assert.equal(blocked.verdict, "blocked");
  assert.equal(blocked.findings[0].code, "scope-violation");
  assert.equal(blocked.findings[0].path, touched);
});

test("an external state root without --allow-external-root fails closed", () => {
  const repo = createFixtureRepo();
  const outside = fs.mkdtempSync(path.join(repo, "..", "merge-external-state-"));
  assert.throws(
    () => verifyParallelMerge(repo, RUN_ID, [slice()], { stateRoot: outside }),
    /external|state root/i,
  );
});

// --- declared-scope authority (the task record's scope) -----------------------

test("a supplied scope entry wider than the record's declaration is blocked", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/");
});

test("a supplied scope entry absent from the record's declaration is blocked", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts", "src/other.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  const inflated = report.findings.filter((finding) => finding.code === "scope-violation");
  assert.deepEqual(inflated.map((finding) => finding.path), ["src/other.ts"]);
});

test("a narrower supplied scope verifies against a dir-declared record", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("an opaque entry in the record scope blocks every supplied scope claim", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["auth module"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/a.ts");
});

test("an empty record scope declares nothing — every supplied claim inflates", () => {
  const repo = createFixtureRepo(); // record scope defaults to []
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/a.ts");
});

test("a non-path declaredScope entry is blocked, not a file pattern", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  for (const badScope of ["auth module", "README", "src/<module>.ts", "{{src/a.ts}}"]) {
    const report = verifyParallelMerge(repo, RUN_ID, [slice({ declaredScope: [badScope] })]);
    assert.equal(report.verdict, "blocked", `scope ${badScope}`);
    assert.equal(report.findings[0].code, "scope-violation");
    assert.equal(report.findings[0].path, badScope);
  }
});

// --- case-folded path comparison -----------------------------------------------

test("paths compare case-insensitively for scope and collisions", () => {
  const repo = createFixtureRepo({
    taskStatuses: ["todo", "todo"],
    taskScopes: [["SRC/A.TS"], ["src/a.ts"]],
  });
  const clean = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["Src/A.ts"] }),
  ]);
  assert.equal(clean.verdict, "merge");
  const collision = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/shared.ts"] }),
    slice({
      taskId: "TASK-0002",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["SRC/SHARED.TS"],
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

// --- run/task binding (taskId is asserted, not trusted) ------------------------

test("a slice naming a task that is not in the run is blocked and grants no authority", () => {
  const repo = createFixtureRepo();
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({
      taskId: "TASK-0099",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
    }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(
    report.findings.some((finding) => finding.code === "evidence-mismatch" && finding.taskId === "TASK-0099"),
    `expected a binding finding in ${JSON.stringify(report.findings)}`,
  );
});

test("an unbound slice cannot borrow another task's scope by declaring it", () => {
  const repo = createFixtureRepo({
    taskStatuses: ["todo", "todo"],
    taskScopes: [["src/a.ts"], ["src/b.ts"]],
  });
  // TASK-0001's record declares src/a.ts only; claiming src/b.ts (TASK-0002's
  // declaration) inflates — a slice may never borrow a sibling's authority.
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/b.ts"], touchedPaths: ["src/b.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.ok(
    report.findings.some((finding) => finding.code === "scope-violation" && finding.path === "src/b.ts"),
    `expected an inflation finding in ${JSON.stringify(report.findings)}`,
  );
});

test("a missing run fails closed at load, never a silent merge", () => {
  const repo = createFixtureRepo();
  assert.throws(
    () => verifyParallelMerge(repo, "no-such-run", [slice()]),
    /does not exist/,
  );
});

// --- declared-evidence boundary ----------------------------------------------

test("an undeclared docs/impl/ write needs scope like any other path", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a.ts"]);
  writeFile(repo, "docs/impl/0001-record.md", "# Record\n\nTASK-0001 done.\n");
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a.ts"], touchedPaths: ["src/a.ts", "docs/impl/0001-record.md"] }),
  ]);
  assert.equal(report.verdict, "merge-review");
  assert.deepEqual(
    report.findings.map((finding) => ({ code: finding.code, path: finding.path })),
    [{ code: "scope-violation", path: "docs/impl/0001-record.md" }],
  );
});

// --- record-scope coverage kinds ----------------------------------------------

test("a record file entry does not cover a supplied directory claim", () => {
  const repo = createFixtureRepo();
  declareTaskScope(repo, 1, ["src/a"]);
  const report = verifyParallelMerge(repo, RUN_ID, [
    slice({ declaredScope: ["src/a/"], touchedPaths: ["src/a/x.ts"] }),
  ]);
  assert.equal(report.verdict, "blocked");
  assert.equal(report.findings[0].code, "scope-violation");
  assert.equal(report.findings[0].path, "src/a/");
});
