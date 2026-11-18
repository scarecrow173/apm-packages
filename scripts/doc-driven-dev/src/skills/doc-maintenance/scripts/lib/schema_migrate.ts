"use strict";

// ---------------------------------------------------------------------------
// doc_maintenance migrate plan|apply|recovery (Issues #233, #245)
// ---------------------------------------------------------------------------
//
// The only authorized migration surface. `plan` is fully read-only: it emits
// the shared preflight diagnostic plus the complete migration inventory and
// dry-run report (#245) pinned by a deterministic planHash. `apply`
// performs exactly one bounded write — installing or repairing the schema
// manifest — and only when the repository content is already consistent
// with the declared versions; it re-runs the preflight afterward and
// refuses to report success unless the result is `current`. `recovery`
// reports journal state without mutating it; journal-driven resume/rollback
// machinery is #247.

import fs from "node:fs";
import path from "node:path";

import {
  evaluateSchemaPreflight,
  journalPresent,
  DOC_DRIVEN_DEV_DIR,
  MIGRATION_JOURNAL_PATH,
  SCHEMA_MANIFEST_PATH,
  schemaManifestText,
  statusSummary,
} from "../../../lib/schema_preflight";
import { isInsideCheckout } from "../../../lib/document_utils";
import { buildMigrationPlan } from "./migration_inventory";
import type { MigrationPlanReport } from "./migration_inventory";
import type {
  PreflightIssue,
  SchemaPreflightReport,
} from "../../../lib/schema_preflight";

type MigratePlan = {
  command: "migrate plan";
  readOnly: true;
} & MigrationPlanReport;

type MigrateApplyResult = {
  command: "migrate apply";
  applied: boolean;
  manifestPath: string;
  reason: string;
  blockers: PreflightIssue[];
  planHash: string;
  preflight: SchemaPreflightReport;
  ok: boolean;
};

type MigrateRecoveryResult = {
  command: "migrate recovery";
  status: "no-migration-in-progress" | "migration-incomplete";
  recovered: boolean;
  journalPath: string | null;
  note: string;
  preflight: SchemaPreflightReport;
  ok: boolean;
};

function migratePlan(cwd: string): MigratePlan {
  return { command: "migrate plan", readOnly: true, ...buildMigrationPlan(cwd) };
}

// Returns null once the manifest is in place, else the refusal reason. The
// boundary is verified BEFORE anything is created: `mkdirSync(recursive)` on
// a path that resolves through a link (e.g. a junctioned `docs/`) would
// already have created state outside the checkout by the time a post-write
// check could see it. Probing the nearest existing ancestor up front fails
// closed — a link must exist to be traversed, so once every existing
// ancestor stays inside, nothing below it can escape; the post-mkdir check
// then covers anything that changed in between.
function writeManifest(cwd: string): string | null {
  const abs = path.resolve(cwd, SCHEMA_MANIFEST_PATH);
  const dir = path.dirname(abs);
  const escaped = `${DOC_DRIVEN_DEV_DIR} resolves outside the checkout — refusing to write the manifest`;
  let probe = dir;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return `cannot verify ${DOC_DRIVEN_DEV_DIR} stays inside the checkout`;
    probe = parent;
  }
  if (!isInsideCheckout(cwd, probe)) return escaped;
  fs.mkdirSync(dir, { recursive: true });
  if (!isInsideCheckout(cwd, dir)) return escaped;
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, schemaManifestText(), "utf8");
  fs.renameSync(tmp, abs);
  return null;
}

function migrateApply(cwd: string, expect?: string): MigrateApplyResult {
  const report = buildMigrationPlan(cwd);
  const before = report.preflight;
  const planHash = report.plan.planHash;
  const refuse = (reason: string, blockers: PreflightIssue[] = []): MigrateApplyResult => ({
    command: "migrate apply",
    applied: false,
    manifestPath: SCHEMA_MANIFEST_PATH,
    reason,
    blockers,
    planHash,
    preflight: before,
    ok: false,
  });

  if (expect !== undefined && expect !== planHash) {
    return refuse(`plan hash mismatch: expected ${expect}, scanned ${planHash} — rerun migrate plan and re-pin`, []);
  }
  // The plan's own verdict is the authority: this bounded apply exists only
  // to install or repair the manifest on content the plan classified as
  // already consistent. Anything else — a migration-classified repository,
  // unresolved decisions, unverifiable state — refuses through this one
  // gate and is never stamped `current` over legacy content.
  if (!report.plan.applyEligible) {
    const classification = report.plan.classification;
    const reason =
      report.inventory.foreignState.some((entry) => entry.kind === "escape")
        ? "the repository cannot be fully inventoried — managed content outside the checkout is reachable through links; remove them and replan"
        : before.status === "unsupported-version"
          ? "manifest declares a newer schema generation — upgrade the toolchain instead of rewriting by hand"
          : classification === "recovery"
            ? "a migration journal or in-progress marker is present — run migrate recovery first"
            : classification === "bootstrap"
              ? "empty repository — this is a bootstrap target: scaffold_docs.js seeds the v3 tree, there is nothing to migrate"
              : classification === "blocked"
                ? "the repository state cannot be verified — resolve the preflight issues and scope escapes, then replan"
                : "legacy artifacts or unsafe state require the full migration (#245 planned the inventory; the journaled apply/resume machinery is #247); this apply only installs the manifest on already-consistent content";
    return refuse(reason, report.plan.blockers);
  }
  if (before.status === "current") {
    return { ...refuse("already-current"), ok: true };
  }

  const writeRefusal = writeManifest(cwd);
  if (writeRefusal !== null) {
    return refuse(writeRefusal);
  }
  const after = evaluateSchemaPreflight(cwd);
  return {
    command: "migrate apply",
    applied: after.status === "current",
    manifestPath: SCHEMA_MANIFEST_PATH,
    reason: after.status === "current"
      ? "manifest installed; post-apply preflight is current"
      : `manifest installed but post-apply preflight is ${after.status} — ${statusSummary(after)}`,
    blockers: [],
    planHash,
    preflight: after,
    ok: after.status === "current",
  };
}

function migrateRecovery(cwd: string): MigrateRecoveryResult {
  const preflight = evaluateSchemaPreflight(cwd);
  const journal = journalPresent(cwd);
  const inProgress = journal || preflight.status === "migration-incomplete";
  if (!inProgress) {
    return {
      command: "migrate recovery",
      status: "no-migration-in-progress",
      recovered: false,
      journalPath: null,
      note: "no migration journal or in-progress marker found",
      preflight,
      ok: true,
    };
  }
  return {
    command: "migrate recovery",
    status: "migration-incomplete",
    recovered: false,
    journalPath: journal ? MIGRATION_JOURNAL_PATH : null,
    note: "a migration journal or in-progress marker is present; journal-driven resume/rollback lands in #247 — state is preserved untouched",
    preflight,
    ok: false,
  };
}

export { migrateApply, migratePlan, migrateRecovery };
export type { MigrateApplyResult, MigratePlan, MigrateRecoveryResult };
