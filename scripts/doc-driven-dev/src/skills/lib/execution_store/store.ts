"use strict";

// ---------------------------------------------------------------------------
// Execution Store v1 — per-run state, CAS, atomicity, handoff (Issue #236)
// ---------------------------------------------------------------------------
//
// Plan / Task / approvals / Checkpoints / Effect Receipts / run state live
// outside Git under `.apm/state/doc-driven-dev/runs/<run-id>/` — the layout
// the shared preflight (#233) already declares current. Git-tracked
// `docs/tasks`-style bookkeeping is not required and never consulted; this
// store is the ONLY writer of execution state, and Markdown remains the
// authority for durable knowledge (nothing durable is stored here).
//
// Consistency model:
//   - per-run single writer: `writer.lock` serializes every mutation;
//   - CAS: run-level `manifest.revision` and per-task `version` — a stale
//     expected value refuses the update instead of losing one;
//   - atomic replace + fsync on every committed file; `*.tmp-*` leftovers
//     are crash evidence, never content;
//   - run id + task id always appear together — there is no global task id.
//
// Handoff model: a run lives in one worktree. Another worktree or machine
// sees nothing by default (fail closed — `run-not-found`), and the only way
// across is an explicit `exportRun`/`importRun` snapshot with per-file and
// payload digest verification, or an explicitly declared shared root
// (`stateRoot` + `allowExternalRoot`).

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { generateArtifactId } from "../artifact_id";
import { isInsideCheckout } from "../document_utils";
import {
  StoreError,
  acquireWriterLock,
  appendLine,
  atomicWriteFile,
  isStoreTmpFile,
  readJsonFile,
  readLockRecord,
} from "./atomic";
import {
  ensureStateRootBoundary,
  initStateRoot,
  resolveStateRoot,
  runDirFor,
} from "./boundary";
import type { ResolvedRoot, StoreRootOptions } from "./boundary";
import {
  CHECKPOINT_RECORD_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  FINAL_RUN_STATUSES,
  RECEIPT_RECORD_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  TASK_RECORD_SCHEMA_VERSION,
  TASK_STATUSES,
  canonicalJson,
  isPlainObject,
  isSha256,
  isValidId,
  validateCheckpoint,
  validateManifest,
  validateReceipt,
  validateTask,
} from "./types";
import type {
  CheckpointRecord,
  ReceiptRecord,
  RunManifest,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "./types";

const STATE_FILE = "manifest.json";
const PLAN_FILE = "plan.md";
const TRACE_FILE = "run_trace.jsonl";
const RUN_DIR = "runs";
const STATE_SUBDIRS = ["tasks", "checkpoints", "receipts"] as const;

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

type StoreOptions = StoreRootOptions & { now?: Clock };

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

type RecoveryInfo = {
  // `*.tmp-*` siblings left by an interrupted write — evidence, never
  // adopted. `recoverRun` removes them explicitly.
  incompleteWrites: string[];
  // A writer.lock still present: a live writer, or a stale one recovery
  // can steal after the pid check.
  writerLock: { pid: number; hostname: string; acquiredAt: string } | null;
};

type RunSnapshot = {
  runId: string;
  status: RunStatus;
  manifest: RunManifest;
  plan: { content: string; digest: string } | null;
  // Computed, not stored: the approval is only valid while it binds the
  // CURRENT plan digest — editing plan.md can never resurrect an old one.
  planApproved: boolean;
  // sha256(plan.md) diverging from manifest.planDigest means a write
  // outside the API — reported so callers can fail closed on drift.
  planDigestDrift: boolean;
  tasks: TaskRecord[];
  checkpoints: CheckpointRecord[];
  receipts: ReceiptRecord[];
  recovery: RecoveryInfo;
};

type DisposalInspection = {
  // `corrupt` when the run could not be loaded — force-disposal reports it.
  status: RunStatus | "corrupt";
  revision: number;
  finalizedAt: string | null;
  planApproved: boolean;
  taskCounts: Record<TaskStatus, number>;
  checkpoints: number;
  receipts: number;
};

// ---------------------------------------------------------------------------
// Path and record plumbing
// ---------------------------------------------------------------------------

function nowOf(options: StoreOptions): string {
  return (options.now ?? systemClock)();
}

function runDirContained(cwd: string, resolved: ResolvedRoot, runId: string): string {
  const runDir = runDirFor(resolved, runId);
  if (!fs.existsSync(runDir)) {
    throw new StoreError("run-not-found", `run ${runId} does not exist under ${resolved.repoRelative ?? resolved.root}`);
  }
  if (!fs.statSync(runDir).isDirectory()) {
    throw new StoreError("corrupt-state", `${runDir} is not a directory`);
  }
  if (resolved.external) {
    // A linked run dir must stay inside the shared root — the same
    // containment rule as inside the checkout, evaluated against the root.
    let real: string;
    try {
      real = fs.realpathSync(runDir);
    } catch {
      throw new StoreError("boundary-escape", `run dir for ${runId} cannot be resolved`);
    }
    const realRoot = fs.realpathSync(resolved.root);
    const root = path.resolve(realRoot);
    const candidate = path.resolve(real);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      throw new StoreError("boundary-escape", `run ${runId} escapes the shared state root through a link`);
    }
    return runDir;
  }
  if (!isInsideCheckout(cwd, runDir)) {
    throw new StoreError("boundary-escape", `run ${runId} resolves outside the checkout through a link`);
  }
  return runDir;
}

function requireMutableManifest(manifest: RunManifest): void {
  if (FINAL_RUN_STATUSES.has(manifest.status)) {
    throw new StoreError(
      "run-finalized",
      `run ${manifest.runId} is ${manifest.status} — finalized runs are read-only`,
      { status: manifest.status, finalizedAt: manifest.finalizedAt },
    );
  }
}

function requireRevision(manifest: RunManifest, expectedRevision: number | undefined): void {
  if (expectedRevision === undefined) return;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new StoreError("invalid-argument", `expectedRevision must be a positive integer, got ${JSON.stringify(expectedRevision)}`);
  }
  if (manifest.revision !== expectedRevision) {
    throw new StoreError(
      "cas-conflict",
      `run ${manifest.runId} revision is ${manifest.revision}, expected ${expectedRevision} — refusing a lost update`,
      { current: manifest.revision, expected: expectedRevision },
    );
  }
}

function readManifest(runDir: string, runId: string): RunManifest {
  const file = path.join(runDir, STATE_FILE);
  if (!fs.existsSync(file)) {
    // The run dir exists but its manifest does not — a createRun that
    // crashed before the commit point, or state this store did not write.
    throw new StoreError(
      "corrupt-state",
      `run ${runId} has no manifest.json — the run is incomplete or foreign`,
      { runId },
    );
  }
  const parsed = readJsonFile(file);
  if (isPlainObject(parsed) && parsed.schemaVersion !== RUN_MANIFEST_SCHEMA_VERSION) {
    throw new StoreError(
      "unsupported-version",
      `run ${runId} manifest schemaVersion is ${JSON.stringify(parsed.schemaVersion)}, expected ${RUN_MANIFEST_SCHEMA_VERSION} — upgrade the toolchain`,
    );
  }
  if (!validateManifest(parsed)) {
    throw new StoreError("corrupt-state", `run ${runId} manifest failed schema validation`, { runId });
  }
  if (parsed.runId !== runId) {
    throw new StoreError(
      "corrupt-state",
      `manifest runId ${parsed.runId} does not match its directory ${runId}`,
    );
  }
  return parsed;
}

function writeManifest(runDir: string, manifest: RunManifest): void {
  atomicWriteFile(path.join(runDir, STATE_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

function recordFileName(kind: "tasks" | "checkpoints" | "receipts", id: string): string {
  return path.join(kind, `${id}.json`);
}

function listRecordFiles(runDir: string, kind: string): string[] {
  const dir = path.join(runDir, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(runDir, kind, entry.name))
    .sort();
}

function readRecord<T>(file: string, validate: (v: unknown) => boolean, kind: string): T {
  const parsed = readJsonFile(file);
  if (!validate(parsed)) {
    throw new StoreError("corrupt-state", `${file} failed ${kind} record validation`, { path: file });
  }
  const record = parsed as T & { runId: string };
  const dirRun = path.basename(path.dirname(path.dirname(file)));
  if (record.runId !== dirRun) {
    throw new StoreError(
      "corrupt-state",
      `${kind} record in ${file} binds run ${record.runId}, expected ${dirRun} — records never cross runs`,
    );
  }
  return parsed as T;
}

function scanIncompleteWrites(dir: string, rel = ""): string[] {
  const found: string[] = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...scanIncompleteWrites(abs, relPath));
    } else if (entry.isFile() && isStoreTmpFile(entry.name)) {
      found.push(relPath);
    }
  }
  return found;
}

function loadSnapshot(cwd: string, resolved: ResolvedRoot, runId: string): RunSnapshot {
  const runDir = runDirContained(cwd, resolved, runId);
  const manifest = readManifest(runDir, runId);
  const planFile = path.join(runDir, PLAN_FILE);
  let plan: RunSnapshot["plan"] = null;
  if (fs.existsSync(planFile)) {
    const content = fs.readFileSync(planFile, "utf8");
    plan = { content, digest: sha256(content) };
  }
  const tasks = listRecordFiles(runDir, "tasks")
    .map((file) => readRecord<TaskRecord>(file, validateTask, "task"));
  const checkpoints = listRecordFiles(runDir, "checkpoints")
    .map((file) => readRecord<CheckpointRecord>(file, validateCheckpoint, "checkpoint"));
  const receipts = listRecordFiles(runDir, "receipts")
    .map((file) => readRecord<ReceiptRecord>(file, validateReceipt, "receipt"));
  const lock = fs.existsSync(path.join(runDir, "writer.lock"))
    ? readLockRecord(path.join(runDir, "writer.lock"))
    : null;
  return {
    runId,
    status: manifest.status,
    manifest,
    plan,
    planApproved: manifest.approval !== null && plan !== null && manifest.approval.planDigest === plan.digest,
    planDigestDrift: manifest.planDigest !== null && (plan === null || plan.digest !== manifest.planDigest),
    tasks,
    checkpoints,
    receipts,
    recovery: {
      incompleteWrites: scanIncompleteWrites(runDir),
      writerLock: lock,
    },
  };
}

// Every mutation runs the same critical section: boundary → run dir → lock
// → manifest → finalized/CAS gates → callback → release.
function mutateRun<T>(
  cwd: string,
  runId: string,
  options: StoreOptions,
  expectedRevision: number | undefined,
  mutate: (ctx: { runDir: string; manifest: RunManifest; snapshot: RunSnapshot }) => T,
): T {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirContained(cwd, resolved, runId);
  const release = acquireWriterLock(runDir);
  try {
    const snapshot = loadSnapshot(cwd, resolved, runId);
    requireMutableManifest(snapshot.manifest);
    requireRevision(snapshot.manifest, expectedRevision);
    return mutate({ runDir, manifest: snapshot.manifest, snapshot });
  } finally {
    release();
  }
}

function bumpRevision(manifest: RunManifest, options: StoreOptions): RunManifest {
  return { ...manifest, revision: manifest.revision + 1, updatedAt: nowOf(options) };
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

type CreateRunInput = {
  runId?: string;
  graphId?: string;
  focus?: unknown;
  // `undefined` detects `git rev-parse HEAD` (null outside a work tree);
  // pass null explicitly to record no base commit.
  baseCommit?: string | null;
  plan?: string;
  tasks?: Array<{
    taskId: string;
    title?: string;
    status?: TaskStatus;
    dependsOn?: string[];
    checks?: string[];
  }>;
};

function detectBaseCommit(cwd: string): string | null {
  // A missing/failed git probe records null — the run is still valid; base
  // commit is context, not a consistency gate.
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function validateTaskInputs(
  inputs: NonNullable<CreateRunInput["tasks"]>,
  existingIds: ReadonlySet<string>,
  batchIds: ReadonlySet<string>,
): void {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!isValidId(input.taskId)) {
      throw new StoreError("invalid-argument", `invalid task id ${JSON.stringify(input.taskId)}`);
    }
    if (seen.has(input.taskId) || existingIds.has(input.taskId)) {
      throw new StoreError("invalid-argument", `duplicate task id ${input.taskId}`);
    }
    seen.add(input.taskId);
    if (input.status !== undefined && !TASK_STATUSES.has(input.status)) {
      throw new StoreError("invalid-argument", `task ${input.taskId} has unknown status ${JSON.stringify(input.status)}`);
    }
    for (const dep of input.dependsOn ?? []) {
      if (typeof dep !== "string" || /[/\\:]/.test(dep)) {
        throw new StoreError(
          "invalid-argument",
          `task ${input.taskId} depends on ${JSON.stringify(dep)} — dependencies are same-run task ids only, never cross-run references`,
        );
      }
      if (dep === input.taskId) {
        throw new StoreError("invalid-argument", `task ${input.taskId} cannot depend on itself`);
      }
      if (!existingIds.has(dep) && !batchIds.has(dep)) {
        throw new StoreError(
          "invalid-argument",
          `task ${input.taskId} depends on ${dep}, which does not exist in run scope — dependencies resolve inside the same run only`,
        );
      }
    }
    if (input.checks !== undefined && !input.checks.every((check) => typeof check === "string")) {
      throw new StoreError("invalid-argument", `task ${input.taskId} checks must be strings`);
    }
  }
}

// The `runs/` container sits between the root boundary probe and the run
// dir — if it exists it must already satisfy containment, and the created
// run dir is re-verified after mkdir (the writeManifest TOCTOU pattern: a
// linked container must not smuggle the run outside its root).
function requireRunsContainer(cwd: string, resolved: ResolvedRoot): string {
  const runsDir = path.join(resolved.root, RUN_DIR);
  if (fs.existsSync(runsDir)) {
    if (!fs.statSync(runsDir).isDirectory()) {
      throw new StoreError("boundary-escape", `${runsDir} is not a directory`);
    }
    if (!resolved.external && !isInsideCheckout(cwd, runsDir)) {
      throw new StoreError("boundary-escape", `${resolved.repoRelative}/runs resolves outside the checkout through a link`);
    }
    if (resolved.external) {
      const real = fs.realpathSync(runsDir);
      const realRoot = fs.realpathSync(resolved.root);
      if (real !== realRoot && !real.startsWith(`${path.resolve(realRoot)}${path.sep}`)) {
        throw new StoreError("boundary-escape", "the runs container escapes the shared state root through a link");
      }
    }
  }
  return runsDir;
}

function verifyRunDirContained(cwd: string, resolved: ResolvedRoot, runDir: string, runId: string): void {
  if (resolved.external) {
    const real = fs.realpathSync(runDir);
    const realRoot = fs.realpathSync(resolved.root);
    if (real !== realRoot && !real.startsWith(`${path.resolve(realRoot)}${path.sep}`)) {
      throw new StoreError("boundary-escape", `run ${runId} resolved outside the shared state root`);
    }
    return;
  }
  if (!isInsideCheckout(cwd, runDir)) {
    throw new StoreError("boundary-escape", `run ${runId} resolved outside the checkout — refusing to write`);
  }
}

function createRun(cwd: string, input: CreateRunInput = {}, options: StoreOptions = {}): RunSnapshot {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runId = input.runId ?? generateArtifactId("RUN");
  const runDir = runDirFor(resolved, runId);
  requireRunsContainer(cwd, resolved);
  if (fs.existsSync(runDir)) {
    throw new StoreError("run-exists", `run ${runId} already exists under ${resolved.repoRelative ?? resolved.root}`, { runId });
  }
  const taskInputs = input.tasks ?? [];
  validateTaskInputs(taskInputs, new Set(), new Set(taskInputs.map((task) => task.taskId)));

  // Commit order: run dir + record files first, manifest LAST — a run
  // without a manifest is never a valid run, so a crash anywhere earlier
  // leaves a detectable incomplete dir, not half a run.
  fs.mkdirSync(path.join(runDir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "checkpoints"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "receipts"), { recursive: true });
  verifyRunDirContained(cwd, resolved, runDir, runId);
  const stamp = nowOf(options);
  for (const task of taskInputs) {
    const record: TaskRecord = {
      schemaVersion: TASK_RECORD_SCHEMA_VERSION,
      runId,
      taskId: task.taskId,
      title: task.title ?? task.taskId,
      status: task.status ?? "todo",
      dependsOn: [...(task.dependsOn ?? [])].sort(),
      checks: [...(task.checks ?? [])].sort(),
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    atomicWriteFile(path.join(runDir, recordFileName("tasks", task.taskId)), `${JSON.stringify(record, null, 2)}\n`);
  }
  let planDigest: string | null = null;
  if (input.plan !== undefined) {
    atomicWriteFile(path.join(runDir, PLAN_FILE), input.plan);
    planDigest = sha256(input.plan);
  }
  const manifest: RunManifest = {
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    runId,
    revision: 1,
    status: "active",
    graphId: input.graphId ?? "doc-driven-dev",
    focus: input.focus ?? null,
    baseCommit: input.baseCommit !== undefined ? input.baseCommit : detectBaseCommit(cwd),
    planDigest,
    approval: null,
    createdAt: stamp,
    updatedAt: stamp,
    finalizedAt: null,
  };
  writeManifest(runDir, manifest);
  return loadSnapshot(cwd, resolved, runId);
}

function loadRun(cwd: string, runId: string, options: StoreOptions = {}): RunSnapshot {
  const resolved = resolveStateRoot(cwd, options);
  return loadSnapshot(cwd, resolved, runId);
}

function listRuns(cwd: string, options: StoreOptions = {}): Array<{ runId: string; status: RunStatus | "corrupt"; revision: number | null }> {
  const resolved = resolveStateRoot(cwd, options);
  const runsDir = path.join(resolved.root, RUN_DIR);
  if (!fs.existsSync(runsDir)) return [];
  const runs: Array<{ runId: string; status: RunStatus | "corrupt"; revision: number | null }> = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    try {
      const manifest = readManifest(path.join(runsDir, entry.name), entry.name);
      runs.push({ runId: manifest.runId, status: manifest.status, revision: manifest.revision });
    } catch {
      runs.push({ runId: entry.name, status: "corrupt", revision: null });
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Plan + approval
// ---------------------------------------------------------------------------

function savePlan(
  cwd: string,
  runId: string,
  content: string,
  options: StoreOptions & { expectedRevision?: number } = {},
): { revision: number; planDigest: string; approvalInvalidated: boolean } {
  return mutateRun(cwd, runId, options, options.expectedRevision, ({ runDir, manifest }) => {
    atomicWriteFile(path.join(runDir, PLAN_FILE), content);
    const planDigest = sha256(content);
    const approvalInvalidated = manifest.approval !== null && manifest.approval.planDigest !== planDigest;
    writeManifest(runDir, bumpRevision({
      ...manifest,
      planDigest,
      // Plan edits invalidate any approval bound to a different digest —
      // an old approval can never be reused after the plan changed.
      approval: approvalInvalidated ? null : manifest.approval,
    }, options));
    return { revision: manifest.revision + 1, planDigest, approvalInvalidated };
  });
}

function approvePlan(
  cwd: string,
  runId: string,
  input: { actor: string },
  options: StoreOptions & { expectedRevision?: number } = {},
): { revision: number; approval: { planDigest: string; actor: string; approvedAt: string } } {
  if (typeof input.actor !== "string" || input.actor.trim() === "") {
    throw new StoreError("invalid-argument", "approvePlan requires a non-empty actor");
  }
  return mutateRun(cwd, runId, options, options.expectedRevision, ({ runDir, manifest, snapshot }) => {
    if (snapshot.plan === null) {
      throw new StoreError("no-plan", `run ${runId} has no plan.md — nothing to approve`);
    }
    const approval = { planDigest: snapshot.plan.digest, actor: input.actor, approvedAt: nowOf(options) };
    writeManifest(runDir, bumpRevision({ ...manifest, approval }, options));
    return { revision: manifest.revision + 1, approval };
  });
}

function updateRun(
  cwd: string,
  runId: string,
  patch: { focus?: unknown },
  options: StoreOptions & { expectedRevision?: number } = {},
): { revision: number } {
  return mutateRun(cwd, runId, options, options.expectedRevision, ({ runDir, manifest }) => {
    const next: RunManifest = { ...manifest };
    if ("focus" in patch) next.focus = patch.focus ?? null;
    writeManifest(runDir, bumpRevision(next, options));
    return { revision: manifest.revision + 1 };
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function updateTask(
  cwd: string,
  runId: string,
  taskId: string,
  patch: { title?: string; status?: TaskStatus; dependsOn?: string[]; checks?: string[] },
  options: StoreOptions & { expectedVersion?: number } = {},
): { task: TaskRecord; created: boolean } {
  if (!isValidId(taskId)) {
    throw new StoreError("invalid-argument", `invalid task id ${JSON.stringify(taskId)}`);
  }
  return mutateRun(cwd, runId, options, undefined, ({ runDir, snapshot }) => {
    const file = path.join(runDir, recordFileName("tasks", taskId));
    const existingIds = new Set(snapshot.tasks.map((task) => task.taskId));
    const stamp = nowOf(options);
    const current = snapshot.tasks.find((task) => task.taskId === taskId);
    if (current === undefined) {
      if (options.expectedVersion !== undefined && options.expectedVersion !== 0) {
        throw new StoreError("task-not-found", `task ${taskId} does not exist in run ${runId}`);
      }
      const [candidate] = [{
        taskId,
        title: patch.title ?? taskId,
        status: patch.status ?? ("todo" as TaskStatus),
        dependsOn: patch.dependsOn ?? [],
        checks: patch.checks ?? [],
      }];
      validateTaskInputs([candidate], existingIds, new Set());
      const record: TaskRecord = {
        schemaVersion: TASK_RECORD_SCHEMA_VERSION,
        runId,
        taskId: candidate.taskId,
        title: candidate.title,
        status: candidate.status,
        dependsOn: [...candidate.dependsOn].sort(),
        checks: [...candidate.checks].sort(),
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
      return { task: record, created: true };
    }
    if (options.expectedVersion === undefined) {
      throw new StoreError(
        "expected-version-required",
        `task ${taskId} exists at version ${current.version} — expectedVersion is required for updates`,
      );
    }
    if (options.expectedVersion !== current.version) {
      throw new StoreError(
        "cas-conflict",
        `task ${taskId} is at version ${current.version}, expected ${options.expectedVersion} — refusing a lost update`,
        { current: current.version, expected: options.expectedVersion },
      );
    }
    const candidate = {
      taskId,
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      dependsOn: patch.dependsOn ?? current.dependsOn,
      checks: patch.checks ?? current.checks,
    };
    // Deps validate against the sibling set MINUS the task itself — a task
    // that depended on nothing else still cannot self-loop through a patch.
    const others = new Set(existingIds);
    others.delete(taskId);
    validateTaskInputs([candidate], others, new Set());
    const record: TaskRecord = {
      ...current,
      title: candidate.title,
      status: candidate.status,
      dependsOn: [...candidate.dependsOn].sort(),
      checks: [...candidate.checks].sort(),
      version: current.version + 1,
      updatedAt: stamp,
    };
    atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return { task: record, created: false };
  });
}

// ---------------------------------------------------------------------------
// Checkpoints + receipts — append-once, idempotent on identical re-record
// ---------------------------------------------------------------------------

// Semantic equality ignores `at`: re-recording the same logical record with
// a fresh stamp is the idempotent retry, not new content.
function sameRecordContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (value: Record<string, unknown>): Record<string, unknown> => {
    const copy = { ...value };
    delete copy.at;
    return copy;
  };
  return canonicalJson(strip(a)) === canonicalJson(strip(b));
}

function recordCheckpoint(
  cwd: string,
  runId: string,
  input: {
    checkpointId: string;
    nodeId?: string | null;
    edgeId?: string | null;
    taskId?: string | null;
    data?: unknown;
    at?: string;
  },
  options: StoreOptions = {},
): { recorded: boolean; duplicate: boolean; checkpoint: CheckpointRecord } {
  if (!isValidId(input.checkpointId)) {
    throw new StoreError("invalid-argument", `invalid checkpoint id ${JSON.stringify(input.checkpointId)}`);
  }
  return mutateRun(cwd, runId, options, undefined, ({ runDir, snapshot }) => {
    const file = path.join(runDir, recordFileName("checkpoints", input.checkpointId));
    const record: CheckpointRecord = {
      schemaVersion: CHECKPOINT_RECORD_SCHEMA_VERSION,
      runId,
      checkpointId: input.checkpointId,
      nodeId: input.nodeId ?? null,
      edgeId: input.edgeId ?? null,
      taskId: input.taskId ?? null,
      at: input.at ?? nowOf(options),
      data: input.data ?? null,
    };
    if (input.taskId != null && !snapshot.tasks.some((task) => task.taskId === input.taskId)) {
      throw new StoreError("task-not-found", `checkpoint ${input.checkpointId} references task ${input.taskId}, which is not in run ${runId}`);
    }
    if (fs.existsSync(file)) {
      const existing = readRecord<CheckpointRecord>(file, validateCheckpoint, "checkpoint");
      if (sameRecordContent(existing as unknown as Record<string, unknown>, record as unknown as Record<string, unknown>)) {
        return { recorded: false, duplicate: true, checkpoint: existing };
      }
      throw new StoreError(
        "record-conflict",
        `checkpoint ${input.checkpointId} already exists with different content — records are append-once`,
        { checkpointId: input.checkpointId },
      );
    }
    atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return { recorded: true, duplicate: false, checkpoint: record };
  });
}

function recordReceipt(
  cwd: string,
  runId: string,
  input: {
    receiptId: string;
    effect: string;
    taskId?: string | null;
    idempotencyKey?: string | null;
    actor?: string | null;
    status?: ReceiptRecord["status"];
    input?: unknown;
    output?: unknown;
    at?: string;
  },
  options: StoreOptions = {},
): { recorded: boolean; duplicate: boolean; receipt: ReceiptRecord } {
  if (!isValidId(input.receiptId)) {
    throw new StoreError("invalid-argument", `invalid receipt id ${JSON.stringify(input.receiptId)}`);
  }
  if (typeof input.effect !== "string" || input.effect.trim() === "") {
    throw new StoreError("invalid-argument", "recordReceipt requires a non-empty effect");
  }
  return mutateRun(cwd, runId, options, undefined, ({ runDir, snapshot }) => {
    const file = path.join(runDir, recordFileName("receipts", input.receiptId));
    const record: ReceiptRecord = {
      schemaVersion: RECEIPT_RECORD_SCHEMA_VERSION,
      runId,
      receiptId: input.receiptId,
      effect: input.effect,
      taskId: input.taskId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      actor: input.actor ?? null,
      status: input.status ?? "success",
      at: input.at ?? nowOf(options),
      input: input.input ?? null,
      output: input.output ?? null,
    };
    if (input.taskId != null && !snapshot.tasks.some((task) => task.taskId === input.taskId)) {
      throw new StoreError("task-not-found", `receipt ${input.receiptId} references task ${input.taskId}, which is not in run ${runId}`);
    }
    if (fs.existsSync(file)) {
      const existing = readRecord<ReceiptRecord>(file, validateReceipt, "receipt");
      if (sameRecordContent(existing as unknown as Record<string, unknown>, record as unknown as Record<string, unknown>)) {
        return { recorded: false, duplicate: true, receipt: existing };
      }
      throw new StoreError(
        "record-conflict",
        `receipt ${input.receiptId} already exists with different content — records are append-once`,
        { receiptId: input.receiptId },
      );
    }
    atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return { recorded: true, duplicate: false, receipt: record };
  });
}

// ---------------------------------------------------------------------------
// Trace — append-only, never authoritative
// ---------------------------------------------------------------------------

function appendTrace(cwd: string, runId: string, event: Record<string, unknown>, options: StoreOptions = {}): void {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirContained(cwd, resolved, runId);
  // A valid manifest is the minimum run shape — trace lines never outlive
  // the run they diagnose.
  readManifest(runDir, runId);
  const release = acquireWriterLock(runDir);
  try {
    appendLine(path.join(runDir, TRACE_FILE), JSON.stringify({ at: nowOf(options), ...event }));
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Finalize + dispose
// ---------------------------------------------------------------------------

function finalizeRun(
  cwd: string,
  runId: string,
  input: { status: "completed" | "aborted" },
  options: StoreOptions & { expectedRevision?: number } = {},
): { revision: number; finalized: boolean; status: RunStatus } {
  if (!FINAL_RUN_STATUSES.has(input.status)) {
    throw new StoreError("invalid-argument", `finalize status must be completed|aborted, got ${JSON.stringify(input.status)}`);
  }
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirContained(cwd, resolved, runId);
  const release = acquireWriterLock(runDir);
  try {
    const manifest = readManifest(runDir, runId);
    if (manifest.status === input.status) {
      // Re-finalizing to the same terminal state is a safe no-op.
      return { revision: manifest.revision, finalized: false, status: manifest.status };
    }
    if (FINAL_RUN_STATUSES.has(manifest.status)) {
      throw new StoreError(
        "run-finalized",
        `run ${runId} is already ${manifest.status} — it cannot become ${input.status}`,
        { status: manifest.status },
      );
    }
    requireRevision(manifest, options.expectedRevision);
    writeManifest(runDir, bumpRevision({
      ...manifest,
      status: input.status,
      finalizedAt: nowOf(options),
    }, options));
    return { revision: manifest.revision + 1, finalized: true, status: input.status };
  } finally {
    release();
  }
}

function disposalInspection(snapshot: RunSnapshot): DisposalInspection {
  const taskCounts = Object.fromEntries([...TASK_STATUSES].map((status) => [status, 0])) as Record<TaskStatus, number>;
  for (const task of snapshot.tasks) taskCounts[task.status] += 1;
  return {
    status: snapshot.manifest.status,
    revision: snapshot.manifest.revision,
    finalizedAt: snapshot.manifest.finalizedAt,
    planApproved: snapshot.planApproved,
    taskCounts,
    checkpoints: snapshot.checkpoints.length,
    receipts: snapshot.receipts.length,
  };
}

function disposeRun(
  cwd: string,
  runId: string,
  options: StoreOptions & { expectedRevision?: number; force?: boolean; reason?: string } = {},
): { disposed: boolean; forced: boolean; reason: string | null; inspection: DisposalInspection } {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirContained(cwd, resolved, runId);
  const release = acquireWriterLock(runDir);
  try {
    let snapshot: RunSnapshot;
    try {
      snapshot = loadSnapshot(cwd, resolved, runId);
    } catch (error: unknown) {
      // A corrupt run cannot produce an inspection — force is still the
      // authorized way out, reported with what could be determined.
      if (error instanceof StoreError && error.code === "corrupt-state" && options.force === true) {
        fs.rmSync(runDir, { recursive: true, force: true });
        return {
          disposed: true,
          forced: true,
          reason: options.reason ?? null,
          inspection: {
            status: "corrupt",
            revision: -1,
            finalizedAt: null,
            planApproved: false,
            taskCounts: Object.fromEntries([...TASK_STATUSES].map((status) => [status, 0])) as Record<TaskStatus, number>,
            checkpoints: 0,
            receipts: 0,
          },
        };
      }
      throw error;
    }
    requireRevision(snapshot.manifest, options.expectedRevision);
    const inspection = disposalInspection(snapshot);
    if (!FINAL_RUN_STATUSES.has(snapshot.manifest.status) && options.force !== true) {
      // The pre-delete inspection is the refusal payload: final state,
      // unresolved work, receipts, and approval state are examined before
      // an active run may be discarded.
      throw new StoreError(
        "run-active",
        `run ${runId} is ${snapshot.manifest.status} — inspect the disposal report, then pass force with a reason to discard it`,
        { inspection },
      );
    }
    if (!FINAL_RUN_STATUSES.has(snapshot.manifest.status) && (options.reason === undefined || options.reason.trim() === "")) {
      throw new StoreError(
        "invalid-argument",
        "disposing an active run requires an explicit reason — the handoff/loss review must be recorded",
      );
    }
    fs.rmSync(runDir, { recursive: true, force: true });
    return {
      disposed: true,
      forced: !FINAL_RUN_STATUSES.has(snapshot.manifest.status),
      reason: options.reason ?? null,
      inspection,
    };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

function recoverRun(
  cwd: string,
  runId: string,
  options: StoreOptions = {},
): { runId: string; removedTmpFiles: string[]; corruptFiles: string[]; recovered: boolean } {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirContained(cwd, resolved, runId);
  const release = acquireWriterLock(runDir);
  try {
    const removed: string[] = [];
    const leftovers = scanIncompleteWrites(runDir);
    for (const rel of leftovers) {
      fs.rmSync(path.join(runDir, rel), { force: true });
      removed.push(rel);
    }
    const corruptFiles: string[] = [];
    try {
      loadSnapshot(cwd, resolved, runId);
    } catch (error: unknown) {
      if (error instanceof StoreError && error.code === "corrupt-state") {
        corruptFiles.push(String((error.detail as { path?: string } | undefined)?.path ?? STATE_FILE));
      } else {
        throw error;
      }
    }
    return { runId, removedTmpFiles: removed.sort(), corruptFiles, recovered: corruptFiles.length === 0 };
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Explicit transfer: export / import
// ---------------------------------------------------------------------------

const EXPORT_KIND = "execution-run-export";

type RunExport = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  kind: typeof EXPORT_KIND;
  runId: string;
  exportedAt: string;
  source: { baseCommit: string | null; status: RunStatus; revision: number };
  files: Array<{ path: string; sha256: string; content: string }>;
  payloadDigest: string;
};

// Only these run-internal paths may travel in an export — the declared
// layout, and nothing else. Path validation happens again at import.
function exportableRelPaths(): RegExp {
  return /^(manifest\.json|plan\.md|run_trace\.jsonl|tasks\/[^/]+\.json|checkpoints\/[^/]+\.json|receipts\/[^/]+\.json)$/;
}

function collectExportFiles(runDir: string): Array<{ path: string; sha256: string; content: string }> {
  const files: Array<{ path: string; sha256: string; content: string }> = [];
  const visit = (dir: string, rel = ""): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(abs, relPath);
      } else if (entry.isFile() && !isStoreTmpFile(entry.name) && entry.name !== "writer.lock" && exportableRelPaths().test(relPath)) {
        const content = fs.readFileSync(abs, "utf8");
        files.push({ path: relPath, sha256: sha256(content), content });
      }
    }
  };
  visit(runDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function exportRun(
  cwd: string,
  runId: string,
  options: StoreOptions & { out?: string } = {},
): RunExport {
  const resolved = resolveStateRoot(cwd, options);
  const runDir = runDirContained(cwd, resolved, runId);
  // A snapshot read validates every committed record before it ships.
  const snapshot = loadSnapshot(cwd, resolved, runId);
  const files = collectExportFiles(runDir);
  const payloadDigest = sha256(canonicalJson({
    runId,
    files: files.map(({ path: rel, sha256: digest }) => ({ path: rel, sha256: digest })),
  }));
  const document: RunExport = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    kind: EXPORT_KIND,
    runId,
    exportedAt: nowOf(options),
    source: { baseCommit: snapshot.manifest.baseCommit, status: snapshot.manifest.status, revision: snapshot.manifest.revision },
    files,
    payloadDigest,
  };
  if (options.out !== undefined) {
    atomicWriteFile(path.resolve(cwd, options.out), `${JSON.stringify(document, null, 2)}\n`);
  }
  return document;
}

function validateExportDocument(document: unknown): asserts document is RunExport {
  if (!isPlainObject(document) || document.kind !== EXPORT_KIND) {
    throw new StoreError("import-integrity", "not an execution-run export document");
  }
  if (document.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new StoreError("unsupported-version", `export schemaVersion is ${JSON.stringify(document.schemaVersion)}, expected ${EXPORT_SCHEMA_VERSION}`);
  }
  if (!isValidId(document.runId)) {
    throw new StoreError("import-integrity", `export carries invalid run id ${JSON.stringify(document.runId)}`);
  }
  if (!Array.isArray(document.files) || !isSha256(document.payloadDigest)) {
    throw new StoreError("import-integrity", "export is missing files[] or payloadDigest");
  }
  const digest = sha256(canonicalJson({
    runId: document.runId,
    files: (document.files as Array<{ path?: unknown; sha256?: unknown }>).map((file) => ({ path: file.path, sha256: file.sha256 })),
  }));
  if (digest !== document.payloadDigest) {
    throw new StoreError("import-integrity", "export payloadDigest mismatch — the snapshot was altered after export");
  }
  const seen = new Set<string>();
  for (const file of document.files as Array<{ path?: unknown; sha256?: unknown; content?: unknown }>) {
    if (typeof file.path !== "string" || !exportableRelPaths().test(file.path)) {
      throw new StoreError("import-integrity", `export carries disallowed path ${JSON.stringify(file.path)}`);
    }
    if (typeof file.sha256 !== "string" || typeof file.content !== "string" || sha256(file.content) !== file.sha256) {
      throw new StoreError("import-integrity", `file ${file.path} failed its content digest`);
    }
    if (seen.has(file.path)) {
      throw new StoreError("import-integrity", `duplicate path ${file.path} in export`);
    }
    seen.add(file.path);
  }
}

// Snapshot-integrity: the export's internal consistency — manifest valid,
// records bound to this run, file names matching record ids, and the plan
// digest chain (approval → manifest → plan.md bytes) intact.
function verifyExportConsistency(document: RunExport): void {
  const byPath = new Map(document.files.map((file) => [file.path, file.content]));
  const manifestRaw = byPath.get(STATE_FILE);
  if (manifestRaw === undefined) {
    throw new StoreError("import-integrity", "export has no manifest.json");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new StoreError("import-integrity", "export manifest is not valid JSON");
  }
  if (!validateManifest(manifest) || manifest.runId !== document.runId) {
    throw new StoreError("import-integrity", "export manifest failed validation or binds a different run id");
  }
  const plan = byPath.get(PLAN_FILE);
  if (manifest.planDigest !== null) {
    if (plan === undefined || sha256(plan) !== manifest.planDigest) {
      throw new StoreError("import-integrity", "manifest planDigest does not match the exported plan.md");
    }
  }
  if (manifest.approval !== null && manifest.approval.planDigest !== manifest.planDigest) {
    throw new StoreError("import-integrity", "exported approval does not bind the exported plan digest");
  }
  for (const file of document.files) {
    if (file.path === STATE_FILE || file.path === PLAN_FILE || file.path === TRACE_FILE) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      throw new StoreError("import-integrity", `record ${file.path} is not valid JSON`);
    }
    const [kind, name] = file.path.split("/");
    const id = name.replace(/\.json$/, "");
    const record = parsed as Record<string, unknown>;
    if (record.runId !== document.runId) {
      throw new StoreError("import-integrity", `record ${file.path} binds run ${JSON.stringify(record.runId)}, expected ${document.runId}`);
    }
    const idField = kind === "tasks" ? "taskId" : kind === "checkpoints" ? "checkpointId" : "receiptId";
    if (record[idField] !== id) {
      throw new StoreError("import-integrity", `record ${file.path} carries ${idField} ${JSON.stringify(record[idField])}, expected ${id}`);
    }
    const valid = kind === "tasks" ? validateTask(parsed) : kind === "checkpoints" ? validateCheckpoint(parsed) : validateReceipt(parsed);
    if (!valid) {
      throw new StoreError("import-integrity", `record ${file.path} failed ${kind} schema validation`);
    }
  }
}

function importRun(
  cwd: string,
  source: { file?: string; document?: unknown },
  options: StoreOptions & { onConflict?: "refuse" | "replace"; force?: boolean; expectedRevision?: number } = {},
): { imported: boolean; runId: string; replaced: boolean; files: number } {
  if (source.file === undefined && source.document === undefined) {
    throw new StoreError("invalid-argument", "importRun requires a file path or an export document");
  }
  let document: unknown = source.document;
  if (document === undefined) {
    const file = path.resolve(cwd, source.file!);
    try {
      document = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error: unknown) {
      throw new StoreError("import-integrity", `cannot parse export file ${source.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  validateExportDocument(document);
  verifyExportConsistency(document);
  const doc = document as RunExport;
  const runId = doc.runId;
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const runDir = runDirFor(resolved, runId);
  const conflict = options.onConflict ?? "refuse";
  const existed = fs.existsSync(runDir);
  if (existed) {
    if (conflict !== "replace") {
      throw new StoreError(
        "import-conflict",
        `run ${runId} already exists — pass onConflict: "replace" to overwrite it explicitly`,
        { runId },
      );
    }
    const existing = loadSnapshot(cwd, resolved, runId);
    requireRevision(existing.manifest, options.expectedRevision);
    if (!FINAL_RUN_STATUSES.has(existing.manifest.status) && options.force !== true) {
      throw new StoreError(
        "run-active",
        `existing run ${runId} is ${existing.manifest.status} — replacing an active run requires explicit force`,
        { inspection: disposalInspection(existing) },
      );
    }
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  requireRunsContainer(cwd, resolved);
  fs.mkdirSync(runDir, { recursive: true });
  verifyRunDirContained(cwd, resolved, runDir, runId);
  // Same commit order as createRun: every imported file first, manifest
  // last — a crash mid-import leaves an incomplete dir, never a false run.
  const ordered = [...doc.files].sort((a, b) => (a.path === STATE_FILE ? 1 : 0) - (b.path === STATE_FILE ? 1 : 0));
  for (const file of ordered) {
    const target = path.join(runDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWriteFile(target, file.content);
  }
  // Post-write verification: the run must load clean under this toolchain.
  loadSnapshot(cwd, resolved, runId);
  return { imported: true, runId, replaced: existed, files: doc.files.length };
}

export {
  RUN_DIR,
  STATE_FILE,
  PLAN_FILE,
  TRACE_FILE,
  STATE_SUBDIRS,
  approvePlan,
  appendTrace,
  createRun,
  disposeRun,
  disposalInspection,
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
};

export type {
  CreateRunInput,
  DisposalInspection,
  RunExport,
  RunSnapshot,
  StoreOptions,
};
export type { StoreRootOptions } from "./boundary";
export { StoreError } from "./atomic";
export { isValidId } from "./types";
export type {
  CheckpointRecord,
  ReceiptRecord,
  RunManifest,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "./types";
