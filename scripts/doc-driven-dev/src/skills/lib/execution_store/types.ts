"use strict";

// ---------------------------------------------------------------------------
// Execution Store v1 — record schemas and field validation (Issue #236)
// ---------------------------------------------------------------------------
//
// Record shapes for the Git-external per-run store. Everything here is a
// plain JSON object so a snapshot is fully serializable; validation is
// hand-rolled (the same style as schema_preflight.ts) so every rejection is
// an explicit fail-closed branch, never a parser fallback.
//
// References are always (runId, taskId): a bare task id is never a global
// reference. A task's `dependsOn` lists sibling task ids inside the SAME run
// — cross-run dependency syntax (`:`/`/`/`\` in an entry) is rejected at the
// write boundary, not discovered later.

import { EXECUTION_RUN_SCHEMA_VERSION } from "../schema_preflight";

const RUN_MANIFEST_SCHEMA_VERSION = EXECUTION_RUN_SCHEMA_VERSION;
const TASK_RECORD_SCHEMA_VERSION = 1;
const CHECKPOINT_RECORD_SCHEMA_VERSION = 1;
const RECEIPT_RECORD_SCHEMA_VERSION = 1;
const EXPORT_SCHEMA_VERSION = 1;

type RunStatus = "active" | "completed" | "aborted";
const RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["active", "completed", "aborted"]);
const FINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "aborted"]);

// Same vocabulary as the v2 task documents — the Dynamic Task Graph
// projection (#237) consumes these statuses unchanged.
type TaskStatus = "todo" | "in-progress" | "blocked" | "done" | "wont-do";
const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "todo",
  "in-progress",
  "blocked",
  "done",
  "wont-do",
]);

type ReceiptStatus = "success" | "failure" | "waived";
const RECEIPT_STATUSES: ReadonlySet<ReceiptStatus> = new Set(["success", "failure", "waived"]);

type PlanApproval = {
  planDigest: string;
  actor: string;
  approvedAt: string;
};

// Run manifest — the single run-level CAS object. `revision` bumps on every
// manifest write; callers pin `expectedRevision` to refuse lost updates.
type RunManifest = {
  schemaVersion: typeof RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  revision: number;
  status: RunStatus;
  graphId: string;
  focus: unknown;
  baseCommit: string | null;
  planDigest: string | null;
  approval: PlanApproval | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
};

// Task record — per-task CAS object. `version` bumps on every write.
type TaskRecord = {
  schemaVersion: typeof TASK_RECORD_SCHEMA_VERSION;
  runId: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  checks: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

// Checkpoint — an append-once record of a completed execution step (#238
// fills in the routing payload). Identical re-records are a no-op;
// same-id different-content is a conflict.
type CheckpointRecord = {
  schemaVersion: typeof CHECKPOINT_RECORD_SCHEMA_VERSION;
  runId: string;
  checkpointId: string;
  nodeId: string | null;
  edgeId: string | null;
  taskId: string | null;
  at: string;
  data: unknown;
};

// Effect Receipt — proves an effect ran; deliberately distinct from an
// Evidence Record (the check *outcome* store, #240). Same append-once
// semantics as checkpoints.
type ReceiptRecord = {
  schemaVersion: typeof RECEIPT_RECORD_SCHEMA_VERSION;
  runId: string;
  receiptId: string;
  effect: string;
  taskId: string | null;
  idempotencyKey: string | null;
  actor: string | null;
  status: ReceiptStatus;
  at: string;
  input: unknown;
  output: unknown;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Filesystem-safe ids, portable across Windows/macOS/Linux: no separators,
// no leading dot, bounded length. `.`/`..` alone are impossible under it,
// and dots may appear only singly between non-dot characters — NTFS strips
// a trailing dot and folds `a..b`, so those spellings would alias distinct
// ids onto one on-disk name.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

function isValidId(value: unknown): value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return false;
  if (value.endsWith(".") || value.includes("..")) return false;
  const stem = value.split(".")[0].toLowerCase();
  return !WINDOWS_RESERVED_NAMES.has(stem);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function optionalString(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === "string";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateApproval(value: unknown): value is PlanApproval {
  return isPlainObject(value)
    && isSha256(value.planDigest)
    && typeof value.actor === "string" && value.actor.length > 0
    && isIsoTimestamp(value.approvedAt);
}

function validateManifest(value: unknown): value is RunManifest {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === RUN_MANIFEST_SCHEMA_VERSION
    && isValidId(value.runId)
    && Number.isInteger(value.revision) && (value.revision as number) >= 1
    && RUN_STATUSES.has(value.status as RunStatus)
    && typeof value.graphId === "string" && value.graphId.length > 0
    && (value.baseCommit === null || typeof value.baseCommit === "string")
    && (value.planDigest === null || isSha256(value.planDigest))
    && (value.approval === null || validateApproval(value.approval))
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt)
    && (value.finalizedAt === null || isIsoTimestamp(value.finalizedAt));
}

function validateTask(value: unknown): value is TaskRecord {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === TASK_RECORD_SCHEMA_VERSION
    && isValidId(value.runId)
    && isValidId(value.taskId)
    && typeof value.title === "string"
    && TASK_STATUSES.has(value.status as TaskStatus)
    && stringArray(value.dependsOn)
    && stringArray(value.checks)
    && Number.isInteger(value.version) && (value.version as number) >= 1
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt);
}

function validateCheckpoint(value: unknown): value is CheckpointRecord {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === CHECKPOINT_RECORD_SCHEMA_VERSION
    && isValidId(value.runId)
    && isValidId(value.checkpointId)
    && optionalString(value.nodeId)
    && optionalString(value.edgeId)
    && optionalString(value.taskId)
    && isIsoTimestamp(value.at);
}

function validateReceipt(value: unknown): value is ReceiptRecord {
  if (!isPlainObject(value)) return false;
  return value.schemaVersion === RECEIPT_RECORD_SCHEMA_VERSION
    && isValidId(value.runId)
    && isValidId(value.receiptId)
    && typeof value.effect === "string" && value.effect.length > 0
    && optionalString(value.taskId)
    && optionalString(value.idempotencyKey)
    && optionalString(value.actor)
    && RECEIPT_STATUSES.has(value.status as ReceiptStatus)
    && isIsoTimestamp(value.at);
}

// Canonical (key-sorted) JSON for content equality and digests — the same
// record always serializes identically regardless of field insertion order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export {
  CHECKPOINT_RECORD_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  FINAL_RUN_STATUSES,
  RECEIPT_RECORD_SCHEMA_VERSION,
  RECEIPT_STATUSES,
  RUN_MANIFEST_SCHEMA_VERSION,
  RUN_STATUSES,
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
};

export type {
  CheckpointRecord,
  PlanApproval,
  ReceiptRecord,
  ReceiptStatus,
  RunManifest,
  RunStatus,
  TaskRecord,
  TaskStatus,
};
