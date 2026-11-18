"use strict";

// ---------------------------------------------------------------------------
// Migration apply / resume / rollback engine (Issue #247)
// ---------------------------------------------------------------------------
//
// The write half of the migration lane. `migrate apply --expect <planHash>`
// executes exactly the deterministic plan `migrate plan` emitted — the plan
// hash is recomputed inside apply, so a match proves byte-identical inputs,
// identical decisions, and identical planned writes. Anything else fails
// closed before the first write.
//
// Writes span heterogeneous stores (durable docs in Git, Execution Store
// run records, the schema manifest, generated indexes), so no single
// rename can make them atomic. Safety comes from a staging area plus the
// journal at docs/.doc-driven-dev/migration.journal.json:
//
//   prepare   — every gate (plan hash, blockers, git state, state-root
//               boundary, resolutions) passes; staging + journal open.
//   transform — every output byte is rendered into
//               .apm/state/doc-driven-dev/migration/ and pinned in the
//               journal; originals of every edited/removed file are
//               captured for rollback. The stage is journaled before the
//               first artifact lands, so a mid-transform crash leaves a
//               step-less journal that recovery rebuilds and re-runs.
//   validate  — staged artifacts are re-verified (document contract,
//               run-record schemas, task DAG, check references, target
//               containment) before anything touches the repository.
//   publish   — staged docs land atomically, run snapshots import through
//               the Execution Store's own integrity-checked importer.
//   finalize  — removals (reversible: originals stay staged), index
//               regeneration, run handoffs, the postflight gate
//               (preflight markers + owner lint + Knowledge Graph on
//               touched paths), the schema manifest stamp LAST, then
//               journal/staging cleanup.
//
// A crash anywhere leaves the journal behind; the next preflight reports
// `migration-incomplete` and `migrate recovery` resumes or rolls back.
// Nothing reports success on partial writes — `applied` is only true after
// the post-apply preflight comes back `current`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";

import {
  DOC_DRIVEN_DEV_DIR,
  EXECUTION_STATE_ROOT,
  MIGRATION_JOURNAL_PATH,
  SCHEMA_MANIFEST_PATH,
  evaluateSchemaPreflight,
  schemaManifestText,
  statusSummary,
  walkTree,
} from "../../../lib/schema_preflight";
import type { PreflightIssue, SchemaPreflightReport } from "../../../lib/schema_preflight";
import {
  configs,
  docTypes,
  ephemeralConfigs,
  LIFECYCLE_VALUES,
  knowledgeRelationFields,
  managedDocDirs,
  PROVENANCE_RELATION_KEYS,
  resolveDocType,
} from "../../../lib/doc_types";
import {
  isIndexFileName,
  isInsideCheckout,
  isVcsInternalPath,
  nonReferenceRelationKeys,
  normalizeContainedRelPath,
  normalizeDir,
} from "../../../lib/document_utils";
import {
  canonicalJson,
  isPlainObject,
  isSha256,
  isValidId,
  validateCheckpoint,
  validateManifest,
  validateReceipt,
  validateTask,
} from "../../../lib/execution_store/types";
import type {
  CheckpointRecord,
  ReceiptRecord,
  RunManifest,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "../../../lib/execution_store/types";
import { atomicWriteFile } from "../../../lib/execution_store/atomic";
import {
  ensureStateRootBoundary,
  resolveStateRoot,
} from "../../../lib/execution_store/boundary";
import {
  finalizeRun,
  importRun,
  loadRun,
  exportRun,
  recordCheckpoint,
  recordReceipt,
  StoreError,
} from "../../../lib/execution_store";
import type { RunExport } from "../../../lib/execution_store";
import { parseCheckInput, parseVerificationChecks } from "../../../lib/verification_checks";
import type { VerificationCheckV1 } from "../../../lib/verification_checks";
import { parseClaimReference } from "../../../lib/claim_ids";
import {
  mergeManagedIndex,
  primaryIndexTypeForDir,
  renderManagedIndex,
  residentTypesForDir,
} from "../../../lib/doc_suite_utils";
import { collectFindings } from "../../../lib/doc_report";
import { projectKnowledgeGraph } from "../../../lib/knowledge_graph";
import {
  buildMigrationPlan,
  convertedId,
  hashId,
  relationEntries,
} from "./migration_inventory";
import type {
  InventoryDocument,
  MigrationPlanReport,
  SemanticDecision,
} from "./migration_inventory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGING_DIR = `${EXECUTION_STATE_ROOT}/migration`;
const RUN_STATUS_DEFAULTS: Record<string, string> = {
  draft: "active",
  approved: "active",
  "in-progress": "active",
  blocked: "active",
  completed: "completed",
};

const KNOWN_FM_FIELDS: ReadonlySet<string> = new Set([
  "id", "type", "status", "lifecycle", "title", "created", "updated",
  "owners", "relations", "metadata", "checks", "knowledge_kind",
  "effectOutcomes", "checkpointEvidence",
]);

const V1_RELATION_FIELDS: ReadonlySet<string> = new Set(knowledgeRelationFields());

// The durable type vocabulary a decision may declare a doc into.
const DURABLE_TYPES: ReadonlySet<string> = new Set(docTypes);
const KNOWLEDGE_KINDS: ReadonlySet<string> = new Set(configs.knowledge.fieldVocabularies.knowledge_kind);

// Choices that instruct a human step + replan rather than something the
// apply can execute — selecting one is a valid answer, it just cannot run
// through this apply.
const NON_EXECUTABLE_CHOICES: ReadonlySet<string> = new Set([
  "repair-then-replan",
  "restore-readability-then-replan",
  "repair-front-matter-then-replan",
  "repair-relations-then-replan",
  "remove-the-link-then-replan",
  "rename-manually",
  "resolve-shared-target",
  "drop-duplicate-writes",
  "skip-source",
]);

// Choices that require a NEW plan (they change the inventory model itself —
// an untyped doc reclassifying into plan/task/test-spec means the plan's
// run grouping and collision detection never saw it).
const REPLAN_REQUIRED_CHOICES: ReadonlySet<string> = new Set([
  "plan",
  "task",
  "test-spec",
]);

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareCodeUnits);
}

class MigrationFault extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MigrationFault";
    this.code = code;
  }
}

// Test-only fault injection (never a CLI surface — the library option and
// the DOC_MAINTENANCE_MIGRATE_FAIL_AT env hook both resolve here). Format:
// "<stage>" crashes immediately after that stage's journal entry commits;
// "<stage>:<n>" crashes after n step completions inside the stage — for
// "transform", after n artifacts have been staged.
function crashAt(options: ApplyOptions, stage: string, completedSteps = 0): void {
  const spec = options.failAt ?? process.env.DOC_MAINTENANCE_MIGRATE_FAIL_AT;
  if (spec === undefined) return;
  const [specStage, specCount] = spec.split(":");
  if (specStage !== stage) return;
  if (specCount === undefined && completedSteps === 0) {
    throw new MigrationFault("injected-fault", `fault injection: crash on entering ${stage}`);
  }
  if (specCount !== undefined && completedSteps === Number.parseInt(specCount, 10)) {
    throw new MigrationFault("injected-fault", `fault injection: crash inside ${stage} after ${completedSteps} step(s)`);
  }
}

// `null` means unverifiable, which the apply gate treats as dirty — the
// same fail-closed posture boundary.ts takes when `.git` exists but git
// cannot answer. A checkout with no `.git` at all is a plain directory:
// there is no worktree to be dirty, matching the boundary's `none` context.
function worktreeDirty(cwd: string): boolean | null {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (probe.status !== 0) {
    return fs.existsSync(path.join(cwd, ".git")) ? null : false;
  }
  if (probe.stdout.trim() !== "true") return false; // not inside a work tree — nothing to dirty
  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (status.status !== 0) return null;
  return status.stdout.trim().length > 0;
}

function baseCommit(cwd: string): string | null {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

type RawDoc = {
  path: string;
  raw: string;
  data: Record<string, unknown>;
  body: string;
  parseError: string | null;
};

function readRawDoc(cwd: string, rel: string): RawDoc {
  const abs = path.join(cwd, rel);
  let raw = "";
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (error: unknown) {
    return { path: rel, raw, data: {}, body: "", parseError: error instanceof Error ? error.message : String(error) };
  }
  try {
    const parsed = matter(raw, {});
    return { path: rel, raw, data: isPlainObject(parsed.data) ? parsed.data : {}, body: parsed.content, parseError: null };
  } catch (error: unknown) {
    return { path: rel, raw, data: {}, body: raw, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function stringField(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstH1(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

type StepOp =
  | "doc-create"
  | "doc-edit"
  | "run-import"
  | "remove"
  | "index"
  | "run-record"
  | "export"
  | "handoff-finalize"
  | "manifest"
  | "cleanup";

type JournalStep = {
  id: string;
  stage: "publish" | "finalize";
  op: StepOp;
  target: string;
  staged: string | null;
  backup: string | null;
  detail: Record<string, unknown>;
  state: "pending" | "done";
};

type JournalRemoval = {
  path: string;
  backup: string | null;
  dir: boolean;
  state: "pending" | "done";
};

type MigrationJournal = {
  schemaVersion: 1;
  kind: "migration-journal";
  planHash: string;
  inputHash: string;
  resolutionsHash: string;
  resolutions: Record<string, unknown>;
  runHandoffs: Record<string, unknown>;
  // The hash-pinned plan verbatim — a mid-transform crash can never
  // rebuild it from disk (the journal and staging artifacts themselves
  // change the scan), so the journal carries it for resume's re-transform.
  // Absent in journals opened by earlier builds — those fail closed.
  plan?: MigrationPlanReport;
  startedAt: string;
  updatedAt: string;
  stage: "prepare" | "transform" | "validate" | "publish" | "finalize";
  staging: string;
  inputs: { path: string; sha256: string }[];
  staged: { path: string; sha256: string }[];
  steps: JournalStep[];
  removals: JournalRemoval[];
  followUps: string[];
  touchedPaths: string[];
  acceptedPaths: string[];
  // Blocking lint/graph findings that existed BEFORE the migration — the
  // postflight gate diffs against this set so pre-existing structural debt
  // (e.g. indexes for untouched type dirs, a missing design overview) can
  // never masquerade as a migration blocker or a migration fix.
  baselineFindings: string[];
  diagnosticsRunId: string | null;
  postflight: PostflightReport | null;
  // Directories the migration created that did not exist at prepare —
  // rollback prunes exactly these (and only while they are still empty), so
  // a rolled-back tree carries no leftover empty dirs the engine made.
  createdDirs: string[];
};

type PostflightReport = {
  pass: boolean;
  checkedAt: string;
  markers: { legacyMarkers: number; manifestMarkers: number; executionDocs: number };
  blockingFindings: { path: string | null; ruleId: string; message: string }[];
  graphIssues: { path: string; code: string; message: string }[];
  detail: string;
};

type ApplyOptions = {
  expect?: string;
  resolutionsFile?: string;
  resolutions?: unknown;
  allowDirty?: boolean;
  failAt?: string;
  now?: Clock;
};

type ApplyReport = {
  command: "migrate apply";
  applied: boolean;
  resumed: boolean;
  planHash: string;
  journalPath: string;
  stage: string | null;
  steps: { total: number; done: number };
  docsWritten: string[];
  runsImported: string[];
  removals: string[];
  reason: string;
  blockers: PreflightIssue[];
  followUps: string[];
  postflight: PostflightReport | null;
  preflight: SchemaPreflightReport;
  ok: boolean;
};

type RecoveryOptions = {
  action?: "inspect" | "resume" | "rollback";
  expect?: string;
  failAt?: string;
  now?: Clock;
};

type RecoveryReport = {
  command: "migrate recovery";
  status: "no-migration-in-progress" | "migration-incomplete" | "recovered-resume" | "recovered-rollback" | "resume-refused" | "rollback-incomplete";
  recovered: boolean;
  journalPath: string | null;
  journal: {
    planHash: string;
    stage: string;
    stepsDone: number;
    stepsTotal: number;
    removalsDone: number;
    removalsTotal: number;
  } | null;
  apply: ApplyReport | null;
  rollback: { restored: string[]; deleted: string[]; irreversible: string[]; conflicts: string[] } | null;
  note: string;
  preflight: SchemaPreflightReport;
  ok: boolean;
};

// ---------------------------------------------------------------------------
// Journal I/O — atomic, the only mutation surface that may exist mid-flight
// ---------------------------------------------------------------------------

function journalAbs(cwd: string): string {
  return path.resolve(cwd, MIGRATION_JOURNAL_PATH);
}

function stagingAbs(cwd: string, journal?: MigrationJournal): string {
  return path.resolve(cwd, journal?.staging ?? STAGING_DIR);
}

function writeJournal(cwd: string, journal: MigrationJournal, now: Clock): void {
  journal.updatedAt = now();
  fs.mkdirSync(path.dirname(journalAbs(cwd)), { recursive: true });
  atomicWriteFile(journalAbs(cwd), `${JSON.stringify(journal, null, 2)}\n`);
}

function readJournal(cwd: string): { journal: MigrationJournal | null; error: string | null } {
  const abs = journalAbs(cwd);
  if (!fs.existsSync(abs)) return { journal: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error: unknown) {
    return { journal: null, error: `migration journal is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isPlainObject(parsed) || parsed.kind !== "migration-journal" || parsed.schemaVersion !== 1
    || !isSha256(parsed.planHash) || !Array.isArray(parsed.steps) || !Array.isArray(parsed.removals)
    || !Array.isArray(parsed.inputs) || !Array.isArray(parsed.staged) || !isPlainObject(parsed.resolutions)
    || !isPlainObject(parsed.runHandoffs)) {
    return { journal: null, error: "migration journal exists but does not match the v1 journal schema — it may be foreign or from another toolchain; remove it only after verifying no apply is in flight" };
  }
  // Path sanity is verified once here — every consumer (resume validation,
  // publish, rollback) then trusts the journal without re-walking it. A
  // journal that names an escaping target, staging area, staged artifact,
  // backup, or input is not this engine's journal; trusting it would let a
  // tampered file steer reads and writes outside the checkout. VCS
  // internals refuse too: no legitimate journal path is ever under `.git`
  // (staging paths legitimately live under the state root, so the managed
  // namespaces stay allowed here — per-op namespace rules land in
  // validateStaged instead).
  const staging = typeof parsed.staging === "string" ? normalizeContainedRelPath(parsed.staging) : null;
  if (staging === null || !isUnderDir(staging, EXECUTION_STATE_ROOT)) {
    return { journal: null, error: `migration journal names a staging area ${JSON.stringify(parsed.staging)} outside the execution-state namespace — refusing to trust it` };
  }
  const pathFields: unknown[] = [];
  for (const step of parsed.steps as { target?: unknown; staged?: unknown; backup?: unknown }[]) {
    if (!isPlainObject(step) || typeof step.target !== "string") {
      return { journal: null, error: "migration journal holds a step without a string target — refusing to trust it" };
    }
    pathFields.push(step.target, step.staged, step.backup);
  }
  for (const removal of parsed.removals as { path?: unknown; backup?: unknown }[]) {
    if (!isPlainObject(removal) || typeof removal.path !== "string") {
      return { journal: null, error: "migration journal holds a removal without a string path — refusing to trust it" };
    }
    pathFields.push(removal.path, removal.backup);
  }
  for (const pin of [...parsed.inputs, ...parsed.staged] as { path?: unknown }[]) {
    if (isPlainObject(pin)) pathFields.push(pin.path);
  }
  // Journals opened by earlier builds predate this field — absent is fine
  // (rollback then prunes nothing); present must be contained rel paths.
  const createdDirs = Array.isArray(parsed.createdDirs) ? parsed.createdDirs : [];
  for (const dir of createdDirs) pathFields.push(dir);
  for (const field of pathFields) {
    if (field === null || field === undefined) continue;
    const normalizedField = typeof field === "string" ? normalizeContainedRelPath(field) : null;
    if (normalizedField === null || isVcsInternalPath(normalizedField)) {
      return { journal: null, error: `migration journal names a path ${JSON.stringify(field)} that escapes the checkout or touches VCS internals — refusing to trust it` };
    }
  }
  const journal = parsed as unknown as MigrationJournal;
  journal.createdDirs = createdDirs as string[];
  // An embedded plan is optional (journals opened by earlier builds lack
  // it); anything that is not an object can never steer a rebuild.
  if (!isPlainObject(journal.plan)) journal.plan = undefined;
  return { journal, error: null };
}

// ---------------------------------------------------------------------------
// Resolutions — parse + normalize the decision file
// ---------------------------------------------------------------------------

type ResolutionsInput = {
  schemaVersion?: unknown;
  planHash?: unknown;
  decisions?: Record<string, unknown>;
  runHandoffs?: Record<string, unknown>;
};

type NormalizeError = { decisionId: string; path: string; message: string };

// `raw` accepted forms: a bare candidate string ("knowledge", "assign:VD-1"),
// or an object { choice, ...params } where choice is a literal candidate or
// the stem of a parameterized candidate (assign/write/run/assign-to-run).
function rawChoice(raw: unknown): { choice: string; params: Record<string, unknown> } | null {
  if (typeof raw === "string" && raw.trim() !== "") {
    return { choice: raw.trim(), params: {} };
  }
  if (isPlainObject(raw) && typeof raw.choice === "string" && raw.choice.trim() !== "") {
    const { choice: rawChoiceValue, ...params } = raw;
    return { choice: (rawChoiceValue as string).trim(), params };
  }
  return null;
}

function candidateMatch(choice: string, candidates: string[]): { literal: string | null; stem: string | null } {
  if (candidates.includes(choice)) return { literal: choice, stem: null };
  for (const candidate of candidates) {
    const stemMatch = /^([^<:]+):\s*</.exec(candidate);
    if (stemMatch && choice === stemMatch[1]) return { literal: null, stem: stemMatch[1] };
  }
  // `assign-to-run:<runId>` style — the whole prefix up to `<` is the stem.
  for (const candidate of candidates) {
    const stemMatch = /^(.+):\s*</.exec(candidate);
    if (stemMatch && choice === stemMatch[1]) return { literal: null, stem: stemMatch[1] };
  }
  return { literal: null, stem: null };
}

function stringParam(params: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = params[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function listParam(params: Record<string, unknown>, ...names: string[]): string[] | null {
  for (const name of names) {
    const value = params[name];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value.map((item) => (item as string).trim());
    }
  }
  return null;
}

// Every kind's normalized value is a small JSON object consumed by the
// transform. Kinds not listed normalize to { choice } after a candidates
// membership check.
function normalizeDecision(
  decision: SemanticDecision,
  raw: unknown,
): { value: Record<string, unknown> } | { error: string } {
  const parsed = rawChoice(raw);
  if (parsed === null) {
    return { error: `resolution for ${decision.decisionId} must be a candidate string or { choice, ... } object` };
  }
  const { choice, params } = parsed;
  const match = candidateMatch(choice, decision.candidates);
  // `assign:<id>`/`write:<path>`/`assign-to-run:<runId>` accept the
  // parameterized inline form `assign:VD-0009` too — recover stem + arg.
  let arg: string | null = null;
  if (match.literal === null && match.stem === null && typeof raw === "string") {
    for (const candidate of decision.candidates) {
      const stemMatch = /^(.+):\s*</.exec(candidate);
      if (stemMatch && choice.startsWith(`${stemMatch[1]}:`)) {
        arg = choice.slice(stemMatch[1].length + 1).trim();
        return finishParam(stemMatch[1], arg, params, decision);
      }
    }
    return { error: `${decision.decisionId}: ${JSON.stringify(choice)} is not one of the declared candidates ${JSON.stringify(decision.candidates)}` };
  }
  if (match.literal === null && match.stem === null) {
    return { error: `${decision.decisionId}: ${JSON.stringify(choice)} is not one of the declared candidates ${JSON.stringify(decision.candidates)}` };
  }
  const literal = match.literal ?? match.stem!;
  if (match.stem !== null) {
    // Parameterized: value may come from params.value/<stem-specific name>.
    const argFromParams = stringParam(params, "value", "id", "runId", "target", "path");
    if (argFromParams === null) {
      return { error: `${decision.decisionId}: ${literal} requires a value (e.g. { choice: "${literal}", value: "…" })` };
    }
    return finishParam(literal, argFromParams, params, decision);
  }
  return finishLiteral(literal, params, decision);
}

function finishParam(
  stem: string,
  arg: string,
  params: Record<string, unknown>,
  decision: SemanticDecision,
): { value: Record<string, unknown> } | { error: string } {
  switch (decision.kind) {
    case "id-assignment":
    case "id-collision": {
      if (stem !== "assign") return { error: `${decision.decisionId}: unexpected parameterized candidate ${stem}` };
      if (!isValidId(arg)) return { error: `${decision.decisionId}: assigned id ${JSON.stringify(arg)} is not a valid artifact id` };
      return { value: { action: "assign", id: arg } };
    }
    case "target-collision": {
      if (stem !== "write") return { error: `${decision.decisionId}: unexpected parameterized candidate ${stem}` };
      const target = normalizeContainedRelPath(arg);
      if (target === null || isProtectedWriteTarget(target)) {
        return { error: `${decision.decisionId}: write target ${JSON.stringify(arg)} escapes the checkout or lands in a protected namespace (state, manifest, or VCS internals)` };
      }
      return { value: { action: "write", target } };
    }
    case "bookkeeping-assignment": {
      if (stem !== "assign-to-run") return { error: `${decision.decisionId}: unexpected parameterized candidate ${stem}` };
      if (!isValidId(arg)) return { error: `${decision.decisionId}: assigned run ${JSON.stringify(arg)} is not a valid artifact id` };
      return { value: { action: "assign", runId: arg } };
    }
    default:
      return { error: `${decision.decisionId}: unexpected parameterized candidate ${stem}` };
  }
}

function finishLiteral(
  literal: string,
  params: Record<string, unknown>,
  decision: SemanticDecision,
): { value: Record<string, unknown> } | { error: string } {
  const kind = decision.kind;
  if (NON_EXECUTABLE_CHOICES.has(literal)) {
    return { value: { action: "blocked", choice: literal } };
  }
  // Concrete value-embedded candidates (`assign:VD-0001`, `write:docs/x.md`,
  // `assign-to-run:RUN-x`) carry their argument inline — normalize like the
  // parameterized form.
  const prefixMatch = /^(assign|write|assign-to-run):(.+)$/.exec(literal);
  if (prefixMatch) {
    return finishParam(prefixMatch[1], prefixMatch[2].trim(), params, decision);
  }
  switch (kind) {
    case "status-mapping":
      return { value: { status: literal } };
    case "lifecycle-assignment":
      return { value: { lifecycle: literal } };
    case "missing-field": {
      const value = stringParam(params, "value", "title", "date");
      if (value === null) {
        return { error: `${decision.decisionId}: ${literal} requires a value (e.g. { choice: "${literal}", value: "…" })` };
      }
      if (literal === "declare-date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { error: `${decision.decisionId}: declared date ${JSON.stringify(value)} must be YYYY-MM-DD` };
      }
      return { value: { field: literal === "declare-title" ? "title" : "date", value } };
    }
    case "run-membership":
      return { value: { runId: literal === "orphan-run" ? "orphan-run" : literal.replace(/^run:/, "") } };
    case "depends-on-resolution":
      if (literal === "drop-dependency") return { value: { action: "drop" } };
      if (literal === "declare-sibling-task-id") {
        const taskId = stringParam(params, "taskId", "id", "value");
        if (taskId === null) return { error: `${decision.decisionId}: declare-sibling-task-id requires a taskId` };
        return { value: { action: "declare", taskId } };
      }
      if (literal === "declare-single-run-merge") {
        const runId = stringParam(params, "runId", "into", "value");
        if (runId === null) return { error: `${decision.decisionId}: declare-single-run-merge requires a runId naming the surviving run` };
        return { value: { action: "merge", runId } };
      }
      return { error: `${decision.decisionId}: unsupported depends-on resolution ${literal}` };
    case "malformed-relation-value":
    case "malformed-bookkeeping":
      if (literal === "drop-as-unmapped") return { value: { action: "drop" } };
      if (literal === "preserve-as-diagnostic-trace") return { value: { action: "trace" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "unreadable-input":
    case "unparseable-frontmatter":
    case "malformed-frontmatter":
      if (literal === "discard") return { value: { action: "discard" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "unknown-type":
      if (literal === "declare-target-type") {
        const type = stringParam(params, "type", "targetType", "value");
        if (type === null || !DURABLE_TYPES.has(type)) {
          return { error: `${decision.decisionId}: declare-target-type requires a durable type name (${[...DURABLE_TYPES].join(", ")})` };
        }
        return { value: { action: "declare", type, ...durableParams(params) } };
      }
      if (literal === "preserve-as-unmanaged") return { value: { action: "preserve" } };
      if (literal === "discard") return { value: { action: "discard" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "untyped-legacy-doc":
      if (REPLAN_REQUIRED_CHOICES.has(literal)) {
        return { value: { action: "blocked", choice: literal, note: "reclassification into an execution-bound or test-spec type changes the plan's model — set `type:` in front matter and rerun migrate plan" } };
      }
      if (literal === "knowledge") {
        const kindValue = stringParam(params, "kind", "knowledge_kind", "knowledgeKind");
        if (kindValue === null || !KNOWLEDGE_KINDS.has(kindValue)) {
          return { error: `${decision.decisionId}: knowledge classification requires { kind: "${[...KNOWLEDGE_KINDS].join("|")}" }` };
        }
        return { value: { action: "knowledge", kind: kindValue, ...durableParams(params) } };
      }
      if (literal === "diagnostic-trace") return { value: { action: "trace" } };
      if (literal === "leave-unmanaged") return { value: { action: "leave" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "doc-placement":
      if (literal === "move-to-canonical-dir") return { value: { action: "move", ...durableParams(params) } };
      if (literal === "keep-and-accept-finding") return { value: { action: "keep" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "run-status":
      return { value: { status: literal } };
    case "run-approval":
      return { value: { action: literal.startsWith("re-approve") ? "re-approve" : "proceed" } };
    case "ir-classification":
    case "exp-classification": {
      if (literal === "knowledge" || literal === "evidence-candidate") {
        const kindValue = stringParam(params, "kind", "knowledge_kind", "knowledgeKind");
        if (kindValue === null || !KNOWLEDGE_KINDS.has(kindValue)) {
          return { error: `${decision.decisionId}: ${literal} requires { kind: "${[...KNOWLEDGE_KINDS].join("|")}" }` };
        }
        return { value: { action: literal, kind: kindValue, ...durableParams(params) } };
      }
      if (literal === "adr" || literal === "spec" || literal === "design") {
        return { value: { action: "durable", type: literal, ...durableParams(params) } };
      }
      if (literal === "diagnostic-trace") return { value: { action: "trace" } };
      if (literal === "discard") return { value: { action: "discard" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    }
    case "evidence-admission":
      if (literal === "admit-as-evidence-candidate") return { value: { action: "admit" } };
      if (literal === "keep-as-prose") return { value: { action: "keep" } };
      if (literal === "discard") return { value: { action: "discard" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "check-binding":
      if (decision.element === "relations.verified-by") {
        const refs = listParam(params, "refs", "checks", "targets");
        if (refs === null || refs.length === 0) {
          return { error: `${decision.decisionId}: verified-by binding requires { refs: ["VD-<id>::CHK-NN", …] }` };
        }
        return { value: { action: "refs", refs } };
      }
      {
        const checks = params.checks;
        if (!Array.isArray(checks) || checks.length === 0) {
          return { error: `${decision.decisionId}: check binding requires { checks: [VerificationCheckV1, …] }` };
        }
        return { value: { action: "checks", checks } };
      }
    case "legacy-relation":
      if (literal === "declare-v1-mapping") {
        const field = stringParam(params, "field", "map");
        if (field === null || !V1_RELATION_FIELDS.has(field)) {
          return { error: `${decision.decisionId}: declare-v1-mapping requires { field: "<v1 relation>" }` };
        }
        const targets = listParam(params, "targets");
        return { value: { action: "map", field, targets: targets ?? undefined } };
      }
      if (literal === "drop-as-unmapped") return { value: { action: "drop" } };
      if (literal === "preserve-as-body-note") return { value: { action: "note" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "unresolved-relation-target":
      if (literal === "retarget") {
        const targets = listParam(params, "targets", "value");
        if (targets === null || targets.length === 0) {
          return { error: `${decision.decisionId}: retarget requires { targets: ["<doc-ref>", …] }` };
        }
        return { value: { action: "retarget", targets } };
      }
      if (literal === "drop") return { value: { action: "drop" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "legacy-relation-target":
      if (literal === "retarget-to-converted-doc") return { value: { action: "retarget" } };
      if (literal === "drop") return { value: { action: "drop" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "bookkeeping-assignment":
      if (literal === "diagnostic-trace") return { value: { action: "trace" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "foreign-state-disposition":
      if (literal === "discard-at-finalize") return { value: { action: "discard" } };
      if (literal === "preserve-as-diagnostic-trace" || literal === "preserve-as-diagnostic") return { value: { action: "trace" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "hand-curated-index":
      if (literal === "adopt-managed") return { value: { action: "adopt" } };
      if (literal === "keep-unmanaged") return { value: { action: "keep" } };
      if (literal === "extract-to-knowledge") {
        const kindValue = stringParam(params, "kind", "knowledge_kind", "knowledgeKind");
        if (kindValue === null || !KNOWLEDGE_KINDS.has(kindValue)) {
          return { error: `${decision.decisionId}: extract-to-knowledge requires { kind: "${[...KNOWLEDGE_KINDS].join("|")}" }` };
        }
        return { value: { action: "extract", kind: kindValue, ...durableParams(params) } };
      }
      if (literal === "discard") return { value: { action: "discard" } };
      return { error: `${decision.decisionId}: ${literal} is not executable here` };
    case "scope-escape":
      return { value: { action: "blocked", choice: literal, note: "a scope escape can only be resolved outside apply — remove the link and replan" } };
    default:
      return { value: { choice: literal } };
  }
}

// Optional explicit declarations a durable-bound resolution may carry when
// the plan never emitted a per-field decision (decision-disposition docs).
function durableParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of ["id", "status", "lifecycle", "title", "created", "updated"]) {
    const value = params[name];
    if (typeof value === "string" && value.trim() !== "") out[name] = value.trim();
  }
  return out;
}

type NormalizedResolutions = {
  values: Map<string, Record<string, unknown>>;
  handoffs: Map<string, { method: "keep" | "export" | "finalize"; out: string | null; status: RunStatus | null }>;
  blocked: { decisionId: string; path: string; kind: string; choice: string; note?: string }[];
  errors: NormalizeError[];
  missing: SemanticDecision[];
  unknown: string[];
};

function normalizeRunHandoff(
  runId: string,
  raw: unknown,
): { method: "keep" | "export" | "finalize"; out: string | null; status: RunStatus | null } | { error: string } {
  let parsed = rawChoice(raw);
  if (parsed === null && isPlainObject(raw) && typeof raw.method === "string" && raw.method.trim() !== "") {
    // { method: "keep"|"export"|"finalize", ... } — the explicit object form.
    const { method: _method, ...params } = raw;
    parsed = { choice: raw.method.trim(), params };
  }
  if (parsed === null) return { error: `run handoff for ${runId} must be "keep"|"export"|"finalize" or { method, ... }` };
  const method = parsed.choice === "export" || parsed.params.method === "export" ? "export"
    : parsed.choice === "finalize" || parsed.params.method === "finalize" ? "finalize"
      : parsed.choice === "keep" || parsed.params.method === "keep" ? "keep"
        : null;
  if (method === null) return { error: `run handoff for ${runId}: method must be keep|export|finalize` };
  if (method === "export") {
    const out = stringParam(parsed.params, "out", "file", "path") ?? `migration-exports/${runId}.export.json`;
    const normalized = normalizeContainedRelPath(out);
    if (normalized === null || isProtectedWriteTarget(normalized)) {
      return { error: `run handoff export target ${JSON.stringify(out)} must be a checkout-relative path inside the checkout and outside the state/manifest namespaces and VCS internals` };
    }
    return { method, out: normalized, status: null };
  }
  if (method === "finalize") {
    const status = stringParam(parsed.params, "status");
    if (status !== "completed" && status !== "aborted") {
      return { error: `run handoff finalize for ${runId} requires { status: "completed"|"aborted" }` };
    }
    return { method, out: null, status };
  }
  return { method: "keep", out: null, status: null };
}

function isUnderDir(rel: string, dir: string): boolean {
  return rel === dir || rel.startsWith(`${dir}/`);
}

// The namespaces no migration write target may ever name: the manifest +
// journal dir, the execution-state root, and VCS internals. Containment
// alone was never the whole rule — `.git/config` (or the folded
// `docs/../.git/config`) IS inside the checkout, yet an export landing
// there corrupts the worktree and carries `backup: null`, so rollback
// would delete it outright. Every path-bearing input surface the engine
// writes through applies this same set: resolution write:/export targets
// at normalize time, the journal sweep and embedded-plan revalidation at
// the trust boundary, and the staged-target recheck before publish.
function isProtectedWriteTarget(rel: string): boolean {
  return isVcsInternalPath(rel)
    || isUnderDir(rel, DOC_DRIVEN_DEV_DIR)
    || isUnderDir(rel, EXECUTION_STATE_ROOT);
}

function normalizeResolutions(
  plan: MigrationPlanReport,
  input: ResolutionsInput,
): NormalizedResolutions {
  const out: NormalizedResolutions = {
    values: new Map(),
    handoffs: new Map(),
    blocked: [],
    errors: [],
    missing: [],
    unknown: [],
  };
  const rawDecisions = input.decisions ?? {};
  const byId = new Map(plan.migration.semanticDecisions.map((decision) => [decision.decisionId, decision]));

  for (const id of Object.keys(rawDecisions)) {
    if (!byId.has(id)) out.unknown.push(id);
  }
  for (const decision of plan.migration.semanticDecisions) {
    const raw = rawDecisions[decision.decisionId];
    if (raw === undefined) {
      if (decision.required) {
        out.missing.push(decision);
      } else if (decision.default !== null) {
        const normalized = normalizeDecision(decision, decision.default);
        if ("value" in normalized) {
          if (normalized.value.action === "blocked") {
            out.blocked.push({ decisionId: decision.decisionId, path: decision.path, kind: decision.kind, choice: decision.default });
          } else {
            out.values.set(decision.decisionId, normalized.value);
          }
        }
      }
      continue;
    }
    const normalized = normalizeDecision(decision, raw);
    if ("error" in normalized) {
      out.errors.push({ decisionId: decision.decisionId, path: decision.path, message: normalized.error });
      continue;
    }
    if (normalized.value.action === "blocked") {
      out.blocked.push({ decisionId: decision.decisionId, path: decision.path, kind: decision.kind, choice: String(normalized.value.choice), note: typeof normalized.value.note === "string" ? normalized.value.note : undefined });
      continue;
    }
    out.values.set(decision.decisionId, normalized.value);
  }

  const rawHandoffs = input.runHandoffs ?? {};
  const knownRuns = new Set([
    ...plan.inventory.runs.filter((run) => run.validManifest).map((run) => run.runId),
    ...plan.migration.runHandoffs.filter((handoff) => handoff.origin === "migrated").map((handoff) => handoff.runId),
  ]);
  for (const [runId, raw] of Object.entries(rawHandoffs)) {
    if (!knownRuns.has(runId)) {
      out.unknown.push(`runHandoffs.${runId}`);
      continue;
    }
    const normalized = normalizeRunHandoff(runId, raw);
    if ("error" in normalized) {
      out.errors.push({ decisionId: `runHandoffs.${runId}`, path: runId, message: normalized.error });
      continue;
    }
    out.handoffs.set(runId, normalized);
  }
  return out;
}

// ---------------------------------------------------------------------------
// World derivation — everything the transform needs, from plan + resolutions
// ---------------------------------------------------------------------------

type TaskSpec = {
  path: string;
  taskId: string;
  runId: string;
  status: TaskStatus;
  dependsOn: string[];
  checks: string[];
  title: string;
};

type RunSpec = {
  runId: string;
  planPath: string | null;
  status: RunStatus;
  tasks: TaskSpec[];
  receipts: { receiptId: string; record: ReceiptRecord }[];
  checkpoints: { checkpointId: string; record: CheckpointRecord }[];
  diagnostics: boolean;
};

type DocWrite = {
  source: string;
  target: string;
  kind: "create" | "edit";
  data: Record<string, unknown>;
  body: string;
};

type ExistingRunRecord = {
  runId: string;
  kind: "receipt" | "checkpoint";
  record: ReceiptRecord | CheckpointRecord;
};

type World = {
  docWrites: DocWrite[];
  runs: RunSpec[];
  removals: { path: string; dir: boolean }[];
  indexJobs: { path: string; dir: string }[];
  existingRecords: ExistingRunRecord[];
  exports: { runId: string; out: string }[];
  handoffs: { runId: string; status: RunStatus }[];
  acceptedPaths: Set<string>;
  touchedPaths: Set<string>;
  diagnosticsRunId: string | null;
  diagnostics: Record<string, unknown>[];
  followUps: string[];
  manifestPlanned: boolean;
};

type WorldCtx = {
  cwd: string;
  plan: MigrationPlanReport;
  resolved: Map<string, Record<string, unknown>>;
  handoffs: Map<string, { method: "keep" | "export" | "finalize"; out: string | null; status: RunStatus | null }>;
  byPath: Map<string, InventoryDocument>;
  decisionsByPath: Map<string, SemanticDecision[]>;
  errors: string[];
  now: Clock;
};

function decisionsFor(ctx: WorldCtx, docPath: string, kind?: string): SemanticDecision[] {
  return (ctx.decisionsByPath.get(docPath) ?? []).filter((decision) => kind === undefined || decision.kind === kind);
}

function resolvedValue(ctx: WorldCtx, decision: SemanticDecision): Record<string, unknown> | null {
  return ctx.resolved.get(decision.decisionId) ?? null;
}

function decisionValue(ctx: WorldCtx, docPath: string, kind: string, element?: string): Record<string, unknown> | null {
  const decision = decisionsFor(ctx, docPath, kind).find((item) => element === undefined || item.element === element);
  return decision === undefined ? null : resolvedValue(ctx, decision);
}

// Any bookkeeping-assignment decision on this carrier resolved to the
// diagnostics sink.
function assignWantsTrace(ctx: WorldCtx, docPath: string): boolean {
  return decisionsFor(ctx, docPath, "bookkeeping-assignment")
    .some((decision) => resolvedValue(ctx, decision)?.action === "trace");
}

function buildWorld(ctx: WorldCtx): World {
  const { plan } = ctx;
  const world: World = {
    docWrites: [],
    runs: [],
    removals: [],
    indexJobs: [],
    existingRecords: [],
    exports: [],
    handoffs: [],
    acceptedPaths: new Set(),
    touchedPaths: new Set(),
    diagnosticsRunId: null,
    diagnostics: [],
    followUps: [],
    manifestPlanned: plan.migration.plannedWrites.some((write) => write.kind === "schema-manifest"),
  };
  const raws = new Map<string, RawDoc>();
  const rawOf = (rel: string): RawDoc => {
    const cached = raws.get(rel);
    if (cached) return cached;
    const raw = readRawDoc(ctx.cwd, rel);
    raws.set(rel, raw);
    return raw;
  };

  // --- run skeleton from the plan's own write list -------------------------
  const runById = new Map<string, RunSpec>();
  for (const write of plan.migration.plannedWrites.filter((item) => item.kind === "run-manifest")) {
    const runDir = path.posix.dirname(write.target);
    const runId = path.posix.basename(runDir);
    runById.set(runId, {
      runId,
      planPath: write.source === "synthesized" ? null : write.source,
      status: "active",
      tasks: [],
      receipts: [],
      checkpoints: [],
      diagnostics: false,
    });
  }
  for (const write of plan.migration.plannedWrites.filter((item) => item.kind === "run-trace" && item.source === "diagnostic-sink")) {
    const runId = path.posix.basename(path.posix.dirname(write.target));
    const spec = runById.get(runId);
    if (spec) {
      spec.diagnostics = true;
      world.diagnosticsRunId = runId;
    }
  }

  // Diagnostics sink — created deterministically when any resolution diverts
  // content to diagnostic trace and the plan did not already provision one.
  const diagnosticsRun = (): string => {
    if (world.diagnosticsRunId !== null) return world.diagnosticsRunId;
    const runId = `RUN-${hashId(`run:diagnostics:apply:${ctx.plan.plan.planHash}`)}`;
    const spec: RunSpec = {
      runId,
      planPath: null,
      status: "active",
      tasks: [],
      receipts: [],
      checkpoints: [],
      diagnostics: true,
    };
    runById.set(runId, spec);
    world.diagnosticsRunId = runId;
    return runId;
  };
  // Every diagnostic line lands in the diagnostics run's trace — that is what
  // the sink is for. Lines carry `migrated.runId` so the source assignment
  // stays visible after the run is imported.
  const trace = (source: string, kind: string, data: unknown): void => {
    const runId = diagnosticsRun();
    world.diagnostics.push({ at: ctx.now(), migrated: { source, kind, runId, data } });
  };

  // --- task grouping ---------------------------------------------------------
  const taskOf = new Map<string, TaskSpec>();
  for (const write of plan.migration.plannedWrites.filter((item) => item.kind === "task-record")) {
    const runDir = path.posix.dirname(path.posix.dirname(write.target));
    const runId = path.posix.basename(runDir);
    const taskId = path.posix.basename(write.target).replace(/\.json$/, "");
    const spec = runById.get(runId);
    if (spec === undefined) {
      ctx.errors.push(`planned task record ${write.target} lands in undeclared run ${runId}`);
      continue;
    }
    const task: TaskSpec = {
      path: write.source,
      taskId,
      runId,
      status: "todo",
      dependsOn: [],
      checks: [],
      title: taskId,
    };
    spec.tasks.push(task);
    taskOf.set(write.source, task);
  }
  const runIdFor = (seed: string): string => `RUN-${hashId(seed)}`;
  const orphanRun = (taskPaths: string[]): string => {
    const seed = `run:orphan:${sortStrings(taskPaths).join(",")}`;
    const runId = runIdFor(seed);
    if (!runById.has(runId)) {
      runById.set(runId, {
        runId, planPath: null, status: "active", tasks: [], receipts: [], checkpoints: [], diagnostics: false,
      });
    }
    return runId;
  };

  // run-membership resolutions redirect tasks between migrated runs.
  const membershipDecisions = plan.migration.semanticDecisions.filter((decision) => decision.kind === "run-membership");
  for (const decision of membershipDecisions) {
    const value = resolvedValue(ctx, decision);
    const task = taskOf.get(decision.path);
    if (task === undefined || value === null) continue;
    const declared = String(value.runId);
    const targetRun = declared === "orphan-run" ? orphanRun([task.path]) : declared;
    const target = runById.get(targetRun);
    if (target === undefined) {
      ctx.errors.push(`${decision.decisionId}: run-membership targets unknown run ${JSON.stringify(targetRun)}`);
      continue;
    }
    const from = runById.get(task.runId);
    if (from) from.tasks = from.tasks.filter((item) => item !== task);
    task.runId = targetRun;
    target.tasks.push(task);
  }

  // declare-single-run-merge: fold the dependency's run into the declared
  // survivor. Pairwise — a chain of merges unions transitively.
  const mergeDecisions = plan.migration.semanticDecisions
    .filter((decision) => decision.kind === "depends-on-resolution" && resolvedValue(ctx, decision)?.action === "merge");
  if (mergeDecisions.length > 0) {
    const parent = new Map<string, string>();
    const find = (run: string): string => {
      let root = run;
      while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    const survivors = new Map<string, string>();
    for (const decision of mergeDecisions) {
      const value = resolvedValue(ctx, decision)!;
      const survivor = String(value.runId);
      const task = taskOf.get(decision.path);
      if (task === undefined) { ctx.errors.push(`${decision.decisionId}: merge declared for unknown task ${decision.path}`); continue; }
      const own = task.runId;
      // The dep's task id is in decision.targets — find its run.
      const depId = decision.targets?.[0];
      const depTask = [...taskOf.values()].find((item) => item.taskId === depId);
      const depRun = depTask?.runId;
      if (depRun === undefined) { ctx.errors.push(`${decision.decisionId}: merge partner ${JSON.stringify(depId)} is not a migrated task`); continue; }
      if (survivor !== own && survivor !== depRun) {
        ctx.errors.push(`${decision.decisionId}: merge survivor ${survivor} must be one of the merging runs (${own}, ${depRun})`);
        continue;
      }
      const rootA = find(own);
      const rootB = find(depRun);
      if (rootA === rootB) continue;
      const keep = find(survivor);
      const drop = keep === rootA ? rootB : rootA;
      parent.set(drop, keep);
      survivors.set(keep, survivor);
    }
    if (parent.size > 0) {
      const components = new Map<string, string[]>();
      for (const runId of runById.keys()) {
        const root = find(runId);
        components.set(root, [...(components.get(root) ?? []), runId]);
      }
      for (const [root, members] of components) {
        const winner = runById.get(survivors.get(root) ?? root)!;
        for (const loserId of members.filter((member) => member !== winner.runId)) {
          const loser = runById.get(loserId)!;
          for (const task of loser.tasks) {
            task.runId = winner.runId;
            winner.tasks.push(task);
          }
          winner.receipts.push(...loser.receipts);
          winner.checkpoints.push(...loser.checkpoints);
          if (loser.planPath !== null) {
            trace(loser.planPath, "merged-plan", { runId: loserId, body: rawOf(loser.planPath).body });
          }
          runById.delete(loserId);
        }
      }
    }
  }

  // Per-task fields.
  for (const spec of runById.values()) {
    for (const task of spec.tasks) {
      const doc = ctx.byPath.get(task.path)!;
      const fm = rawOf(task.path).data;
      task.title = doc.title ?? firstH1(rawOf(task.path).body) ?? task.taskId;
      const taskVocab = ephemeralConfigs.task.statusValues as readonly string[];
      if (doc.status !== null && taskVocab.includes(doc.status)) {
        task.status = doc.status as TaskStatus;
      } else {
        const value = decisionValue(ctx, task.path, "status-mapping", "frontmatter.status");
        if (value !== null && typeof value.status === "string" && taskVocab.includes(value.status)) {
          task.status = value.status as TaskStatus;
        } else {
          ctx.errors.push(`${task.path}: no valid task status resolution (status-mapping)`);
        }
      }
      // depends-on: mechanical same-run ids from the plan plus declared
      // sibling ids; drops and merges were resolved above.
      const depConvertible = plan.migration.convertibles.find((item) => item.kind === "task-depends-on" && item.path === task.path);
      const depIds = new Set<string>(depConvertible?.targets ?? []);
      for (const decision of decisionsFor(ctx, task.path, "depends-on-resolution")) {
        const value = resolvedValue(ctx, decision);
        if (value === null || value.action === "drop" || value.action === "merge") continue;
        if (value.action === "declare" && typeof value.taskId === "string") {
          depIds.add(value.taskId);
        }
      }
      task.dependsOn = sortStrings(depIds);
      // verified-by → qualified check refs.
      for (const decision of decisionsFor(ctx, task.path, "check-binding")) {
        const value = resolvedValue(ctx, decision);
        if (value?.action === "refs" && Array.isArray(value.refs)) {
          task.checks.push(...(value.refs as string[]));
        }
      }
      task.checks = sortStrings(new Set(task.checks));
    }
    spec.tasks.sort((a, b) => compareCodeUnits(a.path, b.path));
  }

  // --- run statuses ------------------------------------------------------------
  for (const spec of runById.values()) {
    if (spec.planPath !== null) {
      const planDoc = ctx.byPath.get(spec.planPath)!;
      const status = planDoc.status;
      if (status !== null && RUN_STATUS_DEFAULTS[status] !== undefined) {
        spec.status = RUN_STATUS_DEFAULTS[status] as RunStatus;
      } else {
        const value = decisionValue(ctx, spec.planPath, "run-status", "frontmatter.status");
        if (value !== null && typeof value.status === "string" && ["active", "completed", "aborted"].includes(value.status)) {
          spec.status = value.status as RunStatus;
        } else {
          ctx.errors.push(`${spec.planPath}: run-status has no valid resolution`);
        }
      }
      if (status === "approved" || status === "in-progress" || status === "completed") {
        const approval = decisionValue(ctx, spec.planPath, "run-approval", "frontmatter.status");
        if (approval?.action === "re-approve") {
          world.followUps.push(`run ${spec.runId}: migrated unapproved — re-approve via execution_store.js approve-plan`);
        } else if (approval?.action === "proceed") {
          world.followUps.push(`run ${spec.runId}: declared proceed-unapproved by migration resolution`);
        }
      }
    } else {
      const runDir = `${EXECUTION_STATE_ROOT}/runs/${spec.runId}`;
      const decision = plan.migration.semanticDecisions.find((item) => item.kind === "run-status" && item.path === runDir);
      const value = decision === undefined ? null : resolvedValue(ctx, decision);
      const resolved = typeof value?.status === "string" ? value.status : decision?.default ?? null;
      if (resolved === null || !["active", "completed", "aborted"].includes(resolved)) {
        ctx.errors.push(`run ${spec.runId}: no valid run-status resolution`);
      } else {
        spec.status = resolved as RunStatus;
      }
    }
  }

  // --- caller bookkeeping → records / trace -------------------------------------
  for (const entry of plan.inventory.callerBookkeeping) {
    const doc = ctx.byPath.get(entry.path);
    const carrierPath = doc?.localeSiblingOf ?? entry.path;
    const fm = rawOf(entry.path).data;
    let runId: string | null = null;
    if (entry.carrier === "plan") {
      runId = [...runById.values()].find((spec) => spec.planPath === carrierPath)?.runId ?? null;
    } else if (entry.carrier === "task") {
      runId = taskOf.get(carrierPath)?.runId ?? null;
    }
    for (const decision of decisionsFor(ctx, entry.path, "bookkeeping-assignment")) {
      const value = resolvedValue(ctx, decision);
      if (value?.action === "assign" && typeof value.runId === "string") {
        runId = value.runId;
      } else if (value?.action === "trace") {
        runId = null; // trace → the diagnostics sink, never a record-bearing run
      }
    }
    const wantsTrace = runId === null && assignWantsTrace(ctx, entry.path);
    if (entry.carrier === "other" && runId === null && !wantsTrace) {
      ctx.errors.push(`${entry.path}: caller bookkeeping has no run assignment`);
      continue;
    }
    const carrierTaskId = entry.carrier === "task" ? (taskOf.get(carrierPath)?.taskId ?? null) : null;
    const spec = runId === null ? null : (runById.get(runId) ?? null);
    const existingRun = runId !== null && spec === null
      && plan.inventory.runs.some((run) => run.runId === runId && run.validManifest);
    if (runId !== null && spec === null && !existingRun) {
      ctx.errors.push(`${entry.path}: bookkeeping assignment targets unknown run ${runId}`);
      continue;
    }
    const outcomes = Array.isArray(fm.effectOutcomes) ? fm.effectOutcomes : [];
    outcomes.forEach((outcome, index) => {
      const completed = isPlainObject(outcome) && outcome.status === "completed";
      if (!completed || wantsTrace) {
        trace(entry.path, "effectOutcome", { index, outcome, runId });
        return;
      }
      const receiptId = `RCP-${hashId(`${entry.path}:effectOutcomes:${index}`)}`;
      const effect = isPlainObject(outcome)
        ? String((isPlainObject(outcome.effect) ? (outcome.effect.id ?? outcome.effect.kind) : outcome.effect) ?? outcome.stage ?? outcome.name ?? "effectOutcome")
        : "effectOutcome";
      const record: ReceiptRecord = {
        schemaVersion: 1,
        runId: runId!,
        receiptId,
        effect,
        taskId: carrierTaskId,
        idempotencyKey: null,
        actor: null,
        status: "success",
        at: typeof (outcome as Record<string, unknown>).at === "string" ? String((outcome as Record<string, unknown>).at) : ctx.now(),
        input: isPlainObject(outcome) && "input" in outcome ? outcome.input : null,
        output: { migrated: { source: entry.path, index }, outcome },
      };
      if (spec !== null) spec.receipts.push({ receiptId, record });
      else world.existingRecords.push({ runId: runId!, kind: "receipt", record });
    });
    const evidence = Array.isArray(fm.checkpointEvidence) ? fm.checkpointEvidence : [];
    evidence.forEach((item, index) => {
      if (wantsTrace) {
        trace(entry.path, "checkpointEvidence", { index, entry: item });
        return;
      }
      const checkpointId = `CHKPT-${hashId(`${entry.path}:checkpointEvidence:${index}`)}`;
      const record: CheckpointRecord = {
        schemaVersion: 1,
        runId: runId!,
        checkpointId,
        nodeId: null,
        edgeId: isPlainObject(item) && typeof item.edgeId === "string" ? item.edgeId : null,
        taskId: carrierTaskId,
        at: isPlainObject(item) && typeof item.at === "string" ? item.at : ctx.now(),
        data: { migrated: { source: entry.path, index }, entry: item },
      };
      if (spec !== null) spec.checkpoints.push({ checkpointId, record });
      else world.existingRecords.push({ runId: runId!, kind: "checkpoint", record });
    });
    // Malformed bookkeeping payloads: explicit decisions only.
    for (const field of entry.malformed) {
      const decision = decisionsFor(ctx, entry.path, "malformed-bookkeeping").find((item) => item.element === `frontmatter.${field}`);
      const value = decision === undefined ? null : resolvedValue(ctx, decision);
      if (value?.action === "trace") {
        trace(entry.path, "malformed-bookkeeping", { field, raw: fm[field] });
      }
      // drop → field silently removed by the doc rewrite anyway.
    }
  }

  // --- document outcomes ---------------------------------------------------------
  // id-target map for relation retargets and VD check resolution.
  const newIdOf = new Map<string, string>();
  const durableTargetOf = new Map<string, { target: string; type: string }>();
  const removedPaths = new Set<string>(plan.migration.removals.filter((item) => item.when === "at-finalize").map((item) => item.path));
  const addRemoval = (rel: string, dir = false): void => {
    removedPaths.add(rel);
    world.removals.push({ path: rel, dir });
  };

  const docDecisions = new Map<string, Record<string, unknown>>();
  for (const decision of plan.migration.semanticDecisions.filter((item) => item.element === "document" || item.element === "file")) {
    const value = resolvedValue(ctx, decision);
    if (value !== null) docDecisions.set(decision.path, { ...docDecisions.get(decision.path), [decision.kind]: value });
  }

  // id-assignment / id-collision overrides.
  const idOverride = (docPath: string): string | null => {
    for (const decision of decisionsFor(ctx, docPath).filter((item) => item.kind === "id-assignment" || item.kind === "id-collision")) {
      const value = resolvedValue(ctx, decision);
      if (typeof value?.id === "string") return value.id;
    }
    return null;
  };
  const targetOverride = (docPath: string): string | null => {
    for (const decision of decisionsFor(ctx, docPath).filter((item) => item.kind === "target-collision")) {
      const value = resolvedValue(ctx, decision);
      if (typeof value?.target === "string") return value.target;
    }
    return null;
  };

  // Field values a durable write needs — resolution or fm, never invented.
  const durableFm = (
    doc: InventoryDocument,
    type: string,
    extras: Record<string, unknown>,
    sourcePath: string,
  ): { data: Record<string, unknown> | null; missing: string[] } => {
    const fm = rawOf(sourcePath).data;
    const config = configs[type as keyof typeof configs];
    const missing: string[] = [];
    const declared = (name: string, fromFm: string | null, vocab?: readonly string[]): string | null => {
      const override = extras[name];
      if (typeof override === "string") return override;
      // A missing-field / status-mapping / lifecycle decision on the source.
      const fieldDecision = name === "status"
        ? decisionValue(ctx, sourcePath, "status-mapping", "frontmatter.status")
        : name === "lifecycle"
          ? decisionValue(ctx, sourcePath, "lifecycle-assignment", "frontmatter.lifecycle")
          : decisionValue(ctx, sourcePath, "missing-field", `frontmatter.${name}`);
      if (fieldDecision !== null) {
        const declared = typeof fieldDecision.value === "string" ? fieldDecision.value
          : typeof fieldDecision.status === "string" ? fieldDecision.status
            : typeof fieldDecision.lifecycle === "string" ? fieldDecision.lifecycle : null;
        if (declared !== null) return declared;
      }
      if (fromFm !== null && (vocab === undefined || vocab.includes(fromFm))) return fromFm;
      return null;
    };
    const status = declared("status", doc.status, config?.statusValues as readonly string[]);
    const lifecycle = declared("lifecycle", doc.lifecycle, LIFECYCLE_VALUES as readonly string[]);
    const title = declared("title", doc.title ?? firstH1(rawOf(sourcePath).body));
    const created = declared("created", stringField(fm, "created"));
    const updated = declared("updated", stringField(fm, "updated") ?? created);
    if (status === null) missing.push("status");
    if (lifecycle === null) missing.push("lifecycle");
    if (title === null) missing.push("title");
    if (created === null) missing.push("created");
    if (updated === null) missing.push("updated");
    if (missing.length > 0) return { data: null, missing };
    // The converted document's id is the one the plan computed — a legacy
    // source id (TS-0001, IR-0007) is never a valid v3 id for the target
    // type; convertedId maps it deterministically (VD-0001, KNOW-0007).
    const id = idOverride(sourcePath) ?? (typeof extras.id === "string" ? extras.id : null)
      ?? convertedId(doc.id, sourcePath, config?.idPrefix ?? "DOC");
    const data: Record<string, unknown> = {
      id,
      type,
      status,
      lifecycle,
      title,
      created,
      updated,
      owners: Array.isArray(fm.owners) ? fm.owners : [],
    };
    return { data, missing };
  };

  // Relation ops shared by converted + edited docs.
  const relationOps = (doc: InventoryDocument, targetType: string | null):
    { relations: Record<string, string[]>; notes: string[] } => {
    const fm = rawOf(doc.path).data;
    const { entries } = relationEntries(fm);
    const relations: Record<string, string[]> = {};
    const notes: string[] = [];
    const allowed = targetType === null ? null : new Set(
      (configs[targetType as keyof typeof configs]?.allowedRelations ?? []).map((item) => item.field),
    );
    for (const entry of entries) {
      const field = entry.field;
      if (nonReferenceRelationKeys.has(field) || (PROVENANCE_RELATION_KEYS as readonly string[]).includes(field)) {
        if (entry.targets.length > 0) relations[field] = [...entry.targets];
        continue;
      }
      if (field === "verifies" && doc.disposition === "convert:verification") continue; // → checks[]
      if (doc.disposition === "convert:run-task" && (field === "implements" || field === "depends-on" || field === "depends_on")) continue;
      if (doc.disposition === "convert:run-plan" || doc.disposition === "convert:run-task") continue; // run-bound fm leaves Git
      if (entry.targets.length === 0) continue; // empty legacy drops
      if (field === "verified-by") continue; // check refs, never a stored relation
      const decisions = decisionsFor(ctx, doc.path).filter((item) => item.element === `relations.${field}`);
      const v1 = V1_RELATION_FIELDS.has(field);
      const unresolved = decisions.find((item) => item.kind === "unresolved-relation-target");
      const legacyTarget = decisions.find((item) => item.kind === "legacy-relation-target");
      const legacy = decisions.find((item) => item.kind === "legacy-relation");
      const malformed = decisions.find((item) => item.kind === "malformed-relation-value");
      if (malformed !== undefined) {
        const value = resolvedValue(ctx, malformed);
        if (value?.action === "drop") continue;
        ctx.errors.push(`${doc.path}: relations.${field} malformed payload has no executable resolution`);
        continue;
      }
      if (v1) {
        const targets = [...entry.targets];
        if (unresolved !== undefined) {
          const value = resolvedValue(ctx, unresolved);
          const broken = new Set(unresolved.targets ?? []);
          if (value?.action === "drop") {
            for (const target of broken) targets.splice(targets.indexOf(target), 1);
          } else if (value?.action === "retarget" && Array.isArray(value.targets)) {
            const kept = targets.filter((target) => !broken.has(target));
            targets.length = 0;
            targets.push(...kept, ...(value.targets as string[]));
          }
        }
        if (legacyTarget !== undefined) {
          const value = resolvedValue(ctx, legacyTarget);
          const converting = new Set(legacyTarget.targets ?? []);
          if (value?.action === "drop") {
            for (const target of converting) {
              const at = targets.indexOf(target);
              if (at >= 0) targets.splice(at, 1);
            }
          } else if (value?.action === "retarget") {
            for (let index = 0; index < targets.length; index += 1) {
              const resolved = resolveDocRef(ctx, doc, targets[index]);
              if (resolved !== null && converting.has(targets[index])) {
                const newId = newIdOf.get(resolved) ?? null;
                if (newId !== null) targets[index] = newId;
                else ctx.errors.push(`${doc.path}: relations.${field} target ${targets[index]} has no converted destination`);
              }
            }
          }
        }
        if (targets.length > 0) relations[field] = sortStrings(new Set(targets));
        continue;
      }
      if (legacy !== undefined) {
        const value = resolvedValue(ctx, legacy);
        if (value?.action === "map" && typeof value.field === "string") {
          if (allowed !== null && !allowed.has(value.field)) {
            ctx.errors.push(`${doc.path}: relations.${field} maps to ${value.field}, not allowed on ${targetType}`);
          } else {
            const targets = Array.isArray(value.targets) ? (value.targets as string[]) : entry.targets;
            relations[value.field] = sortStrings(new Set([...(relations[value.field] ?? []), ...targets]));
          }
        } else if (value?.action === "note") {
          notes.push(`pre-v3 relation \`${field}\` targets: ${entry.targets.join(", ")}`);
        }
        // drop → removed
        continue;
      }
      // Populated legacy field with no decision: only on docs whose whole
      // disposition keeps them — leave unmanaged/preserved content alone.
      relations[field] = [...entry.targets];
    }
    return { relations, notes };
  };

  // Primary outcomes — convert/preserve/decision — recorded for sibling
  // resolution and relation retargets.
  const primaryOutcome = new Map<string, { target: string | null; type: string | null; removal: boolean }>();

  const docPasses: InventoryDocument[] = plan.inventory.documents.filter((doc) => doc.localeSiblingOf === null);
  for (const doc of docPasses) {
    const fm = rawOf(doc.path).data;
    const declaredKinds = docDecisions.get(doc.path) ?? {};

    // --- decision-disposition docs ---
    if (doc.disposition === "decision") {
      const untyped = declaredKinds["untyped-legacy-doc"] as Record<string, unknown> | undefined;
      const unknownType = declaredKinds["unknown-type"] as Record<string, unknown> | undefined;
      const placement = declaredKinds["doc-placement"] as Record<string, unknown> | undefined;
      const broken = declaredKinds["unreadable-input"] ?? declaredKinds["unparseable-frontmatter"] ?? declaredKinds["malformed-frontmatter"];
      if (broken !== undefined) {
        // discard → removal; anything else was blocked at normalization.
        addRemoval(doc.path);
        primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
        continue;
      }
      if (untyped !== undefined) {
        if (untyped.action === "leave") {
          primaryOutcome.set(doc.path, { target: doc.path, type: null, removal: false });
          continue;
        }
        if (untyped.action === "trace") {
          trace(doc.path, "untyped-doc", { body: rawOf(doc.path).body, data: fm });
          addRemoval(doc.path);
          primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
          continue;
        }
        if (untyped.action === "knowledge") {
          const build = durableFm(doc, "knowledge", untyped, doc.path);
          if (build.data === null) {
            ctx.errors.push(`${doc.path}: knowledge conversion needs declared ${build.missing.join("/")} in the resolution`);
            continue;
          }
          build.data.knowledge_kind = String(untyped.kind);
          const target = `docs/knowledge/${path.posix.basename(doc.path)}`;
          durableTargetOf.set(doc.path, { target, type: "knowledge" });
          newIdOf.set(doc.path, String(build.data.id));
          world.docWrites.push({ source: doc.path, target, kind: "create", data: build.data, body: rawOf(doc.path).body });
          addRemoval(doc.path);
          world.touchedPaths.add(target);
          primaryOutcome.set(doc.path, { target, type: "knowledge", removal: true });
          continue;
        }
        ctx.errors.push(`${doc.path}: untyped-legacy-doc resolution ${JSON.stringify(untyped.action)} is not executable`);
        continue;
      }
      if (unknownType !== undefined) {
        if (unknownType.action === "preserve") {
          primaryOutcome.set(doc.path, { target: doc.path, type: doc.type, removal: false });
          continue;
        }
        if (unknownType.action === "discard") {
          addRemoval(doc.path);
          primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
          continue;
        }
        if (unknownType.action === "declare" && typeof unknownType.type === "string") {
          const type = unknownType.type;
          const config = configs[type as keyof typeof configs];
          const canonical = config.dirs[0];
          const sameDir = config.dirs.map(normalizeDir).includes(normalizeDir(path.posix.dirname(doc.path)));
          const target = sameDir ? doc.path : `${canonical}/${path.posix.basename(doc.path)}`;
          const build = durableFm(doc, type, unknownType, doc.path);
          if (build.data === null) {
            ctx.errors.push(`${doc.path}: declare-target-type ${type} needs declared ${build.missing.join("/")} in the resolution`);
            continue;
          }
          durableTargetOf.set(doc.path, { target, type });
          newIdOf.set(doc.path, String(build.data.id));
          const { relations, notes } = relationOps(doc, type);
          if (Object.keys(relations).length > 0) build.data.relations = relations;
          const body = notes.length > 0 ? `${rawOf(doc.path).body}\n\n## Migration note\n\n${notes.map((note) => `- ${note}`).join("\n")}\n` : rawOf(doc.path).body;
          world.docWrites.push({ source: doc.path, target, kind: "create", data: build.data, body });
          if (target !== doc.path) addRemoval(doc.path);
          world.touchedPaths.add(target);
          primaryOutcome.set(doc.path, { target, type, removal: target !== doc.path });
          continue;
        }
        ctx.errors.push(`${doc.path}: unknown-type resolution ${JSON.stringify(unknownType.action)} is not executable`);
        continue;
      }
      if (placement !== undefined) {
        if (placement.action === "keep") {
          // A doc left in a migration-owned dir keeps the legacy marker the
          // postflight preflight counts — the migration could never finish.
          // Outside managed scope, "keep" is a true no-op: the doc and its
          // accepted lint finding stay exactly where they are.
          if (new Set(managedDocDirs()).has(normalizeDir(path.posix.dirname(doc.path)))) {
            ctx.errors.push(
              `${doc.path}: keep-and-accept-finding cannot execute — ${path.posix.dirname(doc.path)} is migration-owned, so the doc staying leaves the legacy marker in place; choose move-to-canonical-dir or remove the doc`,
            );
            continue;
          }
          world.acceptedPaths.add(doc.path);
          primaryOutcome.set(doc.path, { target: doc.path, type: doc.resolvedType, removal: false });
          continue;
        }
        if (placement.action === "move") {
          const type = doc.resolvedType!;
          const config = configs[type as keyof typeof configs];
          const target = `${config.dirs[0]}/${path.posix.basename(doc.path)}`;
          if (fs.existsSync(path.join(ctx.cwd, target)) && target !== doc.path) {
            ctx.errors.push(`${doc.path}: move-to-canonical-dir target ${target} already exists`);
            continue;
          }
          const build = durableFm(doc, type, placement, doc.path);
          if (build.data === null) {
            ctx.errors.push(`${doc.path}: moved doc needs declared ${build.missing.join("/")}`);
            continue;
          }
          durableTargetOf.set(doc.path, { target, type });
          const { relations, notes } = relationOps(doc, type);
          if (Object.keys(relations).length > 0) build.data.relations = relations;
          const body = notes.length > 0 ? `${rawOf(doc.path).body}\n\n## Migration note\n\n${notes.map((note) => `- ${note}`).join("\n")}\n` : rawOf(doc.path).body;
          world.docWrites.push({ source: doc.path, target, kind: "create", data: build.data, body });
          addRemoval(doc.path);
          world.touchedPaths.add(target);
          primaryOutcome.set(doc.path, { target, type, removal: true });
          continue;
        }
      }
      ctx.errors.push(`${doc.path}: decision disposition has no executable resolution`);
      continue;
    }

    // --- out-of-scope unmanaged docs: untouched ----------------------------
    if (doc.disposition === "out-of-scope") {
      primaryOutcome.set(doc.path, { target: doc.path, type: doc.resolvedType, removal: false });
      continue;
    }

    // --- run-bound plan/task -------------------------------------------------
    if (doc.disposition === "convert:run-plan" || doc.disposition === "convert:run-task") {
      world.removals.push({ path: doc.path, dir: false });
      removedPaths.add(doc.path);
      primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
      continue;
    }

    // --- converts to durable ---------------------------------------------------
    if (doc.disposition === "convert:verification" || doc.disposition === "classify") {
      let type = doc.disposition === "convert:verification" ? "verification" : "knowledge";
      let classification: Record<string, unknown> | null = null;
      if (doc.disposition === "classify") {
        const decision = decisionsFor(ctx, doc.path, "ir-classification")[0] ?? decisionsFor(ctx, doc.path, "exp-classification")[0];
        classification = decision === undefined ? null : resolvedValue(ctx, decision);
        if (classification === null) {
          ctx.errors.push(`${doc.path}: no classification resolution`);
          continue;
        }
        if (classification.action === "trace") {
          trace(doc.path, "impl-body", { body: rawOf(doc.path).body, data: fm });
          addRemoval(doc.path);
          primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
          continue;
        }
        if (classification.action === "discard") {
          addRemoval(doc.path);
          primaryOutcome.set(doc.path, { target: null, type: null, removal: true });
          continue;
        }
        if (classification.action === "durable" && typeof classification.type === "string") {
          type = classification.type;
        } else if (classification.action === "evidence-candidate" || classification.action === "knowledge") {
          type = "knowledge";
        }
      }
      const override = targetOverride(doc.path);
      const stem = path.posix.basename(doc.path).replace(/\.md$/i, "");
      const defaultDir = type === "verification" ? "docs/verification" : configs[type as keyof typeof configs].dirs[0];
      const target = override ?? `${defaultDir}/${stem}.md`;
      const build = durableFm(doc, type, classification ?? {}, doc.path);
      if (build.data === null) {
        ctx.errors.push(`${doc.path}: converted ${type} doc needs declared ${build.missing.join("/")}`);
        continue;
      }
      if (type === "knowledge") {
        const kindValue = typeof classification?.kind === "string" ? classification.kind : stringField(fm, "knowledge_kind");
        if (kindValue === null) {
          ctx.errors.push(`${doc.path}: knowledge conversion needs { kind: "<knowledge_kind>" }`);
          continue;
        }
        build.data.knowledge_kind = kindValue;
      }
      const { relations, notes } = relationOps(doc, type);
      if (Object.keys(relations).length > 0) build.data.relations = relations;
      // Verification Design: explicit check bindings from the resolutions.
      let body = rawOf(doc.path).body;
      if (type === "verification") {
        const checks: VerificationCheckV1[] = [];
        const usedIds = new Set<string>();
        const bindingDecisions = decisionsFor(ctx, doc.path, "check-binding");
        for (const decision of bindingDecisions) {
          const value = resolvedValue(ctx, decision);
          if (value?.action !== "checks") continue;
          for (const entry of value.checks as unknown[]) {
            const { check, issues } = parseCheckInput(JSON.stringify(entry));
            if (check === null) {
              ctx.errors.push(`${doc.path}: check binding ${decision.decisionId} failed validation — ${issues.map((issue) => issue.message).join("; ")}`);
              continue;
            }
            let id = check.id;
            if (id === "") {
              let next = usedIds.size + 1;
              while (usedIds.has(`CHK-${String(next).padStart(2, "0")}`)) next += 1;
              id = `CHK-${String(next).padStart(2, "0")}`;
            }
            if (usedIds.has(id)) {
              ctx.errors.push(`${doc.path}: duplicate check id ${id} in check bindings`);
              continue;
            }
            usedIds.add(id);
            checks.push({ ...check, id });
          }
        }
        if (checks.length > 0) build.data.checks = checks.map((check) => ({
          id: check.id,
          target: check.target,
          method: check.method,
          implementation: check.implementation,
          preconditions: check.preconditions,
          passCriteria: check.passCriteria,
          limitations: check.limitations,
          required: check.required,
        }));
        // `verifies` / bound sections are consumed by checks — nothing else
        // to drop; body prose is verbatim.
      }
      // evidence-admission on impl docs: admit → provenance flag, discard →
      // strip the validation section, keep → verbatim.
      const admission = decisionValue(ctx, doc.path, "evidence-admission", "body.validation");
      let evidenceCandidate = classification?.action === "evidence-candidate";
      if (admission?.action === "discard") {
        body = stripValidationSection(body) ?? body;
      } else if (admission?.action === "admit") {
        evidenceCandidate = true;
      }
      const unmapped = Object.fromEntries(
        Object.keys(fm).filter((field) => !KNOWN_FM_FIELDS.has(field)).sort(compareCodeUnits)
          .map((field) => [field, fm[field]]),
      );
      build.data.metadata = {
        ...(isPlainObject(fm.metadata) ? fm.metadata : {}),
        migration: {
          source: doc.path,
          sourceId: doc.id ?? null,
          planHash: ctx.plan.plan.planHash.slice(0, 16),
          ...(Object.keys(unmapped).length > 0 ? { unmapped } : {}),
          ...(evidenceCandidate ? { evidenceCandidate: true } : {}),
        },
      };
      if (notes.length > 0) {
        body = `${body}\n\n## Migration note\n\n${notes.map((note) => `- ${note}`).join("\n")}\n`;
      }
      durableTargetOf.set(doc.path, { target, type });
      newIdOf.set(doc.path, String(build.data.id));
      world.docWrites.push({ source: doc.path, target, kind: "create", data: build.data, body });
      world.removals.push({ path: doc.path, dir: false });
      removedPaths.add(doc.path);
      world.touchedPaths.add(target);
      primaryOutcome.set(doc.path, { target, type, removal: true });
      continue;
    }

    // --- preserved durable docs: normalize fm + retarget links in place ----
    const build = editableDoc(ctx, doc, rawOf, relationOps, durableFm, idOverride, {});
    if (build !== null) {
      world.docWrites.push(build);
      world.touchedPaths.add(doc.path);
    }
    primaryOutcome.set(doc.path, { target: doc.path, type: doc.resolvedType, removal: false });
  }

  // --- locale siblings ride the primary's outcome ------------------------------
  for (const doc of plan.inventory.documents.filter((item) => item.localeSiblingOf !== null)) {
    const primaryPath = doc.localeSiblingOf!;
    const outcome = primaryOutcome.get(primaryPath);
    if (outcome === undefined || outcome.target === null) {
      // primary converted into the store / discarded — sibling leaves with it.
      if (outcome?.removal === true || outcome === undefined) {
        if (!removedPaths.has(doc.path)) world.removals.push({ path: doc.path, dir: false });
        removedPaths.add(doc.path);
      }
      continue;
    }
    const localeExt = /\.([a-z]{2})\.md$/i.exec(path.posix.basename(doc.path))?.[1]?.toLowerCase() ?? "locale";
    if (outcome.removal === false && outcome.target === primaryPath) {
      // Preserved primary — sibling stays; normalize its fm if it changes.
      const build = editableDoc(ctx, doc, rawOf, relationOps, durableFm, idOverride, {});
      if (build !== null) {
        world.docWrites.push(build);
        world.touchedPaths.add(doc.path);
      }
      continue;
    }
    // Converted primary — sibling lands beside the converted target.
    const siblingTarget = outcome.target.replace(/\.md$/i, `.${localeExt}.md`);
    const fm = rawOf(doc.path).data;
    const build = durableFm(doc, outcome.type ?? "knowledge", {}, doc.path);
    if (build.data === null) {
      ctx.errors.push(`${doc.path}: locale sibling needs ${build.missing.join("/")} — declare them via the primary's resolution`);
      continue;
    }
    build.data.id = newIdOf.get(primaryPath) ?? build.data.id;
    const { relations, notes } = relationOps(doc, outcome.type);
    if (Object.keys(relations).length > 0) build.data.relations = relations;
    const unmapped = Object.fromEntries(
      Object.keys(fm).filter((field) => !KNOWN_FM_FIELDS.has(field)).sort(compareCodeUnits)
        .map((field) => [field, fm[field]]),
    );
    build.data.metadata = {
      ...(isPlainObject(fm.metadata) ? fm.metadata : {}),
      migration: { source: doc.path, sourceId: doc.id ?? null, planHash: ctx.plan.plan.planHash.slice(0, 16), localeSiblingOf: primaryPath, ...(Object.keys(unmapped).length > 0 ? { unmapped } : {}) },
    };
    let body = rawOf(doc.path).body;
    if (notes.length > 0) body = `${body}\n\n## Migration note\n\n${notes.map((note) => `- ${note}`).join("\n")}\n`;
    world.docWrites.push({ source: doc.path, target: siblingTarget, kind: "create", data: build.data, body });
    world.removals.push({ path: doc.path, dir: false });
    removedPaths.add(doc.path);
    world.touchedPaths.add(siblingTarget);
  }

  // --- body link retargets over every written doc -------------------------------
  const renameMap = new Map<string, string>();
  for (const [source, outcome] of durableTargetOf) renameMap.set(source, outcome.target);
  for (const write of world.docWrites) {
    write.body = retargetLinks(write.body, write.source, write.target, renameMap);
  }

  // --- experiment logs -------------------------------------------------------------
  for (const exp of plan.inventory.experimentLogs) {
    const decision = decisionsFor(ctx, exp.path, "exp-classification")[0];
    const value = decision === undefined ? null : resolvedValue(ctx, decision);
    const action = value?.action ?? "trace"; // clean logs default to the convertible trace
    if (action === "discard") {
      world.removals.push({ path: exp.path, dir: false });
      removedPaths.add(exp.path);
      continue;
    }
    if (action === "knowledge" || action === "evidence-candidate" || action === "durable") {
      const type = action === "durable" && typeof value?.type === "string" ? value.type : "knowledge";
      const stem = path.posix.basename(exp.path).replace(/\.jsonl$/i, "");
      const target = `${configs[type as keyof typeof configs].dirs[0]}/${stem}.md`;
      const fm = rawOf(exp.path);
      const pseudo: InventoryDocument = {
        path: exp.path, sha256: exp.sha256, kind: "legacy", type: "exp", resolvedType: "exp",
        id: null, status: null, lifecycle: null, title: null, owner: null,
        dirKind: "migration-owned", fields: [], legacyRelationFields: [],
        malformedRelationFields: [], bookkeepingFields: [],
        localeSiblingOf: null, localeSiblings: [], parseError: null, disposition: "classify",
      };
      const build = durableFm(pseudo, type, value ?? {}, exp.path);
      if (build.data === null) {
        ctx.errors.push(`${exp.path}: exp → ${type} needs declared ${build.missing.join("/")} in the resolution`);
        continue;
      }
      if (type === "knowledge") {
        if (typeof value?.kind !== "string") {
          ctx.errors.push(`${exp.path}: exp → knowledge needs { kind: "<knowledge_kind>" }`);
          continue;
        }
        build.data.knowledge_kind = value.kind;
      }
      const rawText = fm.raw;
      build.data.metadata = {
        migration: { source: exp.path, sourceId: null, planHash: ctx.plan.plan.planHash.slice(0, 16), ...(action === "evidence-candidate" ? { evidenceCandidate: true } : {}) },
      };
      const body = `# ${path.posix.basename(exp.path)}\n\nMigrated experiment log (JSONL, verbatim):\n\n\`\`\`jsonl\n${rawText.trimEnd()}\n\`\`\`\n`;
      durableTargetOf.set(exp.path, { target, type });
      newIdOf.set(exp.path, String(build.data.id));
      world.docWrites.push({ source: exp.path, target, kind: "create", data: build.data, body });
      world.touchedPaths.add(target);
    } else {
      // diagnostic-trace (default or explicit): every line verbatim.
      const raw = fs.readFileSync(path.join(ctx.cwd, exp.path), "utf8");
      raw.split(/\r?\n/).filter((line) => line.trim() !== "").forEach((line, index) => {
        let event: unknown;
        try { event = JSON.parse(line); } catch { event = { raw: line, malformed: true }; }
        trace(exp.path, "exp-event", { line: index + 1, event });
      });
    }
    world.removals.push({ path: exp.path, dir: false });
    removedPaths.add(exp.path);
  }

  // --- indexes ----------------------------------------------------------------------
  for (const index of plan.inventory.indexes) {
    if (index.disposition === "regenerate") {
      world.indexJobs.push({ path: index.path, dir: index.dir });
      world.touchedPaths.add(index.path);
      continue;
    }
    if (index.disposition === "remove") {
      world.removals.push({ path: index.path, dir: false });
      removedPaths.add(index.path);
      continue;
    }
    const decision = decisionsFor(ctx, index.path, "hand-curated-index")[0];
    const value = decision === undefined ? null : resolvedValue(ctx, decision);
    if (value?.action === "adopt") {
      world.indexJobs.push({ path: index.path, dir: index.dir });
      world.touchedPaths.add(index.path);
    } else if (value?.action === "extract") {
      const stem = path.posix.basename(index.dir);
      const target = `docs/knowledge/index-${stem === "." ? "root" : stem}-${hashId(`idx:${index.path}`).slice(0, 6)}.md`;
      const pseudo: InventoryDocument = {
        path: index.path, sha256: "", kind: "untyped", type: null, resolvedType: null,
        id: null, status: null, lifecycle: null, title: null, owner: null,
        dirKind: "migration-owned", fields: [], legacyRelationFields: [],
        malformedRelationFields: [], bookkeepingFields: [],
        localeSiblingOf: null, localeSiblings: [], parseError: null, disposition: "classify",
      };
      const build = durableFm(pseudo, "knowledge", value, index.path);
      if (build.data === null) {
        ctx.errors.push(`${index.path}: extract-to-knowledge needs declared ${build.missing.join("/")} in the resolution`);
        continue;
      }
      build.data.knowledge_kind = String(value.kind);
      const rawText = fs.readFileSync(path.join(ctx.cwd, index.path), "utf8");
      const body = `# ${index.path} (extracted)\n\nHand-curated index content preserved verbatim at migration:\n\n${rawText.trimEnd()}\n`;
      build.data.metadata = { migration: { source: index.path, sourceId: null, planHash: ctx.plan.plan.planHash.slice(0, 16) } };
      world.docWrites.push({ source: index.path, target, kind: "create", data: build.data, body });
      world.touchedPaths.add(target);
      world.removals.push({ path: index.path, dir: false });
      removedPaths.add(index.path);
    } else if (value?.action === "discard") {
      world.removals.push({ path: index.path, dir: false });
      removedPaths.add(index.path);
    }
    // keep-unmanaged → untouched.
  }

  // --- foreign state -------------------------------------------------------------------
  for (const entry of plan.inventory.foreignState) {
    if (entry.kind === "escape") continue; // plan is blocked — gate refuses first
    if (isUnderDir(entry.path, DOC_DRIVEN_DEV_DIR)) {
      const content = readTextOrNull(ctx.cwd, entry.path);
      trace(entry.path, "legacy-state", { detail: entry.detail, content });
      world.removals.push({ path: entry.path, dir: entry.kind === "dir" });
      removedPaths.add(entry.path);
      continue;
    }
    const decision = decisionsFor(ctx, entry.path, "foreign-state-disposition")[0];
    const value = decision === undefined ? null : resolvedValue(ctx, decision);
    if (value?.action === "trace") {
      const content = entry.kind === "corrupt-run" || entry.kind === "dir"
        ? collectDirText(ctx.cwd, entry.path)
        : readTextOrNull(ctx.cwd, entry.path);
      trace(entry.path, "foreign-state", { detail: entry.detail, content });
    }
    world.removals.push({ path: entry.path, dir: entry.kind === "dir" || entry.kind === "corrupt-run" });
    removedPaths.add(entry.path);
  }

  // Plan-declared removals that no resolution covered — `when:"decision"`
  // rows land only when their doc's resolution removed it.
  const decidedRemovals = new Set(plan.migration.removals.filter((item) => item.when === "decision").map((item) => item.path));
  for (const rel of decidedRemovals) {
    if (removedPaths.has(rel)) continue;
    const outcome = primaryOutcome.get(rel);
    if (outcome !== undefined && outcome.removal === false) continue; // kept by resolution
    if (outcome === undefined) {
      // No outcome recorded (e.g. an already-handled sibling) — safe default
      // is to keep the file and surface it in the report rather than delete.
      continue;
    }
  }

  // --- existing-run handoffs --------------------------------------------------------------
  const migratedIds = new Set(runById.keys());
  for (const run of plan.inventory.runs) {
    if (!run.validManifest) continue;
    const declared = ctx.handoffs.get(run.runId);
    if (run.status === "active" && declared === undefined) {
      ctx.errors.push(`existing active run ${run.runId} has no declared handoff (keep|export|finalize)`);
      continue;
    }
    if (declared === undefined || declared.method === "keep") continue;
    if (declared.method === "export") {
      world.exports.push({ runId: run.runId, out: declared.out! });
    } else if (declared.method === "finalize") {
      world.handoffs.push({ runId: run.runId, status: declared.status! });
    }
  }
  for (const runId of migratedIds) {
    const declared = ctx.handoffs.get(runId);
    if (declared === undefined || declared.method === "keep") continue;
    if (declared.method === "export") {
      world.exports.push({ runId, out: declared.out! });
    } else if (declared.method === "finalize") {
      const spec = runById.get(runId);
      if (spec !== undefined && spec.status !== declared.status) {
        ctx.errors.push(`run ${runId}: handoff finalize status ${declared.status} contradicts the run-status resolution ${spec.status}`);
        continue;
      }
      world.handoffs.push({ runId, status: declared.status! });
    }
  }

  // Existing runs an assign-to-run targeted get record steps at finalize.
  for (const record of world.existingRecords) {
    if (migratedIds.has(record.runId)) {
      // A migrated run's records ride inside its export document instead.
      const spec = runById.get(record.runId)!;
      if (record.kind === "receipt") spec.receipts.push({ receiptId: (record.record as ReceiptRecord).receiptId, record: record.record as ReceiptRecord });
      else spec.checkpoints.push({ checkpointId: (record.record as CheckpointRecord).checkpointId, record: record.record as CheckpointRecord });
    }
  }
  world.existingRecords = world.existingRecords.filter((record) => !migratedIds.has(record.runId));
  for (const record of world.existingRecords) {
    const run = plan.inventory.runs.find((item) => item.runId === record.runId);
    if (run === undefined || !run.validManifest) {
      ctx.errors.push(`bookkeeping record targets unknown run ${record.runId}`);
      continue;
    }
    if (run.status !== "active") {
      ctx.errors.push(`bookkeeping record targets finalized run ${record.runId} — records cannot be appended`);
    }
  }

  // An export target that names a pinned input would overwrite migration
  // source bytes at finalize — this is the boundary that knows the pins.
  const pinnedInputs = new Set(plan.inventory.inputFiles.map(normalizeDir));
  for (const item of world.exports) {
    if (pinnedInputs.has(normalizeDir(item.out))) {
      ctx.errors.push(`run ${item.runId}: export target ${item.out} collides with a pinned migration input`);
    }
  }

  world.runs = [...runById.values()].sort((a, b) => compareCodeUnits(a.runId, b.runId));
  return world;
}

// A preserved doc's edited form — returns null only when required
// front-matter fields cannot be resolved (the gap is recorded in
// ctx.errors); every other doc comes back as a normalized write.
function editableDoc(
  ctx: WorldCtx,
  doc: InventoryDocument,
  rawOf: (rel: string) => RawDoc,
  relationOps: (doc: InventoryDocument, targetType: string | null) => { relations: Record<string, string[]>; notes: string[] },
  durableFm: (doc: InventoryDocument, type: string, extras: Record<string, unknown>, sourcePath: string) => { data: Record<string, unknown> | null; missing: string[] },
  idOverride: (docPath: string) => string | null,
  extras: Record<string, unknown>,
): DocWrite | null {
  const fm = rawOf(doc.path).data;
  const type = doc.resolvedType ?? "knowledge";
  const build = durableFm(doc, type, extras, doc.path);
  if (build.data === null) {
    ctx.errors.push(`${doc.path}: preserved doc needs declared ${build.missing.join("/")} (resolution params on its disposition decision)`);
    return null;
  }
  const { relations, notes } = relationOps(doc, type);
  const data: Record<string, unknown> = { ...build.data };
  if (Object.keys(relations).length > 0 || fm.relations !== undefined) data.relations = relations;
  else if (fm.relations === undefined) data.relations = {};
  if (typeof fm.knowledge_kind === "string" && type === "knowledge") data.knowledge_kind = fm.knowledge_kind;
  if (fm.checks !== undefined && type === "verification") data.checks = fm.checks;
  if (fm.metadata !== undefined) data.metadata = fm.metadata;
  const overrideId = idOverride(doc.path);
  if (overrideId !== null) data.id = overrideId;
  // Unmapped extra fields carry verbatim on preserved docs.
  for (const field of Object.keys(fm).sort(compareCodeUnits)) {
    if (KNOWN_FM_FIELDS.has(field)) continue;
    data[field] = fm[field];
  }
  let body = rawOf(doc.path).body;
  if (notes.length > 0) body = `${body}\n\n## Migration note\n\n${notes.map((note) => `- ${note}`).join("\n")}\n`;
  return { source: doc.path, target: doc.path, kind: "edit", data, body };
}

function stripValidationSection(body: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s+(Validation|Verification)\b/.test(line));
  if (start < 0) return null;
  const level = /^#{1,6}/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^#{1,6}\s/.exec(lines[index]);
    if (match && match[0].trim().length <= level) { end = index; break; }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

// Resolve a document reference against the inventory corpus — mirrors the
// plan's resolution rules (path, relative path, unique id).
function resolveDocRef(ctx: WorldCtx, from: InventoryDocument, target: string): string | null {
  const trimmed = target.trim();
  if (trimmed === "" || trimmed.includes("::")) return null;
  if (trimmed.includes("/") || trimmed.endsWith(".md")) {
    const direct = ctx.byPath.get(normalizeDir(trimmed));
    if (direct) return direct.path;
    const rel = normalizeDir(path.posix.normalize(path.posix.join(path.posix.dirname(from.path), trimmed)));
    return ctx.byPath.has(rel) ? rel : null;
  }
  const docs = plan_docsById(ctx).get(trimmed) ?? [];
  return docs.length === 1 ? docs[0].path : null;
}

const byIdCache = new WeakMap<WorldCtx, Map<string, InventoryDocument[]>>();
function plan_docsById(ctx: WorldCtx): Map<string, InventoryDocument[]> {
  const cached = byIdCache.get(ctx);
  if (cached) return cached;
  const map = new Map<string, InventoryDocument[]>();
  for (const doc of ctx.plan.inventory.documents) {
    if (doc.id === null) continue;
    map.set(doc.id, [...(map.get(doc.id) ?? []), doc]);
  }
  byIdCache.set(ctx, map);
  return map;
}

function retargetLinks(body: string, sourcePath: string, targetPath: string, renameMap: Map<string, string>): string {
  return body.replace(LINK_PATTERN, (whole, link: string) => {
    const trimmed = link.trim();
    if (trimmed === "" || trimmed.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmed)) return whole;
    const resolved = normalizeDir(path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), trimmed.split("#")[0])));
    const target = renameMap.get(resolved);
    if (target === undefined) return whole;
    const fragment = trimmed.includes("#") ? `#${trimmed.split("#").slice(1).join("#")}` : "";
    const rel = path.posix.relative(path.posix.dirname(targetPath), target);
    return whole.replace(`(${link})`, `(${rel}${fragment})`);
  });
}

function readTextOrNull(cwd: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(cwd, rel), "utf8");
  } catch {
    return null;
  }
}

function collectDirText(cwd: string, rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  walkTree(cwd, rel, (file, isDir) => {
    if (isDir) return;
    const content = readTextOrNull(cwd, file);
    if (content !== null) out[file] = content;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rendering — canonical fm order matches the doc-suite's own writers
// ---------------------------------------------------------------------------

const FM_ORDER = [
  "id", "type", "status", "lifecycle", "title", "created", "updated",
  "owners", "relations", "checks", "knowledge_kind",
];

function orderedFrontMatter(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FM_ORDER) {
    if (key in data && data[key] !== undefined) out[key] = data[key];
  }
  for (const key of Object.keys(data).sort(compareCodeUnits)) {
    if (!(key in out) && key !== "metadata" && data[key] !== undefined) out[key] = data[key];
  }
  if (data.metadata !== undefined) out.metadata = data.metadata;
  return out;
}

function renderDoc(data: Record<string, unknown>, body: string): string {
  const rendered = matter.stringify(body, orderedFrontMatter(data));
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

// ---------------------------------------------------------------------------
// Export-document construction — migrated plans/tasks become portable run
// snapshots; importRun's own integrity chain re-verifies every byte.
// ---------------------------------------------------------------------------

function buildRunExportDocument(
  cwd: string,
  spec: RunSpec,
  planBody: string | null,
  diagnostics: Record<string, unknown>[],
  now: Clock,
): { document: RunExport; bytes: string } {
  const stamp = now();
  const files: { path: string; sha256: string; content: string }[] = [];
  const push = (rel: string, content: string): void => {
    files.push({ path: rel, sha256: sha256(content), content });
  };
  const planDigest = planBody !== null ? sha256(planBody) : null;
  const manifest: RunManifest = {
    schemaVersion: 1,
    runId: spec.runId,
    revision: 1,
    status: spec.status,
    graphId: "doc-driven-dev",
    focus: null,
    baseCommit: baseCommit(cwd),
    planDigest,
    // Plan approval is never fabricated — migrated runs re-approve through
    // the normal boundary (#247); journal.followUps records who must.
    approval: null,
    createdAt: stamp,
    updatedAt: stamp,
    finalizedAt: spec.status === "active" ? null : stamp,
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  if (planBody !== null) push("plan.md", planBody.endsWith("\n") ? planBody : `${planBody}\n`);
  for (const task of spec.tasks) {
    const record: TaskRecord = {
      schemaVersion: 1,
      runId: spec.runId,
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      dependsOn: task.dependsOn,
      checks: task.checks,
      scope: [],
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    push(`tasks/${task.taskId}.json`, `${JSON.stringify(record, null, 2)}\n`);
  }
  for (const { checkpointId, record } of spec.checkpoints) {
    push(`checkpoints/${checkpointId}.json`, `${JSON.stringify(record, null, 2)}\n`);
  }
  for (const { receiptId, record } of spec.receipts) {
    push(`receipts/${receiptId}.json`, `${JSON.stringify(record, null, 2)}\n`);
  }
  if (diagnostics.length > 0) {
    push("run_trace.jsonl", `${diagnostics.map((line) => JSON.stringify(line)).join("\n")}\n`);
  }
  push("manifest.json", manifestBytes);
  const ordered = [...files].sort((a, b) => compareCodeUnits(a.path, b.path));
  const document: RunExport = {
    schemaVersion: 1,
    kind: "execution-run-export",
    runId: spec.runId,
    exportedAt: stamp,
    source: { baseCommit: manifest.baseCommit, status: spec.status, revision: 1 },
    files: ordered,
    payloadDigest: sha256(canonicalJson({
      runId: spec.runId,
      files: ordered.map(({ path: rel, sha256: digest }) => ({ path: rel, sha256: digest })),
    })),
  };
  return { document, bytes: `${JSON.stringify(document, null, 2)}\n` };
}

// ---------------------------------------------------------------------------
// Staging — every output byte is pinned before anything touches the repo
// ---------------------------------------------------------------------------

function stagedDocRel(target: string): string {
  return `files/${target}`;
}

function stagedRunRel(runId: string): string {
  return `runs/${runId}.export.json`;
}

function stagedRecordRel(runId: string, kind: string, id: string): string {
  return `records/${runId}-${kind}-${id}.json`;
}

function stagedBackupRel(rel: string): string {
  return `originals/${rel}`;
}

function stagedManifestRel(): string {
  return stagedDocRel(SCHEMA_MANIFEST_PATH);
}

function stageWrite(staging: string, rel: string, content: string): { path: string; sha256: string } {
  const abs = path.join(staging, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  atomicWriteFile(abs, content);
  return { path: rel, sha256: sha256(content) };
}

function copyIntoStaging(staging: string, rel: string, srcAbs: string): string | null {
  const dest = path.join(staging, stagedBackupRel(rel));
  if (!fs.existsSync(srcAbs)) return null;
  if (fs.statSync(srcAbs).isDirectory()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyTree(srcAbs, dest);
    return stagedBackupRel(rel);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcAbs, dest);
  return stagedBackupRel(rel);
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function listStaged(staging: string): { path: string; sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  const visit = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareCodeUnits(a.name, b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(abs, relPath);
      else if (entry.isFile()) out.push({ path: relPath, sha256: sha256(fs.readFileSync(abs, "utf8")) });
    }
  };
  visit(staging, "");
  return out;
}

function journalStepId(index: number, op: StepOp, target: string): string {
  return `${String(index).padStart(4, "0")}-${op}-${target}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

// Directories a write to `targets` creates that did not exist beforehand —
// recorded in the journal so rollback can prune exactly these (and only
// while they stay empty). `fileTargets` contribute their parent chain,
// `dirTargets` themselves plus ancestors, each walked up to the nearest
// pre-existing directory.
function createdDirsFor(cwd: string, fileTargets: string[], dirTargets: string[] = []): string[] {
  const created = new Set<string>();
  const visit = (dir: string): void => {
    while (dir !== "" && dir !== "." && !fs.existsSync(path.resolve(cwd, dir))) {
      created.add(dir);
      const parent = path.posix.dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  };
  for (const rel of dirTargets) visit(normalizeDir(rel));
  for (const rel of fileTargets) visit(path.posix.dirname(normalizeDir(rel)));
  return [...created].sort(compareCodeUnits);
}

// Transform: build every staged artifact + the journal's step/removal plan.
// The journal records stage "transform" BEFORE any artifact lands: a real
// crash anywhere below leaves a journal whose empty steps/staged mark the
// transform as never-committed — resume rebuilds and re-runs it.
function runTransform(cwd: string, journal: MigrationJournal, world: World, ctx: WorldCtx, options: ApplyOptions): void {
  const now = options.now ?? systemClock;
  const staging = stagingAbs(cwd, journal);

  // Dirs the migration will create (journal dir already recorded at open) —
  // captured before staging exists so the staging ancestors count too.
  const fileTargets = [
    ...world.docWrites.map((write) => write.target),
    ...world.indexJobs.map((job) => job.path),
    ...world.exports.map((item) => item.out),
    ...(world.manifestPlanned ? [SCHEMA_MANIFEST_PATH] : []),
  ];
  const dirTargets = [...world.runs.map((run) => `${EXECUTION_STATE_ROOT}/runs/${run.runId}`), journal.staging];
  journal.createdDirs = sortStrings(new Set([...journal.createdDirs, ...createdDirsFor(cwd, fileTargets, dirTargets)]));

  journal.stage = "transform";
  writeJournal(cwd, journal, now);
  fs.mkdirSync(staging, { recursive: true });
  const staged = new Map<string, string>();
  // `transform:<n>` fault injection counts committed staged artifacts —
  // a crash here is the real mid-transform case: partial staging, no steps.
  let stagedCount = 0;
  const pin = (entry: { path: string; sha256: string }): void => {
    staged.set(entry.path, entry.sha256);
    stagedCount += 1;
    crashAt(options, "transform", stagedCount);
  };

  for (const write of world.docWrites) {
    pin(stageWrite(staging, stagedDocRel(write.target), renderDoc(write.data, write.body)));
  }
  if (world.manifestPlanned) {
    pin(stageWrite(staging, stagedManifestRel(), schemaManifestText()));
  }
  for (const spec of world.runs) {
    const planBody = spec.planPath !== null ? readRawDoc(cwd, spec.planPath).body : null;
    const diagnostics = spec.diagnostics ? world.diagnostics : [];
    const { bytes } = buildRunExportDocument(cwd, spec, planBody, diagnostics, now);
    pin(stageWrite(staging, stagedRunRel(spec.runId), bytes));
  }
  for (const record of world.existingRecords) {
    const rel = stagedRecordRel(record.runId, record.kind, record.kind === "receipt" ? (record.record as ReceiptRecord).receiptId : (record.record as CheckpointRecord).checkpointId);
    pin(stageWrite(staging, rel, `${JSON.stringify(record.record, null, 2)}\n`));
  }
  // Originals of everything that will be replaced or removed — the rollback
  // material. Captured BEFORE any publish so a crash never loses a source.
  // A vanished source backs up as null: the honest record is "there was
  // nothing to restore", so rollback restores the absent state instead of
  // pointing at a backup that never existed.
  for (const removal of world.removals) {
    const backup = copyIntoStaging(staging, removal.path, path.resolve(cwd, removal.path));
    journal.removals.push({ path: removal.path, backup, dir: removal.dir, state: "pending" });
  }
  // Edited/regenerated paths — and doc-create targets that already exist on
  // disk (a byte-identical foreign file the apply adopts) — get backups so
  // rollback restores the pre-existing bytes rather than deleting a file
  // that was never the migration's.
  const backupByTarget = new Map<string, string | null>();
  for (const write of world.docWrites) {
    if (write.kind === "edit" || fs.existsSync(path.resolve(cwd, write.target))) {
      backupByTarget.set(write.target, copyIntoStaging(staging, write.target, path.resolve(cwd, write.target)));
    }
  }
  for (const job of world.indexJobs) {
    backupByTarget.set(job.path, copyIntoStaging(staging, job.path, path.resolve(cwd, job.path)));
  }
  const manifestAbs = path.resolve(cwd, SCHEMA_MANIFEST_PATH);
  const manifestBackup = fs.existsSync(manifestAbs) ? copyIntoStaging(staging, SCHEMA_MANIFEST_PATH, manifestAbs) : null;

  // Steps — deterministic order: doc writes, then run imports (publish);
  // removals, indexes, existing-run records, exports, postflight-checked
  // handoffs, manifest, cleanup (finalize).
  let index = 0;
  const pushStep = (stage: "publish" | "finalize", op: StepOp, target: string, detail: Record<string, unknown>, stagedRel: string | null = null, backup: string | null = null): void => {
    index += 1;
    journal.steps.push({ id: journalStepId(index, op, target), stage, op, target, staged: stagedRel, backup, detail, state: "pending" });
  };
  for (const write of [...world.docWrites].sort((a, b) => compareCodeUnits(a.target, b.target))) {
    pushStep("publish", write.kind === "create" ? "doc-create" : "doc-edit", write.target, { source: write.source }, stagedDocRel(write.target), backupByTarget.get(write.target) ?? null);
  }
  for (const spec of world.runs) {
    pushStep("publish", "run-import", spec.runId, { planPath: spec.planPath }, stagedRunRel(spec.runId));
  }
  for (const removal of journal.removals) {
    pushStep("finalize", "remove", removal.path, { dir: removal.dir }, null, removal.backup);
  }
  for (const job of world.indexJobs) {
    pushStep("finalize", "index", job.path, { dir: job.dir }, null, backupByTarget.get(job.path) ?? null);
  }
  for (const record of world.existingRecords) {
    const id = record.kind === "receipt" ? (record.record as ReceiptRecord).receiptId : (record.record as CheckpointRecord).checkpointId;
    pushStep("finalize", "run-record", `${EXECUTION_STATE_ROOT}/runs/${record.runId}/${record.kind === "receipt" ? "receipts" : "checkpoints"}/${id}.json`, { runId: record.runId, kind: record.kind, recordId: id }, stagedRecordRel(record.runId, record.kind, id));
  }
  for (const item of world.exports) {
    pushStep("finalize", "export", item.out, { runId: item.runId });
  }
  for (const item of world.handoffs) {
    pushStep("finalize", "handoff-finalize", `${EXECUTION_STATE_ROOT}/runs/${item.runId}`, { runId: item.runId, status: item.status });
  }
  if (world.manifestPlanned) {
    pushStep("finalize", "manifest", SCHEMA_MANIFEST_PATH, {}, stagedManifestRel(), manifestBackup);
  }
  pushStep("finalize", "cleanup", `${journal.staging} + ${MIGRATION_JOURNAL_PATH}`, {});

  journal.staged = listStaged(staging);
  journal.touchedPaths = [...world.touchedPaths].sort(compareCodeUnits);
  journal.acceptedPaths = [...world.acceptedPaths].sort(compareCodeUnits);
  journal.diagnosticsRunId = world.diagnosticsRunId;
  journal.followUps = [...world.followUps].sort(compareCodeUnits);
  void ctx;
}

// Every type dir the migration writes a durable doc into needs a managed
// index; dirs the repo never had get one generated at finalize (indexes are
// derived views — generating a missing one in a touched dir is part of the
// migration, not new content).
function planDerivedIndexes(cwd: string, world: World): void {
  const planned = new Set(world.indexJobs.map((job) => job.dir));
  for (const write of world.docWrites) {
    const type = typeof write.data.type === "string" ? write.data.type : null;
    if (type === null || !DURABLE_TYPES.has(type)) continue;
    const dir = configs[type as keyof typeof configs].dir;
    if (dir === null || planned.has(dir)) continue;
    if (normalizeDir(path.posix.dirname(write.target)) !== dir) continue;
    const hasIndex = fs.existsSync(path.join(cwd, dir, "README.md")) || fs.existsSync(path.join(cwd, dir, "index.md"));
    if (hasIndex) continue;
    planned.add(dir);
    world.indexJobs.push({ path: `${dir}/README.md`, dir });
    world.touchedPaths.add(`${dir}/README.md`);
  }
}

// ---------------------------------------------------------------------------
// Validate — the staged bytes must satisfy every contract before publish
// ---------------------------------------------------------------------------

type StagedDoc = {
  target: string;
  kind: "create" | "edit";
  data: Record<string, unknown>;
  body: string;
};

function validateStaged(staging: string, journal: MigrationJournal, cwd: string): string[] {
  const errors: string[] = [];
  const stagedDocs: StagedDoc[] = [];

  // Every step target is foreign input until proven inside its op's
  // namespace — readJournal proves containment; here the per-op rule lands:
  // doc/index/export writes stay out of the managed state + manifest dirs,
  // removals never touch the store, store ops never leave it, the manifest
  // step writes exactly the manifest — and no op ever touches VCS
  // internals, whatever its own namespace allows.
  for (const step of journal.steps) {
    if (step.op === "cleanup") continue;
    const target = normalizeContainedRelPath(step.target);
    const inState = target !== null && isUnderDir(target, EXECUTION_STATE_ROOT);
    const inManifest = target !== null && isUnderDir(target, DOC_DRIVEN_DEV_DIR);
    const inVcs = target !== null && isVcsInternalPath(target);
    const bad = target === null
      || inVcs
      || ((step.op === "doc-create" || step.op === "doc-edit" || step.op === "index") && (inState || inManifest))
      || (step.op === "remove" && inState)
      || (step.op === "export" && (inState || inManifest))
      || (step.op === "run-import" && !isValidId(step.target))
      || ((step.op === "run-record" || step.op === "handoff-finalize") && !inState)
      || (step.op === "manifest" && target !== SCHEMA_MANIFEST_PATH);
    if (bad) {
      errors.push(`step ${step.id}: target ${JSON.stringify(step.target)} is outside the ${step.op} op's allowed namespace`);
    }
  }

  const writeSteps = journal.steps.filter((step) => step.stage === "publish" && (step.op === "doc-create" || step.op === "doc-edit"));

  // VD check index: staged VD docs + VD docs already on disk (preserved).
  const vdChecks = new Map<string, Set<string>>();
  const indexVd = (id: string, checks: unknown, source: string): void => {
    const { checks: parsed, issues } = parseVerificationChecks(checks);
    if (issues.length > 0) {
      errors.push(`${source}: malformed checks[] — ${issues.map((issue) => issue.message).join("; ")}`);
    }
    const set = vdChecks.get(id) ?? new Set<string>();
    for (const check of parsed) set.add(check.id);
    vdChecks.set(id, set);
  };

  for (const step of writeSteps) {
    const rel = step.staged;
    if (rel === null) { errors.push(`${step.target}: publish step carries no staged artifact`); continue; }
    const abs = path.join(staging, rel);
    if (!fs.existsSync(abs)) { errors.push(`${step.target}: staged artifact ${rel} is missing`); continue; }
    const target = normalizeContainedRelPath(step.target);
    if (target === null || isProtectedWriteTarget(target)) {
      errors.push(`${step.target}: write target escapes the checkout or lands in a protected namespace (state, manifest, or VCS internals)`);
      continue;
    }
    if (step.op === "doc-create" && fs.existsSync(path.join(cwd, target))) {
      // Done step → the bytes on disk are ours (drift is checked separately).
      // Pending step → only an exact match of the staged bytes may continue;
      // anything else is unplanned foreign content we refuse to overwrite.
      const onDisk = fs.readFileSync(path.join(cwd, target), "utf8");
      if (step.state !== "done" && onDisk !== fs.readFileSync(abs, "utf8")) {
        errors.push(`${step.target}: target already exists on disk — refusing to overwrite unplanned content`);
        continue;
      }
    }
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(fs.readFileSync(abs, "utf8"), {});
    } catch (error: unknown) {
      errors.push(`${step.target}: staged document does not parse — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const data = isPlainObject(parsed.data) ? parsed.data : {};
    const doc: StagedDoc = { target, kind: step.op === "doc-create" ? "create" : "edit", data, body: parsed.content };
    stagedDocs.push(doc);
    const type = typeof data.type === "string" ? data.type : null;
    if (type === null || !DURABLE_TYPES.has(type)) {
      errors.push(`${target}: staged document has no valid durable type (got ${JSON.stringify(data.type)})`);
      continue;
    }
    const config = configs[type as keyof typeof configs];
    for (const field of ["id", "status", "lifecycle", "title", "created", "updated"] as const) {
      if (typeof data[field] !== "string" || (data[field] as string).trim() === "") {
        errors.push(`${target}: staged document is missing required front-matter field ${field}`);
      }
    }
    if (!isValidId(data.id)) errors.push(`${target}: id ${JSON.stringify(data.id)} is not a valid artifact id`);
    if (!(config.statusValues as readonly string[]).includes(String(data.status))) {
      errors.push(`${target}: status ${JSON.stringify(data.status)} is not in the ${type} vocabulary`);
    }
    if (!(LIFECYCLE_VALUES as readonly string[]).includes(String(data.lifecycle))) {
      errors.push(`${target}: lifecycle ${JSON.stringify(data.lifecycle)} is not a valid lifecycle`);
    }
    if (type === "knowledge" && typeof data.knowledge_kind !== "string") {
      errors.push(`${target}: knowledge document is missing knowledge_kind`);
    }
    if (type === "verification") indexVd(String(data.id), data.checks, target);
  }
  // VD docs already on disk (preserved) also participate in check resolution.
  for (const dir of ["docs/verification"]) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) continue;
    walkTree(cwd, dir, (rel, isDir) => {
      if (isDir || !rel.endsWith(".md")) return;
      const onDisk = readRawDoc(cwd, rel);
      if (typeof onDisk.data.id === "string" && onDisk.data.type === "verification" && !vdChecks.has(String(onDisk.data.id))) {
        indexVd(String(onDisk.data.id), onDisk.data.checks, rel);
      }
    });
  }
  const resolveCheckRef = (ref: string): string | null => {
    const claim = parseClaimReference(ref);
    if (claim === null) return `${JSON.stringify(ref)} is not a qualified VD-<id>::CHK-NN reference`;
    const set = vdChecks.get(claim.docId);
    if (set === undefined) return `${JSON.stringify(ref)} targets Verification Design ${claim.docId}, which does not exist after migration`;
    if (!set.has(claim.key)) return `${JSON.stringify(ref)} targets check ${claim.key}, which ${claim.docId} does not declare`;
    return null;
  };

  // Run exports: full store-consistency validation + task DAG + check refs.
  for (const step of journal.steps.filter((item) => item.stage === "publish" && item.op === "run-import")) {
    const rel = step.staged;
    if (rel === null || !fs.existsSync(path.join(staging, rel))) {
      errors.push(`run ${step.target}: staged export artifact is missing`);
      continue;
    }
    let document: unknown;
    try {
      document = JSON.parse(fs.readFileSync(path.join(staging, rel), "utf8"));
    } catch (error: unknown) {
      errors.push(`run ${step.target}: staged export is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    try {
      validateExportShape(document);
      verifyExportRecords(document as RunExport);
    } catch (error: unknown) {
      errors.push(`run ${step.target}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const doc = document as RunExport;
    const byPath = new Map(doc.files.map((file) => [file.path, file.content]));
    const taskIds = new Set<string>();
    const taskRecords: TaskRecord[] = [];
    for (const file of doc.files.filter((item) => item.path.startsWith("tasks/"))) {
      taskRecords.push(JSON.parse(file.content) as TaskRecord);
      taskIds.add(JSON.parse(file.content).taskId as string);
    }
    for (const record of taskRecords) {
      for (const dep of record.dependsOn) {
        if (!taskIds.has(dep)) {
          errors.push(`run ${doc.runId}: task ${record.taskId} depends on ${dep}, which is not in the run`);
        }
      }
      for (const ref of record.checks) {
        const problem = resolveCheckRef(ref);
        if (problem !== null) errors.push(`run ${doc.runId}: task ${record.taskId} check ${problem}`);
      }
    }
    // DAG acyclicity.
    const state = new Map<string, number>();
    const visitDag = (id: string, lineage: string[]): void => {
      const mark = state.get(id) ?? 0;
      if (mark === 2) return;
      if (mark === 1) {
        errors.push(`run ${doc.runId}: dependsOn cycle through ${lineage.join(" -> ")}`);
        return;
      }
      state.set(id, 1);
      const record = taskRecords.find((item) => item.taskId === id);
      for (const dep of record?.dependsOn ?? []) visitDag(dep, [...lineage, dep]);
      state.set(id, 2);
    };
    for (const record of taskRecords) visitDag(record.taskId, [record.taskId]);
    // planDigest ↔ plan.md bytes.
    const manifest = JSON.parse(byPath.get("manifest.json")!) as RunManifest;
    if (manifest.planDigest !== null) {
      const plan = byPath.get("plan.md");
      if (plan === undefined || sha256(plan) !== manifest.planDigest) {
        errors.push(`run ${doc.runId}: manifest planDigest does not match the staged plan.md`);
      }
    }
  }

  // No two artifacts may claim one destination.
  const targets = writeSteps.map((step) => normalizeDir(step.target));
  const dup = targets.filter((item, index) => targets.indexOf(item) !== index);
  for (const item of new Set(dup)) {
    errors.push(`duplicate write target ${item}`);
  }
  return errors;
}

// The store's import-integrity checks, mirrored so validation can run on
// staged bytes without instantiating a store. importRun re-verifies all of
// this again at publish — the staged check exists so a bad snapshot is
// reported BEFORE anything is written.
function validateExportShape(document: unknown): void {
  if (!isPlainObject(document) || document.kind !== "execution-run-export") {
    throw new MigrationFault("staged-invalid", "not an execution-run export document");
  }
  if (document.schemaVersion !== 1) {
    throw new MigrationFault("staged-invalid", `export schemaVersion is ${JSON.stringify(document.schemaVersion)}, expected 1`);
  }
  if (!isValidId(document.runId) || !Array.isArray(document.files) || !isSha256(document.payloadDigest)) {
    throw new MigrationFault("staged-invalid", "export is missing runId/files/payloadDigest");
  }
  const digest = sha256(canonicalJson({
    runId: document.runId,
    files: (document.files as Array<{ path?: unknown; sha256?: unknown }>).map((file) => ({ path: file.path, sha256: file.sha256 })),
  }));
  if (digest !== document.payloadDigest) {
    throw new MigrationFault("staged-invalid", "export payloadDigest mismatch");
  }
  const seen = new Set<string>();
  for (const file of document.files as Array<{ path?: unknown; sha256?: unknown; content?: unknown }>) {
    if (typeof file.path !== "string" || !/^(manifest\.json|plan\.md|run_trace\.jsonl|tasks\/[^/]+\.json|checkpoints\/[^/]+\.json|receipts\/[^/]+\.json)$/.test(file.path)) {
      throw new MigrationFault("staged-invalid", `export carries disallowed path ${JSON.stringify(file.path)}`);
    }
    if (typeof file.sha256 !== "string" || typeof file.content !== "string" || sha256(file.content) !== file.sha256) {
      throw new MigrationFault("staged-invalid", `file ${file.path} failed its content digest`);
    }
    if (seen.has(file.path)) throw new MigrationFault("staged-invalid", `duplicate path ${file.path} in export`);
    seen.add(file.path);
  }
}

function verifyExportRecords(document: RunExport): void {
  const byPath = new Map(document.files.map((file) => [file.path, file.content]));
  const manifestRaw = byPath.get("manifest.json");
  if (manifestRaw === undefined) throw new MigrationFault("staged-invalid", "export has no manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new MigrationFault("staged-invalid", "export manifest is not valid JSON");
  }
  if (!validateManifest(manifest) || manifest.runId !== document.runId) {
    throw new MigrationFault("staged-invalid", "export manifest failed validation or binds a different run id");
  }
  for (const file of document.files) {
    if (file.path === "manifest.json" || file.path === "plan.md" || file.path === "run_trace.jsonl") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      throw new MigrationFault("staged-invalid", `record ${file.path} is not valid JSON`);
    }
    const [kind, name] = file.path.split("/");
    const id = name.replace(/\.json$/, "");
    const record = parsed as Record<string, unknown>;
    if (record.runId !== document.runId) {
      throw new MigrationFault("staged-invalid", `record ${file.path} binds run ${JSON.stringify(record.runId)}, expected ${document.runId}`);
    }
    const idField = kind === "tasks" ? "taskId" : kind === "checkpoints" ? "checkpointId" : "receiptId";
    if (record[idField] !== id) {
      throw new MigrationFault("staged-invalid", `record ${file.path} carries ${idField} ${JSON.stringify(record[idField])}, expected ${id}`);
    }
    const valid = kind === "tasks" ? validateTask(parsed) : kind === "checkpoints" ? validateCheckpoint(parsed) : validateReceipt(parsed);
    if (!valid) throw new MigrationFault("staged-invalid", `record ${file.path} failed ${kind} schema validation`);
  }
}

// ---------------------------------------------------------------------------
// Publish — staged bytes land atomically; every step is idempotent
// ---------------------------------------------------------------------------

function executePublishStep(cwd: string, staging: string, step: JournalStep, options: ApplyOptions): void {
  switch (step.op) {
    case "doc-create": {
      const content = fs.readFileSync(path.join(staging, step.staged!), "utf8");
      const abs = path.resolve(cwd, step.target);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      atomicWriteFile(abs, content);
      return;
    }
    case "doc-edit": {
      const content = fs.readFileSync(path.join(staging, step.staged!), "utf8");
      const abs = path.resolve(cwd, step.target);
      if (fs.existsSync(abs) && fs.readFileSync(abs, "utf8") === content) return; // idempotent
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      atomicWriteFile(abs, content);
      return;
    }
    case "run-import": {
      const runId = step.target;
      const runDir = path.resolve(cwd, EXECUTION_STATE_ROOT, "runs", runId);
      const document = JSON.parse(fs.readFileSync(path.join(staging, step.staged!), "utf8"));
      const stagedManifest = (document as RunExport).files.find((file) => file.path === "manifest.json");
      if (fs.existsSync(runDir)) {
        try {
          loadRun(cwd, runId);
          // A loadable run already occupies the id. Identical bytes mean a
          // resumed no-op (import is deterministic); anything else is a
          // foreign run the plan collided with — never overwrite it.
          const onDisk = sha256(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
          if (stagedManifest !== undefined && onDisk === stagedManifest.sha256) {
            step.detail.created = false;
            return;
          }
          throw new MigrationFault("run-collision", `run ${runId} already exists with different content — refusing to overwrite a foreign run`);
        } catch (error: unknown) {
          if (error instanceof MigrationFault) throw error;
          // Half-written or corrupt — almost certainly an earlier attempt of
          // this step. Replace with a fresh import of the pinned export.
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      }
      importRun(cwd, { document });
      step.detail.created = true;
      return;
    }
    default:
      throw new MigrationFault("bad-step", `publish stage cannot execute op ${step.op}`);
  }
  void options;
}

async function executeFinalizeStep(cwd: string, staging: string, step: JournalStep, options: ApplyOptions): Promise<void> {
  const now = options.now ?? systemClock;
  switch (step.op) {
    case "remove": {
      const abs = path.resolve(cwd, step.target);
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: step.detail.dir === true, force: true });
      }
      return;
    }
    case "index": {
      const dir = String(step.detail.dir);
      const target = path.resolve(cwd, step.target);
      const seed = primaryIndexTypeForDir(dir, residentTypesForDir(dir));
      const generated = await renderManagedIndex(cwd, dir, seed);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      const merged = existing === "" ? generated : mergeManagedIndex(existing, generated);
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === merged) return; // idempotent
      fs.mkdirSync(path.dirname(target), { recursive: true });
      atomicWriteFile(target, merged);
      return;
    }
    case "run-record": {
      const runId = String(step.detail.runId);
      const record = JSON.parse(fs.readFileSync(path.join(staging, step.staged!), "utf8"));
      if (step.detail.kind === "receipt") {
        recordReceipt(cwd, runId, record, { now });
      } else {
        recordCheckpoint(cwd, runId, record, { now });
      }
      return;
    }
    case "export": {
      exportRun(cwd, String(step.detail.runId), { out: step.target, now });
      return;
    }
    case "handoff-finalize": {
      finalizeRun(cwd, String(step.detail.runId), { status: step.detail.status as "completed" | "aborted" }, { now });
      return;
    }
    case "manifest": {
      const content = fs.readFileSync(path.join(staging, step.staged!), "utf8");
      const abs = path.resolve(cwd, SCHEMA_MANIFEST_PATH);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      atomicWriteFile(abs, content);
      return;
    }
    case "cleanup": {
      // Staging first, journal last — the other order orphans an invisible
      // staging directory. A crash between them leaves a journal whose only
      // pending step is cleanup, still pinning staging artifacts that no
      // longer exist on disk. Resume refuses that state rather than
      // re-running cleanup: verifyStaging cannot distinguish "cleanup
      // already deleted the staging area" from a staging area tampered with
      // mid-finalize, so it reports the pins missing and recovery directs
      // to `migrate recovery --rollback`.
      fs.rmSync(stagingAbs(cwd), { recursive: true, force: true });
      fs.rmSync(journalAbs(cwd), { force: true });
      return;
    }
    default:
      throw new MigrationFault("bad-step", `finalize stage cannot execute op ${step.op}`);
  }
}

// ---------------------------------------------------------------------------
// Postflight — the migrated model must stand on its own before the manifest
// stamps. Markers cleared + lint/graph clean on touched paths.
// ---------------------------------------------------------------------------

async function runPostflight(cwd: string, journal: MigrationJournal, now: Clock): Promise<PostflightReport> {
  const detail: string[] = [];
  const preflight = evaluateSchemaPreflight(cwd);
  const markers = {
    legacyMarkers: preflight.detected.legacyMarkers,
    manifestMarkers: preflight.detected.manifestMarkers.length,
    executionDocs: preflight.detected.executionDocs,
  };
  if (markers.legacyMarkers > 0) detail.push(`${markers.legacyMarkers} legacy marker(s) remain`);
  if (markers.manifestMarkers > 0) detail.push(`${markers.manifestMarkers} foreign manifest-namespace file(s) remain: ${preflight.detected.manifestMarkers.join(", ")}`);
  if (markers.executionDocs > 0) detail.push(`${markers.executionDocs} execution-bound document(s) remain in migration-owned dirs`);
  const manifestFile = path.resolve(cwd, SCHEMA_MANIFEST_PATH);
  if (fs.existsSync(manifestFile) && preflight.manifest.state !== "valid") {
    detail.push(`schema manifest state is ${preflight.manifest.state} — expected valid or absent before finalize`);
  }

  const accepted = new Set(journal.acceptedPaths);
  const touched = new Set(journal.touchedPaths);
  const baseline = new Set(journal.baselineFindings ?? []);
  const blockingFindings: { path: string | null; ruleId: string; message: string }[] = [];
  const graphIssues: { path: string; code: string; message: string }[] = [];
  try {
    const collected = await collectFindings(cwd, {});
    for (const finding of collected.findings) {
      if (!finding.blocking) continue;
      if (baseline.has(`lint|${finding.path ?? ""}|${finding.ruleId}|${finding.message}`)) continue; // pre-existing debt, not ours
      if (finding.path !== null && !touched.has(finding.path)) continue; // untouched path, cannot be ours
      if (finding.path !== null && accepted.has(finding.path)) continue;
      blockingFindings.push({ path: finding.path, ruleId: finding.ruleId, message: finding.message });
    }
    const graph = projectKnowledgeGraph(collected.model);
    for (const issue of graph.issues) {
      if (baseline.has(`graph|${issue.path}|${issue.code}|${issue.message}`)) continue;
      if (!touched.has(issue.path) || accepted.has(issue.path)) continue;
      graphIssues.push({ path: issue.path, code: issue.code, message: issue.message });
    }
  } catch (error: unknown) {
    detail.push(`postflight lint/graph gate could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (blockingFindings.length > 0) detail.push(`${blockingFindings.length} blocking lint finding(s) on migrated content`);
  if (graphIssues.length > 0) detail.push(`${graphIssues.length} knowledge-graph issue(s) on migrated content`);

  return {
    pass: detail.length === 0,
    checkedAt: now(),
    markers,
    blockingFindings,
    graphIssues,
    detail: detail.length === 0 ? "markers cleared, lint and graph gates clean" : detail.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Driver — gates, stage progression, crash containment
// ---------------------------------------------------------------------------

type GateRefusal = {
  reason: string;
  blockers: PreflightIssue[];
};

function refusal(report: ApplyReport, gate: GateRefusal | string): ApplyReport {
  report.applied = false;
  report.ok = false;
  if (typeof gate === "string") {
    report.reason = gate;
  } else {
    report.reason = gate.reason;
    report.blockers = gate.blockers;
  }
  return report;
}

function emptyApplyReport(cwd: string, planHash: string): ApplyReport {
  return {
    command: "migrate apply",
    applied: false,
    resumed: false,
    planHash,
    journalPath: MIGRATION_JOURNAL_PATH,
    stage: null,
    steps: { total: 0, done: 0 },
    docsWritten: [],
    runsImported: [],
    removals: [],
    reason: "",
    blockers: [],
    followUps: [],
    postflight: null,
    preflight: evaluateSchemaPreflight(cwd),
    ok: false,
  };
}

// Open the journal at `prepare`: input pins + normalized resolutions, then
// gate results. Returns the journal or the refusal reason.
async function openJournal(
  cwd: string,
  plan: MigrationPlanReport,
  normalized: NormalizedResolutions,
  options: ApplyOptions,
): Promise<{ journal: MigrationJournal } | { error: string }> {
  const now = options.now ?? systemClock;
  // The postflight gate is a diff, not an absolute: capture every blocking
  // lint/graph finding the repo already carries so findings the migration
  // did not cause cannot stop the manifest stamp — and so findings the
  // migration DID cause are visible by contrast.
  const baselineFindings: string[] = [];
  try {
    const collected = await collectFindings(cwd, {});
    for (const finding of collected.findings) {
      if (!finding.blocking) continue;
      baselineFindings.push(`lint|${finding.path ?? ""}|${finding.ruleId}|${finding.message}`);
    }
    for (const issue of projectKnowledgeGraph(collected.model).issues) {
      baselineFindings.push(`graph|${issue.path}|${issue.code}|${issue.message}`);
    }
  } catch (error: unknown) {
    return { error: `cannot collect the pre-migration lint baseline — refusing to write without a comparison point: ${error instanceof Error ? error.message : String(error)}` };
  }
  const inputs: { path: string; sha256: string }[] = [];
  for (const rel of plan.inventory.inputFiles) {
    const abs = path.resolve(cwd, rel);
    try {
      const stat = fs.statSync(abs);
      inputs.push({ path: rel, sha256: stat.isDirectory() ? "dir" : sha256(fs.readFileSync(abs, "utf8")) });
    } catch {
      inputs.push({ path: rel, sha256: "unreadable" });
    }
  }
  const resolutions: Record<string, unknown> = {};
  for (const [id, value] of normalized.values) resolutions[id] = value;
  const runHandoffs: Record<string, unknown> = {};
  for (const [runId, handoff] of normalized.handoffs) runHandoffs[runId] = handoff;
  const journal: MigrationJournal = {
    schemaVersion: 1,
    kind: "migration-journal",
    planHash: plan.plan.planHash,
    inputHash: plan.inventory.inputHash,
    resolutionsHash: sha256(canonicalJson({ resolutions, runHandoffs })),
    resolutions,
    runHandoffs,
    plan,
    startedAt: now(),
    updatedAt: now(),
    stage: "prepare",
    staging: STAGING_DIR,
    inputs,
    staged: [],
    steps: [],
    removals: [],
    followUps: [],
    touchedPaths: [],
    acceptedPaths: [],
    baselineFindings: baselineFindings.sort(compareCodeUnits),
    diagnosticsRunId: null,
    postflight: null,
    // The journal's own directory counts as engine-created only when it was
    // absent now — writeJournal creates it below, so this is evaluated
    // before the first write.
    createdDirs: createdDirsFor(cwd, [MIGRATION_JOURNAL_PATH]),
  };
  writeJournal(cwd, journal, now);
  return { journal };
}

// Resume/publish drift verification: every input pin must still describe the
// file — but only for paths the engine itself has not written. Drift is
// measured on PLAN INPUTS, never on engine outputs: a done doc step's bytes
// must still equal its staged artifact, a done removal must be absent, and
// paths a done index/manifest/export step (or a run the engine imported or
// finalized) rewrote carry engine-derived bytes that were never re-pinned.
// Transient store plumbing (writer.lock) is never semantically an input.
function verifyResumeDrift(cwd: string, journal: MigrationJournal): string[] {
  const problems: string[] = [];
  const consumedEdit = new Map<string, JournalStep>();
  const consumedRemove = new Set<string>();
  const engineOutput = new Set<string>();
  const engineTransient = new Set<string>();
  for (const step of journal.steps) {
    if (step.state !== "done") continue;
    const target = normalizeDir(step.target);
    if (step.op === "doc-edit" || step.op === "doc-create") {
      consumedEdit.set(target, step);
    } else if (step.op === "remove") {
      consumedRemove.add(target);
    } else if (step.op === "index" || step.op === "manifest" || step.op === "export") {
      engineOutput.add(target);
    } else if (step.op === "run-import" || step.op === "handoff-finalize" || step.op === "run-record") {
      const runId = step.op === "run-import" ? target : String(step.detail.runId ?? "");
      if (isValidId(runId)) {
        const runDir = `${EXECUTION_STATE_ROOT}/runs/${runId}`;
        engineTransient.add(`${runDir}/writer.lock`);
        // finalize rewrites the manifest; a run-record step's target is the
        // record file itself — both are engine-derived, never pinned.
        if (step.op !== "run-record") engineOutput.add(`${runDir}/manifest.json`);
        else engineOutput.add(target);
      }
    }
  }
  for (const removal of journal.removals) {
    if (removal.state === "done") consumedRemove.add(normalizeDir(removal.path));
  }
  for (const input of journal.inputs) {
    const rel = normalizeDir(input.path);
    const abs = path.resolve(cwd, input.path);
    if (engineTransient.has(rel)) continue;
    if (consumedRemove.has(rel)) {
      if (fs.existsSync(abs)) problems.push(`${input.path}: marked removed in the journal but the file still exists`);
      continue;
    }
    const edit = consumedEdit.get(rel);
    if (edit !== undefined) {
      // The file now carries the staged bytes.
      const stagedPin = journal.staged.find((item) => item.path === edit.staged);
      const current = fs.existsSync(abs) ? sha256(fs.readFileSync(abs, "utf8")) : null;
      if (current !== stagedPin?.sha256) {
        problems.push(`${input.path}: published bytes no longer match the staged artifact — drift after publish`);
      }
      continue;
    }
    if (engineOutput.has(rel)) {
      // Engine-derived bytes are never re-pinned — but an engine output
      // that vanished mid-migration is real drift: a step reported done
      // whose product no one can find.
      if (!fs.existsSync(abs)) {
        problems.push(`${input.path}: engine-written output is missing after its step completed`);
      }
      continue;
    }
    if (input.sha256 === "unreadable") {
      // Unreadable inputs pin as "unreadable"; still-unreadable is fine,
      // a now-readable file is drift the transform never saw.
      if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) {
        try {
          fs.readFileSync(abs, "utf8");
          problems.push(`${input.path}: input that was unreadable at plan time is readable now — replan`);
        } catch { /* still unreadable — pinned state holds */ }
      }
      continue;
    }
    if (input.sha256 === "dir") {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) problems.push(`${input.path}: directory disappeared mid-migration`);
      continue;
    }
    if (!fs.existsSync(abs)) {
      problems.push(`${input.path}: input disappeared mid-migration`);
      continue;
    }
    if (sha256(fs.readFileSync(abs, "utf8")) !== input.sha256) {
      problems.push(`${input.path}: input changed after the plan was pinned — replan or roll back`);
    }
  }
  return problems;
}

function verifyStaging(staging: string, journal: MigrationJournal): string[] {
  const problems: string[] = [];
  const onDisk = new Map(listStaged(staging).map((item) => [item.path, item.sha256]));
  for (const pin of journal.staged) {
    const current = onDisk.get(pin.path);
    if (current === undefined) {
      problems.push(`staging artifact ${pin.path} is missing — the staging area was tampered with or cleaned`);
    } else if (current !== pin.sha256) {
      problems.push(`staging artifact ${pin.path} changed after pinning`);
    }
    onDisk.delete(pin.path);
  }
  for (const extra of onDisk.keys()) {
    problems.push(`staging artifact ${extra} exists but is not pinned in the journal`);
  }
  return problems;
}

async function publishAndFinalize(
  cwd: string,
  journal: MigrationJournal,
  options: ApplyOptions,
  report: ApplyReport,
): Promise<void> {
  const now = options.now ?? systemClock;
  const staging = stagingAbs(cwd, journal);

  // A done step marks its journal.removals twin done as well — the journal
  // stays the single honest record of what is and is not yet removed.
  const markDone = (step: JournalStep): void => {
    step.state = "done";
    if (step.op === "remove") {
      const removal = journal.removals.find((item) => normalizeDir(item.path) === normalizeDir(step.target));
      if (removal !== undefined) removal.state = "done";
    }
  };

  // Validate stage — re-verified every resume (idempotent, cheap). It runs
  // only while real work remains: when every step but cleanup is done the
  // staged bytes are dead weight — cleanup may even have deleted them —
  // and nothing needs them re-validated.
  if (journal.steps.some((item) => item.state === "pending" && item.op !== "cleanup")) {
    const validationErrors = validateStaged(staging, journal, cwd);
    if (validationErrors.length > 0) {
      journal.stage = "validate";
      writeJournal(cwd, journal, now);
      throw new MigrationFault("staged-invalid", `staged validation failed:\n- ${validationErrors.join("\n- ")}`);
    }
  }
  if (journal.stage === "validate") {
    journal.stage = "publish";
    writeJournal(cwd, journal, now);
  }
  crashAt(options, "validate");

  // Publish stage.
  let done = 0;
  for (const step of journal.steps.filter((item) => item.stage === "publish" && item.state === "pending")) {
    executePublishStep(cwd, staging, step, options);
    markDone(step);
    done += 1;
    writeJournal(cwd, journal, now);
    crashAt(options, "publish", done);
  }
  if (journal.stage === "publish") {
    journal.stage = "finalize";
    writeJournal(cwd, journal, now);
  }
  crashAt(options, "publish");

  // Finalize: removals first (reversible — originals stay staged), then
  // indexes/records/exports, then the postflight gate, then the manifest.
  done = 0;
  const prePostflight = journal.steps.filter((item) => item.stage === "finalize" && item.op !== "handoff-finalize" && item.op !== "manifest" && item.op !== "cleanup" && item.op !== "export");
  for (const step of prePostflight.filter((item) => item.state === "pending")) {
    await executeFinalizeStep(cwd, staging, step, options);
    markDone(step);
    done += 1;
    writeJournal(cwd, journal, now);
    crashAt(options, "finalize", done);
  }
  for (const step of journal.steps.filter((item) => item.op === "export" && item.state === "pending")) {
    await executeFinalizeStep(cwd, staging, step, options);
    markDone(step);
    done += 1;
    writeJournal(cwd, journal, now);
    crashAt(options, "finalize", done);
  }
  crashAt(options, "finalize");

  // Postflight gate — recorded in the journal either way.
  journal.postflight = await runPostflight(cwd, journal, now);
  writeJournal(cwd, journal, now);
  crashAt(options, "postflight");
  if (!journal.postflight.pass) {
    report.postflight = journal.postflight;
    throw new MigrationFault("postflight-failed", `postflight gate failed — migration state is retained for inspection and rollback: ${journal.postflight.detail}`);
  }

  for (const step of journal.steps.filter((item) => item.stage === "finalize" && (item.op === "handoff-finalize" || item.op === "manifest" || item.op === "cleanup") && item.state === "pending")) {
    await executeFinalizeStep(cwd, staging, step, options);
    markDone(step);
    done += 1;
    if (step.op !== "cleanup") writeJournal(cwd, journal, now);
    crashAt(options, "finalize", done);
  }
}

async function applyMigration(cwd: string, options: ApplyOptions = {}): Promise<ApplyReport> {
  const now = options.now ?? systemClock;
  const plan = buildMigrationPlan(cwd);
  const report = emptyApplyReport(cwd, plan.plan.planHash);
  const finish = (mutate?: (report: ApplyReport) => void): ApplyReport => {
    mutate?.(report);
    report.preflight = evaluateSchemaPreflight(cwd);
    return report;
  };

  // --- journal-present fast path -------------------------------------------
  const { journal: existing, error: journalError } = readJournal(cwd);
  if (existing !== null) {
    return finish(() => refusal(report, `a migration journal is already in flight (stage ${existing.stage}, plan ${existing.planHash.slice(0, 12)}) — run \`migrate recovery --resume\` to continue or \`migrate recovery --rollback\` to undo`));
  }
  if (journalError !== null) {
    return finish(() => refusal(report, journalError));
  }

  // --- classification + hash pinning ---------------------------------------
  if (plan.plan.classification === "current") {
    return finish(() => {
      report.ok = true;
      report.applied = false;
      report.reason = "schema already current — nothing to apply";
    });
  }
  if (options.expect !== undefined && options.expect !== plan.plan.planHash) {
    return finish(() => refusal(report, `plan hash mismatch: expected ${plan.plan.planHash}, got ${options.expect} — rerun \`migrate plan\` and pin the hash it reports`));
  }
  if (plan.plan.classification === "manifest-only") {
    // The bounded path stays exactly as it was: content already consistent,
    // only the manifest stamp is missing.
    const manifestAbs = path.resolve(cwd, SCHEMA_MANIFEST_PATH);
    if (fs.existsSync(manifestAbs)) {
      return finish(() => {
        report.ok = true;
        report.reason = "schema already current — nothing to apply";
      });
    }
    try {
      fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
      atomicWriteFile(manifestAbs, schemaManifestText());
    } catch (error: unknown) {
      return finish(() => refusal(report, `cannot write ${SCHEMA_MANIFEST_PATH}: ${error instanceof Error ? error.message : String(error)}`));
    }
    return finish(() => {
      report.applied = evaluateSchemaPreflight(cwd).status === "current";
      report.ok = report.applied;
      report.reason = report.applied ? "schema manifest written" : "schema manifest written but preflight is not clean";
      report.docsWritten = report.applied ? [SCHEMA_MANIFEST_PATH] : [];
    });
  }
  if (plan.plan.classification !== "migration") {
    return finish(() => refusal(report, { reason: `cannot apply: plan classification is ${plan.plan.classification} — the repository state cannot be verified or is newer than this toolchain — resolve the preflight issues and scope escapes (managed content outside the checkout) first`, blockers: plan.plan.blockers }));
  }
  if (plan.migration.status === "blocked" || plan.migration.collisions.length > 0) {
    return finish(() => refusal(report, {
      reason: `cannot apply: the plan is blocked — ${plan.migration.collisions.map((item) => `${item.kind} at ${item.target}${item.sources.length > 0 ? ` (sources: ${item.sources.join(", ")})` : ""}`).join("; ") || plan.plan.next}`,
      blockers: plan.plan.blockers,
    }));
  }
  // --- resolutions -----------------------------------------------------------
  // Evaluated before the write-boundary gates: a repository that cannot
  // migrate gets its semantic answer (missing/blocked decisions) instead of
  // an environment error — the boundary only gates real writes.
  let resolutionsInput: ResolutionsInput = {};
  if (options.resolutions !== undefined) {
    resolutionsInput = isPlainObject(options.resolutions) ? options.resolutions : {};
  } else if (options.resolutionsFile !== undefined) {
    const file = path.resolve(cwd, options.resolutionsFile);
    if (!isInsideCheckout(cwd, file)) {
      return finish(() => refusal(report, `--resolutions must stay inside the checkout: ${options.resolutionsFile}`));
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isPlainObject(parsed)) {
        return finish(() => refusal(report, `--resolutions ${options.resolutionsFile} must be a JSON object`));
      }
      resolutionsInput = parsed as ResolutionsInput;
    } catch (error: unknown) {
      return finish(() => refusal(report, `cannot read --resolutions ${options.resolutionsFile}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (resolutionsInput.schemaVersion !== undefined && resolutionsInput.schemaVersion !== 1) {
    return finish(() => refusal(report, `resolutions schemaVersion is ${JSON.stringify(resolutionsInput.schemaVersion)}, expected 1`));
  }
  if (resolutionsInput.planHash !== undefined && resolutionsInput.planHash !== plan.plan.planHash) {
    return finish(() => refusal(report, `resolutions bind planHash ${JSON.stringify(resolutionsInput.planHash)} but the current plan is ${plan.plan.planHash} — replan and re-declare`));
  }
  const normalized = normalizeResolutions(plan, resolutionsInput);
  const gateProblems: string[] = [];
  for (const item of normalized.unknown) gateProblems.push(`unknown resolution target ${item}`);
  for (const item of normalized.errors) gateProblems.push(item.message);
  for (const decision of normalized.missing) {
    gateProblems.push(`${decision.decisionId} (${decision.path}): required decision unresolved — ${decision.summary}`);
  }
  for (const item of normalized.blocked) {
    gateProblems.push(`${item.decisionId} (${item.path}): resolution ${JSON.stringify(item.choice)} requires a human step before this plan can run${item.note !== undefined ? ` — ${item.note}` : ""}`);
  }
  if (gateProblems.length > 0) {
    return finish(() => refusal(report, {
      reason: `cannot apply: this repository requires the full migration path and ${gateProblems.length} resolution problem(s) remain:\n- ${gateProblems.join("\n- ")}`,
      blockers: [
        ...plan.plan.blockers,
        ...normalized.missing.map((decision): PreflightIssue => ({ reason: "legacy-relations", path: decision.path, detail: `${decision.decisionId}: ${decision.summary}` })),
        ...normalized.blocked.map((item): PreflightIssue => ({ reason: "legacy-relations", path: item.path, detail: `${item.decisionId}: ${item.choice}` })),
      ],
    }));
  }

  // --- derive the world ------------------------------------------------------
  const byPath = new Map(plan.inventory.documents.map((doc) => [doc.path, doc]));
  const decisionsByPath = new Map<string, SemanticDecision[]>();
  for (const decision of plan.migration.semanticDecisions) {
    decisionsByPath.set(decision.path, [...(decisionsByPath.get(decision.path) ?? []), decision]);
  }
  const ctx: WorldCtx = {
    cwd, plan, resolved: normalized.values, handoffs: normalized.handoffs,
    byPath, decisionsByPath, errors: [], now,
  };
  const world = buildWorld(ctx);
  if (ctx.errors.length > 0) {
    return finish(() => refusal(report, `cannot apply: ${ctx.errors.length} resolution/world problem(s):\n- ${ctx.errors.join("\n- ")}`));
  }
  planDerivedIndexes(cwd, world);

  // --- write-boundary gates (only once everything else can run) ---------------
  const dirty = worktreeDirty(cwd);
  if (dirty === true && options.allowDirty !== true) {
    return finish(() => refusal(report, "cannot apply: the worktree is dirty — commit or stash first (or pass --allow-dirty to pin the risk explicitly)"));
  }
  try {
    ensureStateRootBoundary(cwd, resolveStateRoot(cwd));
  } catch (error: unknown) {
    const detail = error instanceof StoreError ? error.message : String(error);
    return finish(() => refusal(report, `cannot apply: execution state root boundary fails — ${detail}`));
  }
  if (world.docWrites.length === 0 && world.runs.length === 0 && world.removals.length === 0 && !world.manifestPlanned) {
    return finish(() => refusal(report, "cannot apply: the resolved plan produces no writes — nothing to do"));
  }

  // --- journal + stages --------------------------------------------------------
  const opened = await openJournal(cwd, plan, normalized, options);
  if ("error" in opened) {
    return finish(() => refusal(report, opened.error));
  }
  const journal = opened.journal;
  report.stage = journal.stage;
  try {
    runTransform(cwd, journal, world, ctx, options);
    journal.stage = "validate";
    writeJournal(cwd, journal, now);
    crashAt(options, "transform");
    await publishAndFinalize(cwd, journal, options, report);
  } catch (error: unknown) {
    // The journal survives — recovery resumes or rolls back from exactly
    // where the write sequence stopped.
    const message = error instanceof Error ? error.message : String(error);
    const journalNow = readJournal(cwd).journal;
    return finish(() => {
      report.stage = journalNow?.stage ?? journal.stage;
      report.steps = { total: journal.steps.length, done: journal.steps.filter((step) => step.state === "done").length };
      report.postflight = journalNow?.postflight ?? null;
      refusal(report, `migration aborted at stage ${report.stage}: ${message}\nRun \`migrate recovery --resume\` to continue or \`migrate recovery --rollback\` to undo.`);
    });
  }
  return finish(() => {
    const clean = evaluateSchemaPreflight(cwd);
    report.applied = clean.status === "current";
    report.ok = report.applied;
    report.stage = "done";
    report.steps = { total: journal.steps.length, done: journal.steps.filter((step) => step.state === "done").length };
    report.docsWritten = sortStrings(world.docWrites.map((write) => write.target));
    report.runsImported = sortStrings(world.runs.map((run) => run.runId));
    report.removals = sortStrings(world.removals.map((removal) => removal.path));
    report.followUps = journal.followUps;
    report.postflight = journal.postflight;
    report.reason = report.applied
      ? `migration applied: ${report.docsWritten.length} doc(s), ${report.runsImported.length} run(s), ${report.removals.length} removal(s) — schema manifest is current`
      : `migration wrote its outputs but the final preflight is ${clean.status} — inspect with migrate recovery`;
  });
}

// ---------------------------------------------------------------------------
// Recovery — inspect / resume / rollback
// ---------------------------------------------------------------------------

function summarizeJournal(journal: MigrationJournal): RecoveryReport["journal"] {
  return {
    planHash: journal.planHash,
    stage: journal.stage,
    stepsDone: journal.steps.filter((step) => step.state === "done").length,
    stepsTotal: journal.steps.length,
    removalsDone: journal.removals.filter((removal) => removal.state === "done").length,
    removalsTotal: journal.removals.length,
  };
}

// Rollback: undo done steps in reverse, restore originals, drop the journal.
// Every op maps to a best-effort inverse; irreversible steps report instead
// of pretending.
function rollbackJournal(cwd: string, journal: MigrationJournal, now: Clock): { restored: string[]; deleted: string[]; irreversible: string[]; conflicts: string[] } {
  const staging = stagingAbs(cwd, journal);
  const restored: string[] = [];
  const deleted: string[] = [];
  const irreversible: string[] = [];
  const conflicts: string[] = [];
  const stagedBytes = (rel: string | null): string | null => {
    if (rel === null) return null;
    const abs = path.join(staging, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  };
  const restoreBackup = (target: string, backup: string | null): void => {
    const abs = path.resolve(cwd, target);
    const backupAbs = backup === null ? null : path.join(staging, backup);
    if (backupAbs !== null && fs.existsSync(backupAbs)) {
      if (fs.statSync(backupAbs).isDirectory()) {
        fs.rmSync(abs, { recursive: true, force: true });
        copyTree(backupAbs, abs);
      } else {
        atomicWriteFile(abs, fs.readFileSync(backupAbs, "utf8"));
      }
      restored.push(target);
    } else {
      // No captured original — the pre-migration state was "absent", so
      // deleting whatever the publish put there restores exactly that.
      // Nothing to delete means nothing to report.
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        deleted.push(target);
      }
    }
  };
  // Steps in reverse execution order — cleanup/manifest/handoffs undo last.
  for (const step of [...journal.steps].reverse()) {
    if (step.state !== "done") continue;
    const abs = path.resolve(cwd, step.target);
    try {
      switch (step.op) {
        case "doc-create": {
          const staged = stagedBytes(step.staged);
          if (fs.existsSync(abs)) {
            const current = fs.readFileSync(abs, "utf8");
            if (staged !== null && current !== staged) {
              conflicts.push(`${step.target}: content changed after publish — refusing to remove (manual review)`);
              break;
            }
            // A create that adopted a pre-existing file carries its
            // original as a backup — restore it rather than deleting a
            // file that was never the migration's.
            const backup = step.backup ?? null;
            if (backup !== null) {
              restoreBackup(step.target, backup);
              break;
            }
            fs.rmSync(abs, { force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "doc-edit":
        case "manifest": {
          const backupRel = step.backup ?? (step.op === "manifest" ? stagedBackupRel(SCHEMA_MANIFEST_PATH) : stagedBackupRel(step.target));
          const backupAbs = path.join(staging, backupRel);
          if (fs.existsSync(backupAbs)) {
            restoreBackup(step.target, backupRel);
          } else if (fs.existsSync(abs)) {
            fs.rmSync(abs, { force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "run-import": {
          const runDir = path.resolve(cwd, EXECUTION_STATE_ROOT, "runs", step.target);
          if (!fs.existsSync(runDir)) break;
          if (step.detail.created === false) break; // pre-existing identical run — never ours to remove
          if (step.detail.created === true) {
            fs.rmSync(runDir, { recursive: true, force: true });
            deleted.push(step.target);
            break;
          }
          // No created flag (journal predates it or the import crashed
          // mid-write): a loadable run is foreign — keep it; an unloadable
          // one is our half-write — remove it.
          try {
            loadRun(cwd, step.target);
          } catch {
            fs.rmSync(runDir, { recursive: true, force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "remove": {
          restoreBackup(step.target, step.backup);
          break;
        }
        case "index": {
          const backupRel = stagedBackupRel(step.target);
          const backupAbs = path.join(staging, backupRel);
          if (fs.existsSync(backupAbs)) {
            restoreBackup(step.target, backupRel);
          } else if (fs.existsSync(abs)) {
            fs.rmSync(abs, { force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "run-record": {
          if (fs.existsSync(abs)) {
            fs.rmSync(abs, { force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "export": {
          if (fs.existsSync(abs)) {
            fs.rmSync(abs, { force: true });
            deleted.push(step.target);
          }
          break;
        }
        case "handoff-finalize": {
          irreversible.push(`${step.target}: run ${String(step.detail.runId)} was finalized (${String(step.detail.status)}) — restore it by importing its export or re-approving`);
          break;
        }
        case "cleanup":
          break;
        default:
          irreversible.push(`${step.target}: no inverse for op ${step.op}`);
      }
    } catch (error: unknown) {
      conflicts.push(`${step.target}: rollback step failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const removal of journal.removals) {
    if (removal.state !== "done") continue;
    if (journal.steps.some((step) => step.op === "remove" && step.target === removal.path && step.state === "done")) continue; // already restored above
    try {
      restoreBackup(removal.path, removal.backup);
      removal.state = "pending";
    } catch (error: unknown) {
      conflicts.push(`${removal.path}: restore failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  fs.rmSync(journalAbs(cwd), { force: true });
  fs.rmSync(staging, { recursive: true, force: true });
  // Prune directories the engine created — deepest first, only while still
  // empty. A dir that pre-existed the migration is not in createdDirs, and
  // one still holding content (foreign or user files) refuses to remove.
  for (const dir of [...journal.createdDirs].sort((a, b) => b.length - a.length || compareCodeUnits(b, a))) {
    try {
      fs.rmdirSync(path.resolve(cwd, dir));
    } catch { /* absent or non-empty — either way it stays */ }
  }
  void now;
  return { restored: restored.sort(compareCodeUnits), deleted: deleted.sort(compareCodeUnits), irreversible, conflicts };
}

// Resume a journal whose transform never committed: re-derive the world
// from the plan the journal pinned and the resolutions it recorded. The
// plan rides inside the journal because a fresh plan can never rebuild to
// the same hash once engine artifacts (journal, staging) are on disk — and
// the pinned inputs were already proven byte-identical by the drift check.
// Resolution values and run handoffs are journal data: the only fields
// that steer writes are re-validated here (write targets contained,
// handoffs through the same normalizer apply uses) so a tampered journal
// cannot aim writes outward.
function rebuildWorldForResume(
  cwd: string,
  journal: MigrationJournal,
  now: Clock,
): { world: World; ctx: WorldCtx } | { error: string } {
  const plan = journal.plan;
  if (plan === undefined) {
    return { error: "the journal predates embedded plans — the transform cannot be rebuilt" };
  }
  if (plan.plan.planHash !== journal.planHash || plan.plan.classification !== "migration") {
    return { error: "the journal's embedded plan does not match its pinned hash or is not a migration plan — the journal is inconsistent" };
  }
  // The embedded plan is journal data until proven contained: every path it
  // contributes is re-validated here — an escaping entry could steer reads
  // or writes outside the checkout. (readJournal's sweep covers the
  // journal's own step/removal/staging fields; plan paths are only
  // consumed by this rebuild, so this is where their check belongs.)
  const planPaths: unknown[] = [
    ...(plan.inventory.inputFiles ?? []),
    ...(plan.inventory.documents ?? []).flatMap((doc) => [doc.path, doc.localeSiblingOf, ...(doc.localeSiblings ?? [])]),
    ...(plan.inventory.indexes ?? []).flatMap((index) => [index.path, index.dir]),
    ...(plan.inventory.experimentLogs ?? []).map((exp) => exp.path),
    ...(plan.inventory.callerBookkeeping ?? []).map((entry) => entry.path),
    ...(plan.inventory.legacyRelations ?? []).flatMap((entry) => [entry.path, ...(entry.targets ?? [])]),
    ...(plan.inventory.foreignState ?? []).map((entry) => entry.path),
    ...(plan.migration.plannedWrites ?? []).flatMap((write) => [write.target, write.source]),
    ...(plan.migration.removals ?? []).map((removal) => removal.path),
    ...(plan.migration.collisions ?? []).flatMap((collision) => [collision.target, ...(collision.sources ?? [])]),
    ...(plan.migration.semanticDecisions ?? []).flatMap((decision) => [decision.path, ...(decision.targets ?? [])]),
  ];
  for (const field of planPaths) {
    if (field === null || field === undefined) continue;
    const normalizedField = typeof field === "string" ? normalizeContainedRelPath(field) : null;
    if (normalizedField === null || isVcsInternalPath(normalizedField)) {
      return { error: `the journal's embedded plan names a path ${JSON.stringify(field)} that escapes the checkout or touches VCS internals — refusing to trust it` };
    }
  }
  for (const runId of [
    ...(plan.inventory.runs ?? []).map((run) => run.runId),
    ...(plan.migration.runHandoffs ?? []).map((handoff) => handoff.runId),
  ]) {
    if (!isValidId(runId)) {
      return { error: `the journal's embedded plan names a run id ${JSON.stringify(runId)} that is not a valid artifact id — refusing to trust it` };
    }
  }
  const byPath = new Map(plan.inventory.documents.map((doc) => [doc.path, doc]));
  const decisionsByPath = new Map<string, SemanticDecision[]>();
  for (const decision of plan.migration.semanticDecisions) {
    decisionsByPath.set(decision.path, [...(decisionsByPath.get(decision.path) ?? []), decision]);
  }
  const resolved = new Map<string, Record<string, unknown>>();
  for (const [id, value] of Object.entries(journal.resolutions)) {
    if (!isPlainObject(value)) {
      return { error: `the journal's resolution ${id} is not an object — the journal cannot steer a rebuild.` };
    }
    if (value.action === "write") {
      const writeTarget = typeof value.target === "string" ? normalizeContainedRelPath(value.target) : null;
      if (writeTarget === null || isProtectedWriteTarget(writeTarget)) {
        return { error: `the journal's resolution ${id} names a write target ${JSON.stringify(value.target)} outside the checkout or in a protected namespace — refusing to trust it.` };
      }
    }
    resolved.set(id, value as Record<string, unknown>);
  }
  const handoffs = new Map<string, { method: "keep" | "export" | "finalize"; out: string | null; status: RunStatus | null }>();
  for (const [runId, raw] of Object.entries(journal.runHandoffs)) {
    const normalized = normalizeRunHandoff(runId, raw);
    if ("error" in normalized) {
      return { error: `the journal's run handoff for ${runId} is invalid: ${normalized.error}` };
    }
    handoffs.set(runId, normalized);
  }
  const ctx: WorldCtx = { cwd, plan, resolved, handoffs, byPath, decisionsByPath, errors: [], now };
  const world = buildWorld(ctx);
  if (ctx.errors.length > 0) {
    return { error: `the journaled resolutions no longer produce a buildable world:\n- ${ctx.errors.join("\n- ")}` };
  }
  planDerivedIndexes(cwd, world);
  return { world, ctx };
}

async function recoverMigration(cwd: string, options: RecoveryOptions = {}): Promise<RecoveryReport> {
  const now = options.now ?? systemClock;
  const action = options.action ?? "inspect";
  const { journal, error } = readJournal(cwd);
  const preflight = () => evaluateSchemaPreflight(cwd);
  const base: RecoveryReport = {
    command: "migrate recovery",
    status: "no-migration-in-progress",
    recovered: false,
    journalPath: journal !== null || error !== null ? MIGRATION_JOURNAL_PATH : null,
    journal: journal !== null ? summarizeJournal(journal) : null,
    apply: null,
    rollback: null,
    note: "",
    preflight: preflight(),
    ok: true,
  };
  if (journal === null) {
    if (error !== null) {
      base.status = "migration-incomplete";
      base.ok = false;
      base.note = error;
      return base;
    }
    base.note = "no migration journal present";
    return base;
  }
  base.status = "migration-incomplete";
  base.note = `migration in flight at stage ${journal.stage} — ${journal.steps.filter((step) => step.state === "done").length}/${journal.steps.length} steps done`;
  if (journal.postflight !== null && journal.postflight.pass === false) {
    base.note += `; last postflight failed: ${journal.postflight.detail}`;
  }
  if (action === "inspect") {
    base.ok = false;
    base.preflight = preflight();
    return base;
  }
  if (options.expect !== undefined && options.expect !== journal.planHash) {
    base.ok = false;
    base.status = "resume-refused";
    base.note = `journal pins planHash ${journal.planHash} but --expect ${options.expect} was given — refusing`;
    return base;
  }
  if (action === "rollback") {
    const result = rollbackJournal(cwd, journal, now);
    base.rollback = result;
    base.journal = null;
    base.journalPath = null;
    base.preflight = preflight();
    if (result.conflicts.length > 0) {
      base.status = "rollback-incomplete";
      base.ok = false;
      base.note = `rollback hit ${result.conflicts.length} conflict(s): ${result.conflicts.join("; ")} — review the listed paths manually`;
    } else {
      base.status = "recovered-rollback";
      base.recovered = true;
      base.ok = true;
      base.note = `rolled back: ${result.restored.length} path(s) restored, ${result.deleted.length} artifact(s) removed${result.irreversible.length > 0 ? `; ${result.irreversible.length} operation(s) were irreversible` : ""}`;
    }
    if (result.irreversible.length > 0) {
      base.note += ` — ${result.irreversible.join("; ")}`;
    }
    return base;
  }
  // action === "resume"
  const drift = verifyResumeDrift(cwd, journal);
  const staging = stagingAbs(cwd, journal);
  if (drift.length > 0) {
    base.ok = false;
    base.status = "resume-refused";
    base.note = `cannot resume — ${drift.join("; ")}`;
    return base;
  }

  if (journal.steps.length === 0) {
    // The transform never committed — the journal was opened, or crashed
    // mid-transform, before any step was journaled. Nothing is resumable
    // step-wise, so the world is rebuilt from the pinned plan + journaled
    // resolutions and the transform re-runs in full (bounded: one pass per
    // resume; another crash leaves the same recoverable shape).
    if (journal.staged.length > 0 || journal.removals.length > 0) {
      base.ok = false;
      base.status = "resume-refused";
      base.note = "cannot resume — the journal pins staged artifacts or removals but no steps; the transform state is inconsistent. Run `migrate recovery --rollback`, then re-apply.";
      return base;
    }
    const rebuilt = rebuildWorldForResume(cwd, journal, now);
    if ("error" in rebuilt) {
      base.ok = false;
      base.status = "resume-refused";
      base.note = `cannot resume — ${rebuilt.error} Run \`migrate recovery --rollback\` to undo.`;
      return base;
    }
    try {
      // Partial staging from the crash is unjournaled — drop it so the
      // fresh transform pins a clean set.
      fs.rmSync(staging, { recursive: true, force: true });
      runTransform(cwd, journal, rebuilt.world, rebuilt.ctx, options as ApplyOptions);
      journal.stage = "validate";
      writeJournal(cwd, journal, now);
    } catch (errorCaught: unknown) {
      const message = errorCaught instanceof Error ? errorCaught.message : String(errorCaught);
      const current = readJournal(cwd).journal;
      base.ok = false;
      base.status = "migration-incomplete";
      base.journal = current !== null ? summarizeJournal(current) : base.journal;
      base.note = `resume aborted while re-running the transform: ${message}`;
      base.preflight = preflight();
      return base;
    }
  }

  // Staging pins vs disk — after any re-transform the pins are fresh; for a
  // committed transform they prove the staged bytes survived untouched.
  const stageProblems = journal.staged.length > 0 ? verifyStaging(staging, journal) : [];
  if (stageProblems.length > 0) {
    base.ok = false;
    base.status = "resume-refused";
    base.note = `cannot resume — ${stageProblems.join("; ")}. Run \`migrate recovery --rollback\` to undo.`;
    return base;
  }

  const applyReport = emptyApplyReport(cwd, journal.planHash);
  applyReport.resumed = true;
  try {
    await publishAndFinalize(cwd, journal, options as ApplyOptions, applyReport);
  } catch (errorCaught: unknown) {
    const message = errorCaught instanceof Error ? errorCaught.message : String(errorCaught);
    const current = readJournal(cwd).journal;
    base.ok = false;
    base.status = "migration-incomplete";
    base.journal = current !== null ? summarizeJournal(current) : base.journal;
    base.note = `resume aborted at stage ${current?.stage ?? journal.stage}: ${message}`;
    base.preflight = preflight();
    return base;
  }
  const clean = preflight();
  base.preflight = clean;
  if (clean.status === "current") {
    base.status = "recovered-resume";
    base.recovered = true;
    base.ok = true;
    base.journal = null;
    base.journalPath = null;
    base.note = "resumed migration completed — schema is current";
    applyReport.applied = true;
    applyReport.ok = true;
    applyReport.stage = "done";
    applyReport.steps = { total: journal.steps.length, done: journal.steps.filter((step) => step.state === "done").length };
  } else {
    base.status = "migration-incomplete";
    base.ok = false;
    base.note = `resumed migration finished its writes but preflight is ${clean.status} — inspect the repository state`;
  }
  applyReport.reason = base.note;
  applyReport.preflight = clean;
  applyReport.postflight = journal.postflight;
  base.apply = applyReport;
  return base;
}

export { applyMigration, recoverMigration };
export type { ApplyOptions, ApplyReport, MigrationJournal, RecoveryOptions, RecoveryReport };
