"use strict";

// ---------------------------------------------------------------------------
// doc_maintenance migrate plan|apply|recovery (Issues #233, #245, #247)
// ---------------------------------------------------------------------------
//
// The only authorized migration surface. `plan` is fully read-only: it emits
// the shared preflight diagnostic plus the complete migration inventory and
// dry-run report (#245) pinned by a deterministic planHash. `apply` runs the
// journaled engine (#247): gates first (planHash pin, classification,
// resolutions, worktree/state-root boundaries), then staging → validation →
// publish → finalize with the schema manifest stamped LAST, after the
// postflight gates pass. `recovery` inspects, resumes, or rolls back an
// in-flight journal. Nothing reports success on partial state — `applied`
// is only true when the post-apply preflight comes back `current`.

import { SCHEMA_MANIFEST_PATH } from "../../../lib/schema_preflight";
import { buildMigrationPlan } from "./migration_inventory";
import type { MigrationPlanReport } from "./migration_inventory";
import { applyMigration, recoverMigration } from "./migration_apply";
import type {
  ApplyOptions,
  ApplyReport,
  RecoveryOptions,
  RecoveryReport,
} from "./migration_apply";

type MigratePlan = {
  command: "migrate plan";
  readOnly: true;
} & MigrationPlanReport;

// Backwards-compatible shape: the bounded report fields plus the full
// journaled-apply payload.
type MigrateApplyResult = ApplyReport & {
  manifestPath: string;
};

type MigrateRecoveryResult = RecoveryReport;

function migratePlan(cwd: string): MigratePlan {
  return { command: "migrate plan", readOnly: true, ...buildMigrationPlan(cwd) };
}

async function migrateApply(cwd: string, options: ApplyOptions = {}): Promise<MigrateApplyResult> {
  const result = await applyMigration(cwd, options);
  return { ...result, manifestPath: SCHEMA_MANIFEST_PATH };
}

async function migrateRecovery(cwd: string, options: RecoveryOptions = {}): Promise<MigrateRecoveryResult> {
  return recoverMigration(cwd, options);
}

export { migrateApply, migratePlan, migrateRecovery };
export type { MigrateApplyResult, MigratePlan, MigrateRecoveryResult };
export type { ApplyOptions, RecoveryOptions };
