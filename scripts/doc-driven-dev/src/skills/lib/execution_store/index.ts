"use strict";

// Execution Store v1 (Issue #236) — public surface. See store.ts for the
// contract notes; boundary.ts for the write-boundary rules; atomic.ts for
// the write/lock primitives; types.ts for record schemas.

export {
  PLAN_FILE,
  RUN_DIR,
  STATE_FILE,
  STATE_SUBDIRS,
  TRACE_FILE,
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
} from "./store";
export type {
  CreateRunInput,
  DisposalInspection,
  RunExport,
  RunSnapshot,
  StoreOptions,
  StoreRootOptions,
} from "./store";
export { StoreError } from "./atomic";
export { resolveStateRoot } from "./boundary";
export type { ResolvedRoot } from "./boundary";
export {
  RUN_MANIFEST_SCHEMA_VERSION,
  TASK_STATUSES,
  isValidId,
} from "./types";
export type {
  CheckpointRecord,
  PlanApproval,
  ReceiptRecord,
  ReceiptStatus,
  RunManifest,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "./types";
