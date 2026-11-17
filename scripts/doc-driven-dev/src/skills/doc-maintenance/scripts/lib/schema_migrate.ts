"use strict";

// ---------------------------------------------------------------------------
// doc_maintenance migrate plan|apply|recovery (Issue #233)
// ---------------------------------------------------------------------------
//
// The only authorized migration surface. `plan` is fully read-only: it emits
// the shared preflight diagnostic plus a deterministic planHash pinning the
// scanned state. `apply` performs exactly one bounded write — installing or
// repairing the schema manifest — and only when the repository content is
// already consistent with the declared versions; it re-runs the preflight
// afterward and refuses to report success unless the result is `current`.
// `recovery` reports journal state without mutating it; journal-driven
// resume/rollback machinery is #247, the full legacy-content transformation
// is #245.

import crypto from "node:crypto";
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
import type {
  PreflightIssue,
  SchemaPreflightReport,
} from "../../../lib/schema_preflight";

type MigratePlan = {
  command: "migrate plan";
  readOnly: true;
  preflight: SchemaPreflightReport;
  plan: {
    applyEligible: boolean;
    blockers: PreflightIssue[];
    planHash: string;
    next: string;
  };
};

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

function planHashOf(preflight: SchemaPreflightReport): string {
  const payload = {
    status: preflight.status,
    issues: preflight.issues
      .map((issue) => ({ reason: issue.reason, path: issue.path, detail: issue.detail }))
      .sort((a, b) => `${a.path}:${a.reason}:${a.detail}`.localeCompare(`${b.path}:${b.reason}:${b.detail}`)),
    detected: preflight.detected,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// Blockers for the bounded #233 apply: every artifact inconsistency requires
// the full migration machinery (#245/#247). `component-version-behind` and a
// malformed manifest are NOT blockers — rewriting the manifest is exactly the
// fix. Scope escapes and unreadable/escaped manifests are blockers because
// the content cannot be verified or safely written. Manifest-scoped markers
// (canonical execution docs, populated legacy relation fields) count even on
// manifest-less repos — installing a manifest over them would fail the
// post-apply check immediately.
function applyBlockers(preflight: SchemaPreflightReport): PreflightIssue[] {
  const seen = new Set<string>();
  return [...preflight.issues, ...preflight.detected.manifestMarkers].filter((issue) => {
    const key = `${issue.reason}:${issue.path}:${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return issue.reason.startsWith("legacy-")
      || issue.reason === "scope-escape"
      || issue.reason === "manifest-escaped"
      || issue.reason === "manifest-unreadable";
  });
}

function migratePlan(cwd: string): MigratePlan {
  const preflight = evaluateSchemaPreflight(cwd);
  const blockers = applyBlockers(preflight);
  const applyEligible = preflight.status !== "migration-incomplete"
    && preflight.status !== "unsupported-version"
    && blockers.length === 0;
  const planHash = planHashOf(preflight);
  const next = preflight.status === "current"
    ? "already current — nothing to migrate"
    : applyEligible
      ? `run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… to install the manifest`
      : "legacy artifacts or unsafe state require the full migration (inventory/apply machinery lands in #245/#247) — the marker list above is the read-only inventory";
  return { command: "migrate plan", readOnly: true, preflight, plan: { applyEligible, blockers, planHash, next } };
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
  const before = evaluateSchemaPreflight(cwd);
  const planHash = planHashOf(before);
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
  if (before.status === "current") {
    return { ...refuse("already-current"), ok: true };
  }
  if (before.status === "unsupported-version") {
    return refuse("manifest declares a newer schema generation — upgrade the toolchain instead of rewriting by hand");
  }
  if (before.status === "migration-incomplete") {
    return refuse("a migration journal or in-progress marker is present — run migrate recovery first");
  }
  const blockers = applyBlockers(before);
  if (blockers.length > 0) {
    return refuse("legacy artifacts or unsafe state require the full migration (#245/#247); this apply only installs the manifest on already-consistent content", blockers);
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
