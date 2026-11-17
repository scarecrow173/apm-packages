import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  StoreError,
  approvePlan,
  appendTrace,
  createRun,
  disposeRun,
  exportRun,
  finalizeRun,
  importRun,
  initStateRoot,
  listRuns,
  loadRun,
  recordCheckpoint,
  recordReceipt,
  recoverRun,
  savePlan,
  updateRun,
  updateTask,
} from "../src/skills/lib/execution_store";
import type { RunExport } from "../src/skills/lib/execution_store";

// Execution Store v1 (Issue #236): per-run state under
// `.apm/state/doc-driven-dev/runs/<run-id>/`, CAS on run revision and task
// version, per-run single writer, atomic replace + fsync, crash recovery,
// and explicit export/import handoff. Tests exercise the library and the
// built CLI end to end, deterministically, with no external services.

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
const cli = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "execution_store.js");

const FIXED_NOW = "2026-01-02T03:04:05.000Z";
const fixedClock = () => FIXED_NOW;

function tempDir(prefix = "exec-store-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function git(repo: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "" };
}

// A real work tree with `.apm/state/` coverage committed — the standard
// consumer shape.
function gitRepo(): string {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return repo;
}

// No git metadata — the file-scan fallback path.
function fileRepo(): string {
  const repo = tempDir();
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  return repo;
}

function expectStoreError(fn: () => unknown, code: string): StoreError {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(error instanceof StoreError, `expected StoreError ${code}, got ${String(error)}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected StoreError ${code}, got success`);
}

function runNode(script: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runCliAsync(args: string[], cwd: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Boundary: gitignore coverage, tracked state, containment, external roots
// ---------------------------------------------------------------------------

test("boundary: writes refuse when .apm/state coverage is unconfigured (git work tree)", () => {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"]);
  const error = expectStoreError(() => createRun(repo, { runId: "RUN-B1" }), "boundary-gitignore");
  assert.match(error.message, /\.gitignore|ignore/);
  assert.equal(fs.existsSync(path.join(repo, ".apm")), false, "no state may be created on refusal");
});

test("boundary: writes refuse when .apm/state coverage is unconfigured (no git)", () => {
  const repo = tempDir();
  expectStoreError(() => createRun(repo, { runId: "RUN-B2" }), "boundary-gitignore");
  assert.equal(fs.existsSync(path.join(repo, ".apm")), false);
});

test("boundary: init writes ignore coverage and is idempotent", () => {
  const repo = tempDir();
  const first = initStateRoot(repo);
  assert.equal(first.initialized, true);
  assert.equal(first.entry, "/.apm/state/");
  assert.match(fs.readFileSync(path.join(repo, ".gitignore"), "utf8"), /\/\.apm\/state\//);
  const second = initStateRoot(repo);
  assert.equal(second.alreadyCovered, true);
  createRun(repo, { runId: "RUN-B3" });
});

test("boundary: tracked execution state refuses before writing", () => {
  const repo = gitRepo();
  writeFile(repo, ".apm/state/tracked.txt", "x\n");
  git(repo, ["add", "-f", ".apm/state/tracked.txt"]);
  const error = expectStoreError(() => createRun(repo, { runId: "RUN-B4" }), "boundary-tracked");
  assert.match(String((error.detail as { tracked?: string[] }).tracked?.[0] ?? ""), /tracked\.txt/);
});

test("boundary: a linked .apm ancestor escaping the checkout refuses before writing", (t) => {
  const repo = gitRepo();
  const outside = tempDir("exec-store-outside-");
  try {
    fs.symlinkSync(outside, path.join(repo, ".apm"), "junction");
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  expectStoreError(() => createRun(repo, { runId: "RUN-B5" }), "boundary-escape");
  assert.equal(fs.existsSync(path.join(outside, "state")), false, "no state may be created outside the checkout");
});

test("boundary: a linked runs/ container escaping the checkout refuses", (t) => {
  const repo = gitRepo();
  const outside = tempDir("exec-store-outside-");
  fs.mkdirSync(path.join(repo, ".apm/state/doc-driven-dev"), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(repo, ".apm/state/doc-driven-dev/runs"), "junction");
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  expectStoreError(() => createRun(repo, { runId: "RUN-B6" }), "boundary-escape");
  assert.equal(fs.readdirSync(outside).length, 0);
});

test("boundary: run ids are validated before becoming a path", () => {
  const repo = fileRepo();
  for (const bad of ["../escape", "a/b", "a\\b", "..", "", "CON"]) {
    expectStoreError(() => createRun(repo, { runId: bad }), "invalid-argument");
  }
  assert.equal(fs.existsSync(path.join(repo, ".apm")), false);
});

test("boundary: an external shared root requires explicit authorization", () => {
  const repo = fileRepo();
  const shared = tempDir("exec-store-shared-");
  expectStoreError(
    () => createRun(repo, { runId: "RUN-B7" }, { stateRoot: shared }),
    "external-root-not-authorized",
  );
  assert.equal(fs.readdirSync(shared).length, 0);
  // Explicitly authorized, the shared root works — the declared mechanism
  // for multi-worktree state.
  createRun(repo, { runId: "RUN-B7" }, { stateRoot: shared, allowExternalRoot: true });
  assert.equal(fs.existsSync(path.join(shared, "runs", "RUN-B7", "manifest.json")), true);
});

test("boundary: a custom inside-checkout root still needs ignore coverage", () => {
  const repo = tempDir();
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  expectStoreError(
    () => createRun(repo, { runId: "RUN-B8" }, { stateRoot: "custom/state" }),
    "boundary-gitignore",
  );
  writeFile(repo, ".gitignore", "/.apm/state/\n/custom/\n");
  createRun(repo, { runId: "RUN-B8" }, { stateRoot: "custom/state" });
});

test("boundary: git check-ignore honors a parent repo's rules for a subdir cwd", () => {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  writeFile(repo, ".gitignore", "state/\n");
  const subdir = path.join(repo, "nested", "worktree");
  fs.mkdirSync(subdir, { recursive: true });
  // `state/` matches the `.apm/state` directory anywhere — the parent
  // repo's coverage applies even though cwd is not the worktree root.
  createRun(subdir, { runId: "RUN-B9" });
});

test("boundary: manual .gitignore evaluation honors negation order", () => {
  const repo = tempDir();
  // `.apm/*` ignores the children, `!.apm/state/` re-includes state/ — so
  // deeper state files are NOT covered and the write must refuse.
  writeFile(repo, ".gitignore", ".apm/*\n!.apm/state/\n");
  expectStoreError(() => createRun(repo, { runId: "RUN-B10" }), "boundary-gitignore");
  // Covering the subtree itself flips the decision.
  writeFile(repo, ".gitignore", ".apm/*\n!.gitkeep\n.apm/state/\n");
  createRun(repo, { runId: "RUN-B10" });
});

// ---------------------------------------------------------------------------
// Run lifecycle and record schemas
// ---------------------------------------------------------------------------

test("run: createRun writes the declared layout and loads it back", () => {
  const repo = gitRepo();
  const snapshot = createRun(repo, {
    runId: "RUN-C1",
    graphId: "doc-driven-dev",
    focus: { plan: "demo" },
    plan: "# Plan\n",
  }, { now: fixedClock });
  assert.equal(snapshot.manifest.schemaVersion, 1);
  assert.equal(snapshot.manifest.revision, 1);
  assert.equal(snapshot.manifest.status, "active");
  assert.equal(snapshot.manifest.graphId, "doc-driven-dev");
  assert.deepEqual(snapshot.manifest.focus, { plan: "demo" });
  assert.equal(snapshot.manifest.createdAt, FIXED_NOW);
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(snapshot.manifest.baseCommit, head);
  const runDir = path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-C1");
  assert.equal(fs.existsSync(path.join(runDir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "plan.md")), true);
  assert.equal(fs.existsSync(path.join(runDir, "tasks")), true);
  assert.equal(snapshot.plan?.digest, crypto.createHash("sha256").update("# Plan\n").digest("hex"));
  // Nothing tracked: execution state never touches Git.
  assert.equal(git(repo, ["status", "--porcelain"]).stdout.trim(), "");
  const reloaded = loadRun(repo, "RUN-C1");
  assert.deepEqual(reloaded.manifest, snapshot.manifest);
});

test("run: createRun refuses a duplicate run id", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-C2" });
  expectStoreError(() => createRun(repo, { runId: "RUN-C2" }), "run-exists");
});

test("run: loadRun of an absent run fails closed", () => {
  const repo = fileRepo();
  expectStoreError(() => loadRun(repo, "RUN-MISSING"), "run-not-found");
});

test("run: updateRun patches focus with run-level CAS", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-C3" }, { now: fixedClock });
  const updated = updateRun(repo, "RUN-C3", { focus: { taskId: "T-1" } }, { now: fixedClock, expectedRevision: 1 });
  assert.equal(updated.revision, 2);
  assert.deepEqual(loadRun(repo, "RUN-C3").manifest.focus, { taskId: "T-1" });
  expectStoreError(
    () => updateRun(repo, "RUN-C3", { focus: null }, { expectedRevision: 1 }),
    "cas-conflict",
  );
});

// ---------------------------------------------------------------------------
// Plan approval: digest + actor + time, never reusable after a plan change
// ---------------------------------------------------------------------------

test("approval: bound to plan digest and actor; a plan edit invalidates it", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-P1", plan: "# v1\n" }, { now: fixedClock });
  const approved = approvePlan(repo, "RUN-P1", { actor: "reviewer" }, { now: fixedClock, expectedRevision: 1 });
  assert.equal(approved.approval.actor, "reviewer");
  assert.equal(approved.approval.approvedAt, FIXED_NOW);
  assert.equal(loadRun(repo, "RUN-P1").planApproved, true);

  const saved = savePlan(repo, "RUN-P1", "# v2\n", { now: fixedClock });
  assert.equal(saved.approvalInvalidated, true);
  const after = loadRun(repo, "RUN-P1");
  assert.equal(after.manifest.approval, null);
  assert.equal(after.planApproved, false);
});

test("approval: a stale approval cannot be reused even after out-of-band plan edits", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-P2", plan: "# v1\n" }, { now: fixedClock });
  approvePlan(repo, "RUN-P2", { actor: "reviewer" }, { now: fixedClock });
  // Hand-edit the file — the API is not the only writer. The computed
  // validity check still refuses to honor the old approval.
  fs.writeFileSync(path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-P2/plan.md"), "# tampered\n", "utf8");
  const snapshot = loadRun(repo, "RUN-P2");
  assert.equal(snapshot.planApproved, false);
  assert.equal(snapshot.planDigestDrift, true);
});

test("approval: approvePlan requires an existing plan and an actor", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-P3" });
  expectStoreError(() => approvePlan(repo, "RUN-P3", { actor: "a" }), "no-plan");
  createRun(repo, { runId: "RUN-P4", plan: "# p\n" });
  expectStoreError(() => approvePlan(repo, "RUN-P4", { actor: " " }), "invalid-argument");
});

// ---------------------------------------------------------------------------
// Tasks: per-task CAS and same-run dependency scope
// ---------------------------------------------------------------------------

test("task: create + update with per-task version CAS", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-T1" }, { now: fixedClock });
  const created = updateTask(repo, "RUN-T1", "TASK-1", { title: "one" }, { now: fixedClock });
  assert.equal(created.created, true);
  assert.equal(created.task.version, 1);
  // Updates require the current version.
  expectStoreError(
    () => updateTask(repo, "RUN-T1", "TASK-1", { status: "in-progress" }),
    "expected-version-required",
  );
  expectStoreError(
    () => updateTask(repo, "RUN-T1", "TASK-1", { status: "in-progress" }, { expectedVersion: 99 }),
    "cas-conflict",
  );
  const updated = updateTask(repo, "RUN-T1", "TASK-1", { status: "in-progress" }, { now: fixedClock, expectedVersion: 1 });
  assert.equal(updated.task.version, 2);
  assert.equal(updated.task.status, "in-progress");
});

test("task: dependencies resolve inside the same run only", () => {
  const repo = fileRepo();
  createRun(repo, {
    runId: "RUN-T2",
    tasks: [{ taskId: "TASK-A" }],
  });
  expectStoreError(
    () => updateTask(repo, "RUN-T2", "TASK-B", { dependsOn: ["TASK-MISSING"] }),
    "invalid-argument",
  );
  expectStoreError(
    () => updateTask(repo, "RUN-T2", "TASK-B", { dependsOn: ["OTHER-RUN:TASK-A"] }),
    "invalid-argument",
  );
  expectStoreError(
    () => updateTask(repo, "RUN-T2", "TASK-B", { dependsOn: ["TASK-B"] }),
    "invalid-argument",
  );
  const ok = updateTask(repo, "RUN-T2", "TASK-B", { dependsOn: ["TASK-A"] });
  assert.deepEqual(ok.task.dependsOn, ["TASK-A"]);
  // dependsOn entries are run-scoped ids — never a global task reference.
  assert.equal(fs.existsSync(path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-T2/tasks/TASK-B.json")), true);
});

test("task: runs in different worktrees never collide", () => {
  const repoA = fileRepo();
  const repoB = fileRepo();
  createRun(repoA, { runId: "RUN-X", tasks: [{ taskId: "TASK-1" }] });
  createRun(repoB, { runId: "RUN-X", tasks: [{ taskId: "TASK-9" }] });
  const a = loadRun(repoA, "RUN-X");
  const b = loadRun(repoB, "RUN-X");
  assert.deepEqual(a.tasks.map((task) => task.taskId), ["TASK-1"]);
  assert.deepEqual(b.tasks.map((task) => task.taskId), ["TASK-9"]);
  // And repo B cannot see repo A's other runs at all — fail closed.
  createRun(repoA, { runId: "RUN-ONLY-A" });
  expectStoreError(() => loadRun(repoB, "RUN-ONLY-A"), "run-not-found");
});

// ---------------------------------------------------------------------------
// Checkpoints and receipts: append-once, idempotent on identical content
// ---------------------------------------------------------------------------

test("records: checkpoint and receipt files land per run with idempotent re-record", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-R1", tasks: [{ taskId: "TASK-1" }] }, { now: fixedClock });
  const cp = recordCheckpoint(repo, "RUN-R1", { checkpointId: "CP-1", nodeId: "implementation", taskId: "TASK-1" }, { now: fixedClock });
  assert.equal(cp.recorded, true);
  const again = recordCheckpoint(repo, "RUN-R1", { checkpointId: "CP-1", nodeId: "implementation", taskId: "TASK-1" });
  assert.equal(again.duplicate, true);
  expectStoreError(
    () => recordCheckpoint(repo, "RUN-R1", { checkpointId: "CP-1", nodeId: "other" }),
    "record-conflict",
  );

  const rc = recordReceipt(repo, "RUN-R1", { receiptId: "RC-1", effect: "apply-patch", taskId: "TASK-1", idempotencyKey: "k1" }, { now: fixedClock });
  assert.equal(rc.recorded, true);
  assert.equal(recordReceipt(repo, "RUN-R1", { receiptId: "RC-1", effect: "apply-patch", taskId: "TASK-1", idempotencyKey: "k1" }).duplicate, true);
  expectStoreError(
    () => recordReceipt(repo, "RUN-R1", { receiptId: "RC-1", effect: "different-effect" }),
    "record-conflict",
  );
  // Record task references stay inside the run.
  expectStoreError(
    () => recordReceipt(repo, "RUN-R1", { receiptId: "RC-2", effect: "x", taskId: "TASK-ELSEWHERE" }),
    "task-not-found",
  );
  const snapshot = loadRun(repo, "RUN-R1");
  assert.deepEqual(snapshot.checkpoints.map((c) => c.checkpointId), ["CP-1"]);
  assert.deepEqual(snapshot.receipts.map((r) => r.receiptId), ["RC-1"]);
});

test("records: trace appends JSONL and stays non-authoritative", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-R2" }, { now: fixedClock });
  appendTrace(repo, "RUN-R2", { kind: "route-selected", next: "planning" }, { now: fixedClock });
  appendTrace(repo, "RUN-R2", { kind: "dispatch", task: "TASK-1" }, { now: fixedClock });
  const lines = fs.readFileSync(path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-R2/run_trace.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).kind, "route-selected");
  assert.equal(JSON.parse(lines[0]).at, FIXED_NOW);
});

// ---------------------------------------------------------------------------
// Finalize / dispose
// ---------------------------------------------------------------------------

test("finalize: terminal status freezes the run; re-finalize is idempotent", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-F1" }, { now: fixedClock });
  const done = finalizeRun(repo, "RUN-F1", { status: "completed" }, { now: fixedClock, expectedRevision: 1 });
  assert.equal(done.finalized, true);
  assert.equal(done.revision, 2);
  assert.equal(loadRun(repo, "RUN-F1").manifest.finalizedAt, FIXED_NOW);
  // Every mutation now refuses.
  expectStoreError(() => savePlan(repo, "RUN-F1", "# x\n"), "run-finalized");
  expectStoreError(() => updateTask(repo, "RUN-F1", "TASK-1", {}), "run-finalized");
  expectStoreError(() => recordReceipt(repo, "RUN-F1", { receiptId: "RC-9", effect: "e" }), "run-finalized");
  const again = finalizeRun(repo, "RUN-F1", { status: "completed" });
  assert.equal(again.finalized, false);
  expectStoreError(() => finalizeRun(repo, "RUN-F1", { status: "aborted" }), "run-finalized");
});

test("dispose: active runs inspect before delete; force requires a reason", () => {
  const repo = fileRepo();
  createRun(repo, {
    runId: "RUN-D1",
    plan: "# p\n",
    tasks: [{ taskId: "TASK-1" }, { taskId: "TASK-2", status: "in-progress" }],
  }, { now: fixedClock });
  approvePlan(repo, "RUN-D1", { actor: "a" }, { now: fixedClock });
  recordCheckpoint(repo, "RUN-D1", { checkpointId: "CP-1" }, { now: fixedClock });
  const error = expectStoreError(() => disposeRun(repo, "RUN-D1"), "run-active");
  const inspection = (error.detail as { inspection: { taskCounts: Record<string, number>; planApproved: boolean; checkpoints: number } }).inspection;
  assert.equal(inspection.taskCounts["in-progress"], 1);
  assert.equal(inspection.taskCounts.todo, 1);
  assert.equal(inspection.planApproved, true);
  assert.equal(inspection.checkpoints, 1);
  // The run survives the refusal untouched.
  assert.equal(loadRun(repo, "RUN-D1").manifest.revision, 2);
  expectStoreError(() => disposeRun(repo, "RUN-D1", { force: true }), "invalid-argument");
  const disposed = disposeRun(repo, "RUN-D1", { force: true, reason: "superseded by RUN-D2" });
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.forced, true);
  assert.equal(disposed.reason, "superseded by RUN-D2");
  expectStoreError(() => loadRun(repo, "RUN-D1"), "run-not-found");
});

test("dispose: a finalized run disposes without force and reports the inspection", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-D2" });
  finalizeRun(repo, "RUN-D2", { status: "aborted" });
  const disposed = disposeRun(repo, "RUN-D2");
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.forced, false);
  assert.equal(disposed.inspection.status, "aborted");
});

test("runs: listRuns summarizes every run directory", () => {
  const repo = fileRepo();
  assert.deepEqual(listRuns(repo), []);
  createRun(repo, { runId: "RUN-L2" });
  createRun(repo, { runId: "RUN-L1" });
  finalizeRun(repo, "RUN-L1", { status: "completed" });
  assert.deepEqual(listRuns(repo), [
    { runId: "RUN-L1", status: "completed", revision: 2 },
    { runId: "RUN-L2", status: "active", revision: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Single writer + CAS under real concurrency
// ---------------------------------------------------------------------------

test("writer lock: a held lock refuses a second writer; a dead pid is recovered", async () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-W1" });
  const runDir = path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-W1");
  // A live foreign pid holds the lock → every mutation is refused.
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 5000)"], { windowsHide: true });
  try {
    assert.ok(holder.pid !== undefined);
    writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-W1/writer.lock", `${JSON.stringify({ pid: holder.pid, hostname: os.hostname(), acquiredAt: FIXED_NOW })}\n`);
    expectStoreError(() => updateTask(repo, "RUN-W1", "TASK-1", {}), "writer-conflict");
  } finally {
    holder.kill("SIGKILL");
  }
  // The holder is dead — the next writer steals the stale lock and proceeds.
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-W1/writer.lock", `${JSON.stringify({ pid: holder.pid, hostname: os.hostname(), acquiredAt: FIXED_NOW })}\n`);
  await sleep(50);
  const updated = updateTask(repo, "RUN-W1", "TASK-1", {});
  assert.equal(updated.created, true);
  assert.equal(fs.existsSync(path.join(runDir, "writer.lock")), false, "lock released after the op");
});

test("writer lock: a lock from another hostname fails closed", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-W2" });
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-W2/writer.lock", `${JSON.stringify({ pid: 1, hostname: "other-host.example", acquiredAt: FIXED_NOW })}\n`);
  // pid liveness across machines is unverifiable — refuse, never assume.
  expectStoreError(() => updateTask(repo, "RUN-W2", "TASK-1", {}), "writer-conflict");
});

test("concurrency: distinct-task creates from parallel writers all land", async () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-W3" });
  const attempt = async (taskId: string) => {
    writeFile(repo, `task-${taskId}.json`, JSON.stringify({ taskId, title: taskId }));
    for (let i = 0; i < 40; i += 1) {
      const result = await runCliAsync(["put-task", "RUN-W3", "--file", `task-${taskId}.json`, "--cwd", repo], repo);
      if (result.status === 0) return true;
      const payload = JSON.parse(result.stdout);
      if (payload.error !== "writer-conflict") throw new Error(`unexpected error: ${result.stdout}`);
      await sleep(15 + Math.random() * 30);
    }
    return false;
  };
  const outcomes = await Promise.all(["TASK-1", "TASK-2", "TASK-3", "TASK-4"].map(attempt));
  assert.deepEqual(outcomes, [true, true, true, true]);
  const tasks = loadRun(repo, "RUN-W3").tasks;
  assert.deepEqual(tasks.map((task) => task.taskId), ["TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
  // Every surviving file is fully written and schema-valid — the lock +
  // atomic replace serialized all four writers.
  for (const task of tasks) assert.equal(task.version, 1);
});

test("concurrency: CAS refuses a lost update between racing writers", async () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-W4" });
  writeFile(repo, "task.json", JSON.stringify({ taskId: "TASK-1", title: "raced" }));
  const created = await runCliAsync(["put-task", "RUN-W4", "--file", "task.json", "--cwd", repo], repo);
  assert.equal(created.status, 0, created.stdout);
  // Two writers race the same task at expectedVersion 1 — the lock
  // serializes them, the second sees version 2 and its CAS refuses.
  writeFile(repo, "task.json", JSON.stringify({ taskId: "TASK-1", title: "raced", status: "done" }));
  const race = () => runCliAsync(["put-task", "RUN-W4", "--file", "task.json", "--expect-version", "1", "--cwd", repo], repo);
  const [first, second] = await Promise.all([race(), race()]);
  const results = [first, second].map((r) => (r.status === 0 ? "ok" : (JSON.parse(r.stdout).error as string)));
  assert.equal(results.filter((r) => r === "ok").length, 1, `expected exactly one winner: ${results}`);
  const loser = results.find((r) => r !== "ok")!;
  assert.ok(["cas-conflict", "writer-conflict"].includes(loser), `unexpected loser error ${loser}`);
  assert.equal(loadRun(repo, "RUN-W4").tasks[0].version, 2, "exactly one update was applied");
});

// ---------------------------------------------------------------------------
// Crash recovery: partial writes are evidence, never adopted
// ---------------------------------------------------------------------------

test("recovery: leftover tmp files are detected and removed by recoverRun", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-CR1" });
  const runDir = path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-CR1");
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-CR1/manifest.json.tmp-123-1", "{");
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-CR1/tasks/TASK-9.json.tmp-123-2", "{}");
  const snapshot = loadRun(repo, "RUN-CR1");
  assert.deepEqual(snapshot.recovery.incompleteWrites, ["manifest.json.tmp-123-1", "tasks/TASK-9.json.tmp-123-2"]);
  const recovered = recoverRun(repo, "RUN-CR1");
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.removedTmpFiles, ["manifest.json.tmp-123-1", "tasks/TASK-9.json.tmp-123-2"]);
  assert.equal(fs.readdirSync(runDir).filter((f) => f.includes(".tmp-")).length, 0);
  // Committed content survives recovery untouched.
  assert.equal(loadRun(repo, "RUN-CR1").manifest.revision, 1);
});

test("recovery: partial JSON is never adopted — it reports corrupt-state", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-CR2", tasks: [{ taskId: "TASK-1" }] });
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-CR2/tasks/TASK-1.json", '{"taskId":"TASK-1","runId":');
  expectStoreError(() => loadRun(repo, "RUN-CR2"), "corrupt-state");
  const recovered = recoverRun(repo, "RUN-CR2");
  assert.equal(recovered.recovered, false);
  assert.deepEqual(recovered.corruptFiles.length, 1);
  // And the corrupt file is left for inspection, not silently deleted.
  assert.equal(fs.existsSync(path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-CR2/tasks/TASK-1.json")), true);
});

test("recovery: a run dir without a manifest is incomplete, not a valid run", () => {
  const repo = fileRepo();
  const runDir = path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-CR3");
  fs.mkdirSync(runDir, { recursive: true });
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-CR3/tasks/TASK-1.json", "{}");
  expectStoreError(() => loadRun(repo, "RUN-CR3"), "corrupt-state");
  // Force-dispose is the authorized way to discard it.
  const disposed = disposeRun(repo, "RUN-CR3", { force: true, reason: "abandoned incomplete run" });
  assert.equal(disposed.inspection.status, "corrupt");
});

test("recovery: a manifest at a newer schemaVersion fails closed", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-CR4" });
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, ".apm/state/doc-driven-dev/runs/RUN-CR4/manifest.json"), "utf8"));
  manifest.schemaVersion = 99;
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-CR4/manifest.json", JSON.stringify(manifest));
  expectStoreError(() => loadRun(repo, "RUN-CR4"), "unsupported-version");
});

// ---------------------------------------------------------------------------
// Explicit transfer: export / import / shared root
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function populatedSource(): { repoA: string; repoB: string } {
  const repoA = gitRepo();
  createRun(repoA, { runId: "RUN-X1", plan: "# plan\n", focus: { p: 1 }, tasks: [{ taskId: "TASK-1" }] }, { now: fixedClock });
  approvePlan(repoA, "RUN-X1", { actor: "reviewer" }, { now: fixedClock });
  recordCheckpoint(repoA, "RUN-X1", { checkpointId: "CP-1", nodeId: "n" }, { now: fixedClock });
  recordReceipt(repoA, "RUN-X1", { receiptId: "RC-1", effect: "e", taskId: "TASK-1" }, { now: fixedClock });
  appendTrace(repoA, "RUN-X1", { kind: "route-selected" }, { now: fixedClock });
  const repoB = gitRepo();
  return { repoA, repoB };
}

test("transfer: export -> import moves a run between worktrees with digests verified", () => {
  const { repoA, repoB } = populatedSource();
  const document = exportRun(repoA, "RUN-X1", { now: fixedClock });
  assert.equal(document.kind, "execution-run-export");
  assert.equal(document.runId, "RUN-X1");
  assert.ok(document.files.some((f) => f.path === "manifest.json"));
  assert.ok(document.files.some((f) => f.path === "plan.md"));
  assert.ok(document.files.some((f) => f.path === "run_trace.jsonl"));
  // The writer lock and tmp leftovers never travel.
  assert.ok(document.files.every((f) => f.path !== "writer.lock" && !f.path.includes(".tmp-")));
  const result = importRun(repoB, { document });
  assert.equal(result.imported, true);
  const snapshot = loadRun(repoB, "RUN-X1");
  assert.equal(snapshot.planApproved, true, "the approval digest chain survives the transfer");
  assert.deepEqual(snapshot.tasks.map((task) => task.taskId), ["TASK-1"]);
  assert.equal(snapshot.checkpoints.length, 1);
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(fs.existsSync(path.join(repoB, ".apm/state/doc-driven-dev/runs/RUN-X1/run_trace.jsonl")), true);
});

test("transfer: import conflicts refuse by default; replace needs a finalized target", () => {
  const { repoA, repoB } = populatedSource();
  const document = exportRun(repoA, "RUN-X1");
  importRun(repoB, { document });
  expectStoreError(() => importRun(repoB, { document }), "import-conflict");
  // The imported run is still active — replacing it takes explicit force.
  expectStoreError(
    () => importRun(repoB, { document }, { onConflict: "replace" }),
    "run-active",
  );
  finalizeRun(repoB, "RUN-X1", { status: "aborted" });
  const replaced = importRun(repoB, { document }, { onConflict: "replace" });
  assert.equal(replaced.replaced, true);
  // The replaced snapshot is the exported one — status back to active.
  assert.equal(loadRun(repoB, "RUN-X1").manifest.status, "active");
});

test("transfer: a tampered export fails integrity before any write", () => {
  const { repoA, repoB } = populatedSource();
  const document = exportRun(repoA, "RUN-X1");
  const fileCount = () => fs.existsSync(path.join(repoB, ".apm/state")) ? fs.readdirSync(path.join(repoB, ".apm/state/doc-driven-dev/runs")).length : 0;
  const tampered: RunExport = JSON.parse(JSON.stringify(document));
  tampered.files.find((f) => f.path === "plan.md")!.content = "# forged\n";
  expectStoreError(() => importRun(repoB, { document: tampered }), "import-integrity");
  assert.equal(fileCount(), 0);
  // Re-hash the file but keep the wrong payloadDigest — the envelope catches it.
  const rehashed: RunExport = JSON.parse(JSON.stringify(document));
  const plan = rehashed.files.find((f) => f.path === "plan.md")!;
  plan.content = "# forged\n";
  plan.sha256 = sha256(plan.content);
  expectStoreError(() => importRun(repoB, { document: rehashed }), "import-integrity");
  // And a path outside the declared layout is rejected outright.
  const escaped: RunExport = JSON.parse(JSON.stringify(document));
  escaped.files.push({ path: "../evil.json", sha256: sha256("{}"), content: "{}" });
  escaped.payloadDigest = "x".repeat(64);
  expectStoreError(() => importRun(repoB, { document: escaped }), "import-integrity");
  assert.equal(fileCount(), 0);
});

test("transfer: manifest/record consistency is verified beyond file digests", () => {
  const { repoA, repoB } = populatedSource();
  const document = exportRun(repoA, "RUN-X1");
  // Forge a coherent-envelope export whose task binds a different run id.
  const forged: RunExport = JSON.parse(JSON.stringify(document));
  const task = forged.files.find((f) => f.path === "tasks/TASK-1.json")!;
  const parsed = JSON.parse(task.content);
  parsed.runId = "RUN-OTHER";
  task.content = JSON.stringify(parsed, null, 2);
  task.sha256 = sha256(task.content);
  forged.payloadDigest = sha256(JSON.stringify({
    runId: forged.runId,
    files: forged.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
  }));
  expectStoreError(() => importRun(repoB, { document: forged }), "import-integrity");
});

test("transfer: a declared shared root serves several worktrees", () => {
  const repoA = fileRepo();
  const repoB = fileRepo();
  const shared = tempDir("exec-store-shared-");
  const options = { stateRoot: shared, allowExternalRoot: true };
  createRun(repoA, { runId: "RUN-SH1", tasks: [{ taskId: "TASK-1" }] }, options);
  // The same run is visible from the other worktree through the declared
  // shared root — the only non-local mechanism.
  const fromB = loadRun(repoB, "RUN-SH1", options);
  assert.equal(fromB.manifest.runId, "RUN-SH1");
  updateTask(repoB, "RUN-SH1", "TASK-1", { status: "done" }, { ...options, expectedVersion: 1 });
  assert.equal(loadRun(repoA, "RUN-SH1", options).tasks[0].status, "done");
});

// ---------------------------------------------------------------------------
// Built CLI end to end
// ---------------------------------------------------------------------------

test("cli: init -> create -> plan/approve -> task -> receipt -> finalize -> export/import lifecycle", () => {
  const repoA = gitRepo();
  const repoB = gitRepo();
  const ok = (args: string[]) => {
    const result = runNode(cli, args, repoA);
    assert.equal(result.status, 0, `cli ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const created = ok(["create", "RUN-CLI1", "--cwd", repoA]);
  assert.equal(created.run.runId, "RUN-CLI1");
  writeFile(repoA, "plan.md", "# Plan v1\n");
  ok(["save-plan", "RUN-CLI1", "--file", "plan.md", "--cwd", repoA, "--expect-revision", "1"]);
  const approved = ok(["approve-plan", "RUN-CLI1", "--actor", "human", "--cwd", repoA]);
  assert.equal(approved.approval.actor, "human");
  writeFile(repoA, "task.json", JSON.stringify({ taskId: "TASK-1", title: "t", status: "todo" }));
  ok(["put-task", "RUN-CLI1", "--file", "task.json", "--cwd", repoA]);
  writeFile(repoA, "receipt.json", JSON.stringify({ receiptId: "RC-1", effect: "run-tests", taskId: "TASK-1", status: "success" }));
  ok(["record-receipt", "RUN-CLI1", "--file", "receipt.json", "--cwd", repoA]);
  const shown = ok(["show", "RUN-CLI1", "--cwd", repoA]);
  assert.equal(shown.run.planApproved, true);
  ok(["finalize", "RUN-CLI1", "--status", "completed", "--cwd", repoA]);
  const exportPath = path.join(tempDir("exec-store-export-"), "run.export.json");
  const exported = ok(["export", "RUN-CLI1", "--out", exportPath, "--cwd", repoA]);
  assert.equal(exported.exported, true);
  const imported = runNode(cli, ["import", "--file", exportPath, "--cwd", repoB], repoB);
  assert.equal(imported.status, 0, imported.stdout);
  assert.equal(JSON.parse(imported.stdout).imported, true);
  // The completed run cannot be disposed as active in repo B either.
  const disposed = runNode(cli, ["dispose", "RUN-CLI1", "--cwd", repoB], repoB);
  assert.equal(disposed.status, 0, disposed.stdout);
  assert.equal(JSON.parse(disposed.stdout).disposed, true);
});

test("cli: errors are machine-readable with the StoreError code", () => {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"]);
  const result = runNode(cli, ["create", "RUN-E1", "--cwd", repo], repo);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, "boundary-gitignore");
  const missing = runNode(cli, ["show", "RUN-NOPE", "--cwd", repo], repo);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error, "run-not-found");
});

test("cli: a non-current repository is refused by the schema preflight gate", () => {
  const repo = tempDir();
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  writeFile(repo, "docs/tasks/0001-task.md", "---\nid: TASK-0001\ntype: task\nstatus: todo\ntitle: T\n---\n# T\n");
  writeFile(repo, "docs/.doc-driven-dev/schema.json", `${JSON.stringify({ schemaVersion: 1, documentRegistry: 3, knowledgeRelations: 1, verificationDesign: 1, evidenceRecord: 1, graphDefinition: 3 })}\n`);
  const result = runNode(cli, ["list", "--cwd", repo], repo);
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "schema-preflight-blocked");
  assert.equal(payload.preflight.status, "migration-required");
});

test("cli: runs/<run-id>/ state passes the shared preflight as current layout", () => {
  const repo = fileRepo();
  createRun(repo, { runId: "RUN-G1", tasks: [{ taskId: "TASK-1" }] });
  recordCheckpoint(repo, "RUN-G1", { checkpointId: "CP-1" });
  const plan = runNode(
    path.join(skillRoot, "doc-maintenance", "scripts", "doc_maintenance.js"),
    ["migrate", "plan", "--cwd", repo],
    repo,
  );
  assert.equal(plan.status, 0, plan.stdout);
  const payload = JSON.parse(plan.stdout);
  assert.equal(payload.preflight.status, "uninitialized");
  assert.equal(
    payload.preflight.issues.filter((i: { reason: string }) => i.reason === "legacy-execution-state").length,
    0,
    "store output must not look like foreign execution state",
  );
});
