"use strict";

// ---------------------------------------------------------------------------
// Migration inventory + read-only dry-run plan (Issue #245)
// ---------------------------------------------------------------------------
//
// The migration lane's dedicated legacy readers. Everything in this module
// is reachable only through `doc_maintenance migrate plan|apply` — the
// normal runtime path never parses pre-Registry-3 formats.
//
// The inventory collects every git-era artifact the preflight can see:
// durable documents (idea/brainstorm/discovery/spec/design/adr/knowledge/
// verification), execution-bound plan/task Markdown, legacy test-spec /
// impl (IR) / exp (JSONL) artifacts, old relation vocabulary, managed and
// hand-curated indexes, caller checkpoint/receipt bookkeeping
// (`effectOutcomes`/`checkpointEvidence` front matter), foreign state
// inside `docs/.doc-driven-dev/` and `.apm/state/doc-driven-dev/`, and the
// existing Execution Store runs a migration must hand off.
//
// The plan is fully read-only and deterministic: it emits input hashes, the
// inventoried file list, planned writes, removals, collisions, mechanical
// convertibles, semantic-judgment decisions (ambiguous lifecycle / status /
// relations / evidence are surfaced as explicit resolution inputs, never
// guessed into success), residual risks, run handoff requirements, concrete
// per-element destinations, and a `planHash` pinning the entire report. A
// fresh empty repository is a *bootstrap* target, never a migration target.
//
// Conversion rules:
//   - test-spec  → Verification Design (`docs/verification`), preserving
//                  Guarantee/Rules/Examples/limits as design prose; every
//                  check binding requires an explicit target + method.
//   - plan/task  → Execution Store run snapshot (plan.md + task records);
//                  approvals are never fabricated — prior approval surfaces
//                  as an explicit re-approval decision.
//   - impl (IR)  → classified into knowledge / ADR / spec / design /
//                  evidence-candidate / diagnostic-trace. Validation prose
//                  is never converted to verified Evidence.
//   - exp JSONL  → diagnostic trace by default; other classifications are
//                  explicit decisions.
//   - caller bookkeeping → Effect Receipt / Checkpoint records or the
//                  diagnostic run trace.
//   - old relations (`derives-from`, `implements`, `verifies`,
//                  `depends-on` on durable docs, `*-by` inverses,
//                  `references`, …) are semantic decisions — never
//                  mechanically rewritten into Knowledge Relations v1.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import {
  configs,
  docTypes,
  ephemeralConfigs,
  knowledgeRelationFields,
  legacyDocTypes,
  LIFECYCLE_VALUES,
  managedDocDirs,
  PROVENANCE_RELATION_KEYS,
  resolveDocType,
} from "../../../lib/doc_types";
import {
  isIndexFileName,
  nonReferenceRelationKeys,
  normalizeDir,
} from "../../../lib/document_utils";
import {
  canonicalJson,
  isPlainObject,
  validateManifest,
} from "../../../lib/execution_store/types";
import type { RunManifest } from "../../../lib/execution_store/types";
import {
  DOC_DRIVEN_DEV_DIR,
  EXECUTION_STATE_ROOT,
  evaluateSchemaPreflight,
  walkTree,
} from "../../../lib/schema_preflight";
import type {
  PreflightIssue,
  SchemaPreflightReport,
} from "../../../lib/schema_preflight";

// ---------------------------------------------------------------------------
// Determinism helpers — code-unit ordering only (locale-independent)
// ---------------------------------------------------------------------------

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareCodeUnits);
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// Deterministic id material: first 22 base62 chars of a digest — satisfies
// the `<PREFIX>-<22 base62>` canonical-id grammar and the Execution Store
// record-id pattern.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function hashId(digestSource: string): string {
  const digest = crypto.createHash("sha256").update(digestSource, "utf8").digest();
  let out = "";
  for (let index = 0; index < 22; index += 1) out += BASE62[digest[index] % 62];
  return out;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

type PlanClassification =
  | "bootstrap"
  | "manifest-only"
  | "migration"
  | "current"
  | "recovery"
  | "blocked";

type DocumentDisposition =
  | "preserve"
  | "convert:run-plan"
  | "convert:run-task"
  | "convert:verification"
  | "classify"
  | "decision"
  | "out-of-scope";

type InventoryDocument = {
  path: string;
  sha256: string;
  kind: "durable" | "ephemeral" | "legacy" | "unknown-type" | "untyped";
  type: string | null;
  resolvedType: string | null;
  id: string | null;
  status: string | null;
  lifecycle: string | null;
  title: string | null;
  owner: string | null;
  dirKind: "durable" | "migration-owned" | "unmanaged";
  fields: string[];
  legacyRelationFields: string[];
  malformedRelationFields: string[];
  bookkeepingFields: string[];
  localeSiblingOf: string | null;
  localeSiblings: string[];
  parseError: string | null;
  disposition: DocumentDisposition;
};

type InventoryIndex = {
  path: string;
  dir: string;
  generated: boolean;
  dirKind: "durable" | "migration-owned";
  disposition: "regenerate" | "remove" | "decision";
};

type InventoryExperiment = {
  path: string;
  sha256: string;
  events: number;
  malformedLines: number;
  eventTypes: string[];
  hasValidationEvents: boolean;
};

type InventoryBookkeeping = {
  path: string;
  carrier: "plan" | "task" | "other";
  effectOutcomes: number;
  checkpointEvidence: number;
  // Fields whose payload is present but not a list — the payload cannot be
  // enumerated into records, so it is a decision item rather than a count.
  malformed: string[];
};

type InventoryLegacyRelation = {
  path: string;
  field: string;
  targets: string[];
};

type InventoryRun = {
  runId: string;
  path: string;
  status: "active" | "completed" | "aborted" | "corrupt";
  validManifest: boolean;
  tasks: number;
  checkpoints: number;
  receipts: number;
  handoffRequired: boolean;
};

type ForeignStateEntry = {
  path: string;
  kind: "file" | "dir" | "escape" | "corrupt-run";
  namespace: string;
  detail: string;
};

type PlannedWrite = {
  target: string;
  kind:
    | "schema-manifest"
    | "durable-document"
    | "run-manifest"
    | "run-plan"
    | "task-record"
    | "receipt-record"
    | "checkpoint-record"
    | "run-trace"
    | "index-regen"
    | "document-edit";
  source: string;
  destination: string;
};

type PlannedRemoval = {
  path: string;
  when: "at-finalize" | "decision";
  note: string;
};

type PlanCollision = {
  target: string;
  kind: "target-exists" | "id-exists" | "duplicate-target" | "run-exists";
  sources: string[];
  suggestedTarget: string | null;
};

type Convertible = {
  kind: string;
  path: string;
  element: string;
  field?: string;
  action: string;
  targets?: string[];
  detail: string;
};

type SemanticDecision = {
  decisionId: string;
  kind: string;
  path: string;
  element: string;
  field?: string;
  targets?: string[];
  candidates: string[];
  default: string | null;
  required: boolean;
  summary: string;
};

type OutOfScopeItem = {
  path: string;
  kind: string;
  action: string;
  detail: string;
};

type ResolutionGroup = {
  kind: string;
  count: number;
  required: boolean;
  decisionIds: string[];
  prompt: string;
};

type ResidualRisk = {
  kind: string;
  path: string | null;
  detail: string;
};

type RunHandoff = {
  runId: string;
  origin: "existing" | "migrated";
  status: string;
  handoffRequired: boolean;
  methods: string[];
};

type Destination = {
  source: string;
  element: string;
  action: "preserve" | "convert" | "map" | "decision" | "drop" | "diagnostic" | "unmapped";
  target: string;
  note?: string;
};

type MigrationPlanReport = {
  preflight: SchemaPreflightReport;
  plan: {
    classification: PlanClassification;
    applyEligible: boolean;
    requiresFullMigration: boolean;
    blockers: PreflightIssue[];
    planHash: string;
    next: string;
  };
  inventory: {
    inputFiles: string[];
    inputHash: string;
    counts: Record<string, number>;
    documents: InventoryDocument[];
    indexes: InventoryIndex[];
    experimentLogs: InventoryExperiment[];
    callerBookkeeping: InventoryBookkeeping[];
    legacyRelations: InventoryLegacyRelation[];
    runs: InventoryRun[];
    foreignState: ForeignStateEntry[];
  };
  migration: {
    status: "nothing" | "planned" | "awaiting-resolution" | "blocked";
    plannedWrites: PlannedWrite[];
    removals: PlannedRemoval[];
    collisions: PlanCollision[];
    convertibles: Convertible[];
    semanticDecisions: SemanticDecision[];
    outOfScope: OutOfScopeItem[];
    resolutionsRequired: ResolutionGroup[];
    residualRisks: ResidualRisk[];
    runHandoffs: RunHandoff[];
    destinations: Destination[];
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERATED_INDEX_MARKER = "<!-- doc-suite:generated-index -->";

const MANIFEST_NAMESPACE_FILES: ReadonlySet<string> = new Set([
  "schema.json",
  "migration.journal.json",
]);

// Front-matter keys with a declared destination somewhere in the v3 model —
// everything else on an inventoried document is an `unmapped` destination.
const KNOWN_FM_FIELDS: ReadonlySet<string> = new Set([
  "id", "type", "status", "lifecycle", "title", "created", "updated",
  "owners", "relations", "metadata", "checks", "knowledge_kind",
  "effectOutcomes", "checkpointEvidence",
]);

const V1_RELATION_FIELDS: ReadonlySet<string> = new Set(knowledgeRelationFields());

// Durable dir spellings (canonical + aliases) vs migration-owned scopes.
const DURABLE_DIRS: ReadonlySet<string> = new Set(
  docTypes.flatMap((type) => configs[type].dirs.map((dir) => normalizeDir(dir))),
);
const MIGRATION_DIRS: ReadonlySet<string> = new Set(
  [
    ...Object.values(ephemeralConfigs).flatMap((entry) => entry.formerDirs),
    ...Object.values(legacyDocTypes).flatMap((entry) => [...entry.formerDirs, ...entry.scopeDirs]),
  ].map((dir) => normalizeDir(dir)),
);

// Old `status` → proposed `lifecycle`. Only identity and dead-end mappings
// are offered as defaults; every assignment still requires an explicit
// confirmation — pre-Registry-3 lifecycle semantics are never guessed
// (#245's hard rule against assumed-success interpretation).
const LIFECYCLE_DEFAULTS: Record<string, string> = {
  draft: "draft",
  superseded: "superseded",
  archived: "retired",
  rejected: "retired",
  deprecated: "retired",
  abandoned: "retired",
  "wont-do": "retired",
  implemented: "current",
  completed: "current",
  resolved: "current",
  routed: "current",
  promoted: "current",
  accepted: "current",
  approved: "current",
  confirmed: "current",
};

// Plan-level status → run-terminal mapping. `superseded` deliberately has no
// entry: whether the plan completed or was cut is a human call.
const RUN_STATUS_DEFAULTS: Record<string, string> = {
  draft: "active",
  approved: "active",
  "in-progress": "active",
  blocked: "active",
  completed: "completed",
};

const HANDOFF_METHODS = [
  "export a portable snapshot (execution_store export --out <file>) and import it at the destination worktree",
  "declare explicit termination (execution_store finalize --status completed|aborted) before apply — copying unshared local state is not a handoff",
];

// ---------------------------------------------------------------------------
// Collection — file-level scan (read-only, containment enforced)
// ---------------------------------------------------------------------------

type FileClass =
  | "doc"
  | "index"
  | "exp"
  | "run-file"
  | "evidence-file"
  | "manifest-namespace"
  | "foreign-state"
  | "foreign-artifact"
  | "unmanaged";

type CollectedFile = {
  path: string;
  abs: string;
  cls: FileClass;
};

function isUnderDir(rel: string, dir: string): boolean {
  return rel === dir || rel.startsWith(`${dir}/`);
}

// Longest managed-dir prefix owning `rel`'s directory, or null.
function owningManagedDir(rel: string): { dir: string; kind: "durable" | "migration-owned" } | null {
  const dir = normalizeDir(path.posix.dirname(rel));
  let best: { dir: string; kind: "durable" | "migration-owned" } | null = null;
  for (const candidate of [...DURABLE_DIRS, ...MIGRATION_DIRS]) {
    if (!isUnderDir(dir, candidate)) continue;
    if (best === null || candidate.length > best.dir.length) {
      best = { dir: candidate, kind: DURABLE_DIRS.has(candidate) ? "durable" : "migration-owned" };
    }
  }
  return best;
}

function classifyPath(rel: string): FileClass {
  const name = path.posix.basename(rel);
  if (isUnderDir(rel, DOC_DRIVEN_DEV_DIR)) {
    return MANIFEST_NAMESPACE_FILES.has(name) ? "manifest-namespace" : "foreign-state";
  }
  if (isUnderDir(rel, EXECUTION_STATE_ROOT)) {
    const segments = rel.slice(EXECUTION_STATE_ROOT.length).replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments[0] === "runs" && segments.length >= 3) return "run-file";
    if (segments[0] === "evidence") {
      const last = segments[segments.length - 1];
      const declared = segments.length === 1
        || (segments.length === 2 && (segments[1] === "manifest.json" || segments[1] === "index.json" || /\.tmp-\d+-\d+$/.test(last)))
        || (segments.length === 3 && segments[1] === "records" && (last.endsWith(".json") || /\.tmp-\d+-\d+$/.test(last)));
      return declared ? "evidence-file" : "foreign-state";
    }
    return "foreign-state";
  }
  if (isUnderDir(rel, "docs/impl")) {
    if (rel.endsWith(".jsonl")) return "exp";
    if (rel.endsWith(".md")) return isIndexFileName(name) ? "index" : "doc";
    return "foreign-artifact";
  }
  if (rel.endsWith(".md")) {
    const owner = owningManagedDir(rel);
    if (owner !== null) return isIndexFileName(name) ? "index" : "doc";
  }
  return "unmanaged";
}

function collectFiles(cwd: string): { files: CollectedFile[]; escapes: ForeignStateEntry[] } {
  const files: CollectedFile[] = [];
  const escapes: ForeignStateEntry[] = [];
  const roots = [
    "docs",
    ...managedDocDirs().filter((dir) => !dir.startsWith("docs/")),
    EXECUTION_STATE_ROOT,
  ];
  const walked = new Set<string>();
  for (const root of roots) {
    const abs = path.resolve(cwd, root);
    let key = abs;
    try { key = fs.realpathSync(abs); } catch { /* absent root */ }
    if (walked.has(key)) continue;
    walked.add(key);
    const ok = walkTree(
      cwd,
      root,
      (rel, isDir) => {
        if (isDir) return;
        files.push({ path: rel, abs: path.resolve(cwd, rel), cls: classifyPath(rel) });
      },
      (rel, kind) => {
        escapes.push({
          path: rel,
          kind: "escape",
          namespace: kind === "dir" ? "dir" : "file",
          detail: `${rel} escapes the checkout through a link — never followed`,
        });
      },
    );
    if (!ok && fs.existsSync(abs)) {
      // walkTree refused the root: either it resolves outside the checkout
      // through a link, or it is not a directory at all — report which.
      let directory = false;
      try { directory = fs.statSync(abs).isDirectory(); } catch { /* stat failure reports the same boundary failure */ }
      escapes.push({
        path: root,
        kind: "escape",
        namespace: "dir",
        detail: directory
          ? `${root} resolves outside the checkout through a link — its content is never inventoried`
          : `${root} exists but is not a directory — its content cannot be inventoried`,
      });
    }
  }
  return { files, escapes };
}

// ---------------------------------------------------------------------------
// Document reader — the legacy front-matter/body probe
// ---------------------------------------------------------------------------

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
    // Options object: keeps this probe out of gray-matter's process-global
    // cache (same contract as the shared preflight probe).
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

// `relations` → field/target-list pairs; `malformed` marks a non-map value
// so the caller surfaces a decision instead of guessing. `malformedFields`
// lists per-field values that are neither a string nor a list of strings —
// a payload that cannot be enumerated is a semantic decision, never an
// "empty" field silently dropped.
function relationEntries(data: Record<string, unknown>): { entries: { field: string; targets: string[] }[]; malformed: boolean; malformedFields: { field: string; raw: unknown }[] } {
  const raw = data.relations;
  if (raw === undefined || raw === null) return { entries: [], malformed: false, malformedFields: [] };
  if (!isPlainObject(raw)) return { entries: [], malformed: true, malformedFields: [] };
  const entries: { field: string; targets: string[] }[] = [];
  const malformedFields: { field: string; raw: unknown }[] = [];
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      entries.push({ field, targets: trimmed === "" ? [] : [trimmed] });
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      const targets = value
        .map((item) => item.trim())
        .filter((item) => item !== "");
      entries.push({ field, targets });
      continue;
    }
    malformedFields.push({ field, raw: value });
  }
  return { entries, malformed: false, malformedFields };
}

function firstH1(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

// Cheap inline-link enumeration for the rename/stale analysis — an
// inventory scan, not the lint-grade Markdown parse.
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
function bodyLinks(body: string): string[] {
  const targets: string[] = [];
  for (const match of body.matchAll(LINK_PATTERN)) {
    const target = match[1].trim();
    if (target === "" || target.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    targets.push(target);
  }
  return sortStrings(targets);
}

// ---------------------------------------------------------------------------
// Inventory assembly
// ---------------------------------------------------------------------------

function dirKindForDoc(rel: string): "durable" | "migration-owned" | "unmanaged" {
  const owner = owningManagedDir(rel);
  if (owner !== null) return owner.kind;
  if (isUnderDir(rel, "docs/impl")) return "migration-owned";
  return "unmanaged";
}

function artifactStem(rel: string): string {
  const base = path.posix.basename(rel).replace(/\.md$/i, "");
  const locale = /^(.+)\.[a-z]{2}$/i.exec(base);
  return `${path.posix.dirname(rel)}::${locale ? locale[1] : base}`;
}

function buildDocuments(files: CollectedFile[], rawOf: (rel: string) => RawDoc): InventoryDocument[] {
  const docFiles = files.filter((file) => file.cls === "doc");
  const byStem = new Map<string, string[]>();
  for (const file of docFiles) {
    const stem = artifactStem(file.path);
    byStem.set(stem, [...(byStem.get(stem) ?? []), file.path]);
  }
  const primaryOf = new Map<string, string>();
  for (const [stem, paths] of byStem) {
    const nonLocalized = paths.filter((rel) => !/\.[a-z]{2}\.md$/i.test(path.posix.basename(rel)));
    primaryOf.set(stem, sortStrings(nonLocalized.length > 0 ? nonLocalized : paths)[0]);
  }

  const documents: InventoryDocument[] = [];
  for (const file of docFiles) {
    const raw = rawOf(file.path);
    const data = raw.data;
    const type = stringField(data, "type");
    const resolved = type === null ? null : resolveDocType(type);
    const { entries, malformed, malformedFields } = relationEntries(data);
    const legacyFields = entries
      .filter((entry) => !nonReferenceRelationKeys.has(entry.field)
        && !(PROVENANCE_RELATION_KEYS as readonly string[]).includes(entry.field)
        && !V1_RELATION_FIELDS.has(entry.field))
      .map((entry) => entry.field);
    // Populated bookkeeping is any present payload — a non-list value still
    // carries content and surfaces as a decision, never an invisible read.
    const bookkeeping = ["effectOutcomes", "checkpointEvidence"]
      .filter((field) => {
        const value = data[field];
        return Array.isArray(value) ? value.length > 0 : value !== undefined;
      });
    const dirKind = dirKindForDoc(file.path);
    const primary = primaryOf.get(artifactStem(file.path)) ?? file.path;
    const parseError = raw.parseError ?? (malformed ? "relations: is not a map of relation keys to target lists" : null);
    const kind: InventoryDocument["kind"] = type === null
      ? "untyped"
      : resolved === null || resolved.kind === "unknown"
        ? "unknown-type"
        : resolved.kind === "durable"
          ? "durable"
          : resolved.kind === "ephemeral"
            ? "ephemeral"
            : "legacy";

    let disposition: DocumentDisposition;
    if (parseError !== null || (resolved !== null && resolved.kind === "unknown")) {
      disposition = "decision";
    } else if (resolved !== null && resolved.kind === "ephemeral") {
      disposition = resolved.entry.type === "plan" ? "convert:run-plan" : "convert:run-task";
    } else if (resolved !== null && resolved.kind === "legacy") {
      disposition = resolved.entry.type === "test-spec" ? "convert:verification" : "classify";
    } else if (type === null) {
      disposition = dirKind === "migration-owned" ? "decision" : "out-of-scope";
    } else {
      disposition = dirKind === "migration-owned" ? "decision" : "preserve";
    }

    documents.push({
      path: file.path,
      sha256: sha256(raw.raw),
      kind,
      type,
      resolvedType: resolved !== null && resolved.kind !== "unknown" ? resolved.entry.type : null,
      id: stringField(data, "id"),
      status: stringField(data, "status"),
      lifecycle: stringField(data, "lifecycle"),
      title: stringField(data, "title"),
      owner: resolved !== null && resolved.kind !== "unknown" ? resolved.entry.owner : null,
      dirKind,
      fields: sortStrings(Object.keys(data)),
      legacyRelationFields: sortStrings(legacyFields),
      malformedRelationFields: sortStrings(malformedFields.map((entry) => entry.field)),
      bookkeepingFields: bookkeeping,
      localeSiblingOf: primary === file.path ? null : primary,
      localeSiblings: primary === file.path ? sortStrings((byStem.get(artifactStem(file.path)) ?? []).filter((rel) => rel !== file.path)) : [],
      parseError,
      disposition,
    });
  }
  return documents.sort((a, b) => compareCodeUnits(a.path, b.path));
}

function buildIndexes(files: CollectedFile[]): InventoryIndex[] {
  const indexes: InventoryIndex[] = [];
  for (const file of files.filter((entry) => entry.cls === "index")) {
    let generated = false;
    try {
      generated = fs.readFileSync(file.abs, "utf8").includes(GENERATED_INDEX_MARKER);
    } catch { /* unreadable index counts as hand-curated */ }
    const dirKind = dirKindForDoc(file.path) === "migration-owned" ? "migration-owned" : "durable";
    indexes.push({
      path: file.path,
      dir: normalizeDir(path.posix.dirname(file.path)),
      generated,
      dirKind,
      // Managed indexes are derived views: a migration-owned dir's index is
      // removed with its corpus; a durable dir's regenerates after apply.
      // Hand-curated content is never a mechanical verdict.
      disposition: generated
        ? (dirKind === "migration-owned" ? "remove" : "regenerate")
        : "decision",
    });
  }
  return indexes.sort((a, b) => compareCodeUnits(a.path, b.path));
}

function buildExperiments(files: CollectedFile[]): InventoryExperiment[] {
  const experiments: InventoryExperiment[] = [];
  for (const file of files.filter((entry) => entry.cls === "exp")) {
    let raw = "";
    try {
      raw = fs.readFileSync(file.abs, "utf8");
    } catch { /* unreadable */ }
    let events = 0;
    let malformedLines = 0;
    const types = new Set<string>();
    for (const line of raw.split(/\r?\n/).filter((entry) => entry.trim() !== "")) {
      try {
        const parsed: unknown = JSON.parse(line);
        events += 1;
        if (isPlainObject(parsed) && typeof parsed.type === "string") types.add(parsed.type);
      } catch {
        malformedLines += 1;
      }
    }
    experiments.push({
      path: file.path,
      sha256: sha256(raw),
      events,
      malformedLines,
      eventTypes: sortStrings(types),
      hasValidationEvents: types.has("validation"),
    });
  }
  return experiments.sort((a, b) => compareCodeUnits(a.path, b.path));
}

function buildRuns(files: CollectedFile[]): { runs: InventoryRun[]; foreign: ForeignStateEntry[] } {
  const runFiles = new Map<string, CollectedFile[]>();
  const foreign: ForeignStateEntry[] = [];
  for (const file of files) {
    if (file.cls === "run-file") {
      const rel = file.path.slice(`${EXECUTION_STATE_ROOT}/runs/`.length);
      const runId = rel.split("/")[0];
      runFiles.set(runId, [...(runFiles.get(runId) ?? []), file]);
    } else if (file.cls === "foreign-state" || file.cls === "foreign-artifact") {
      foreign.push({
        path: file.path,
        kind: "file",
        namespace: isUnderDir(file.path, EXECUTION_STATE_ROOT) ? EXECUTION_STATE_ROOT
          : isUnderDir(file.path, DOC_DRIVEN_DEV_DIR) ? DOC_DRIVEN_DEV_DIR
            : normalizeDir(path.posix.dirname(file.path)),
        detail: file.cls === "foreign-artifact"
          ? "unclassified artifact inside docs/impl — neither a record nor an experiment log"
          : "unaccounted-for state file — no v3 consumer can see it",
      });
    }
  }
  const runs: InventoryRun[] = [];
  for (const [runId, members] of [...runFiles.entries()].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    const dir = `${EXECUTION_STATE_ROOT}/runs/${runId}`;
    const manifestFile = members.find((member) => member.path === `${dir}/manifest.json`)
      ?? members.find((member) => /^(run|run\.manifest|run-manifest)\.json$/i.test(path.posix.basename(member.path)));
    let manifest: RunManifest | null = null;
    if (manifestFile) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifestFile.abs, "utf8"));
        if (validateManifest(parsed) && parsed.runId === runId) manifest = parsed;
      } catch { /* unreadable manifest */ }
    }
    const count = (kind: string) => members.filter((member) => isUnderDir(member.path, `${dir}/${kind}`) && member.path.endsWith(".json")).length;
    if (manifest === null) {
      foreign.push({
        path: dir,
        kind: "corrupt-run",
        namespace: EXECUTION_STATE_ROOT,
        detail: `run ${runId} has no valid manifest.json — incomplete or foreign run content`,
      });
    }
    runs.push({
      runId,
      path: dir,
      status: manifest === null ? "corrupt" : manifest.status,
      validManifest: manifest !== null,
      tasks: count("tasks"),
      checkpoints: count("checkpoints"),
      receipts: count("receipts"),
      handoffRequired: manifest?.status === "active",
    });
  }
  return { runs: runs.sort((a, b) => compareCodeUnits(a.runId, b.runId)), foreign };
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

type DocMaps = {
  byPath: Map<string, InventoryDocument>;
  byId: Map<string, InventoryDocument[]>;
};

function resolveDocRef(from: InventoryDocument, target: string, maps: DocMaps): { status: "resolved"; doc: InventoryDocument } | { status: "unresolved" } {
  const trimmed = target.trim();
  if (trimmed === "" || trimmed.includes("::")) return { status: "unresolved" };
  if (trimmed.includes("/") || trimmed.endsWith(".md")) {
    const direct = maps.byPath.get(normalizeDir(trimmed));
    if (direct) return { status: "resolved", doc: direct };
    const rel = normalizeDir(path.posix.normalize(path.posix.join(path.posix.dirname(from.path), trimmed)));
    const relative = maps.byPath.get(rel);
    return relative ? { status: "resolved", doc: relative } : { status: "unresolved" };
  }
  const candidates = maps.byId.get(trimmed) ?? [];
  return candidates.length === 1 ? { status: "resolved", doc: candidates[0] } : { status: "unresolved" };
}

// Numeric-suffix preservation across a type-prefix conversion
// (`TSPEC-0001` → `VD-0001`); non-numeric ids get deterministic hash ids.
function convertedId(sourceId: string | null, source: string, targetPrefix: string): string {
  const numeric = /^[A-Z]+-(\d+)$/.exec(sourceId ?? "");
  if (numeric) return `${targetPrefix}-${numeric[1]}`;
  return `${targetPrefix}-${hashId(`id:${source}:${sourceId ?? ""}`)}`;
}

function statusValuesFor(doc: InventoryDocument): readonly string[] {
  if (doc.resolvedType === null) return [];
  return resolveDocType(doc.resolvedType).entry?.statusValues ?? [];
}

function buildMigrationPlan(cwd: string): MigrationPlanReport {
  const root = path.resolve(cwd);
  const preflight = evaluateSchemaPreflight(root);
  const { files, escapes } = collectFiles(root);

  const rawCache = new Map<string, RawDoc>();
  const rawOf = (rel: string): RawDoc => {
    const cached = rawCache.get(rel);
    if (cached) return cached;
    const raw = readRawDoc(root, rel);
    rawCache.set(rel, raw);
    return raw;
  };

  const documents = buildDocuments(files, rawOf);
  const indexes = buildIndexes(files);
  const experiments = buildExperiments(files);
  const { runs, foreign } = buildRuns(files);
  const foreignState = [...foreign, ...escapes]
    .sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.kind, b.kind));

  const inputFiles = sortStrings(files.map((file) => file.path));
  // A read failure degrades to a marker, never a crash — an unreadable input
  // leaves the inventory provably incomplete and surfaces as its own
  // decision below instead of losing the whole report to one bad file.
  const unreadableInputs = new Set<string>();
  const inputHash = inputFiles.length === 0
    ? sha256("[]")
    : sha256(inputFiles.map((rel) => {
        try {
          return `${rel}:${sha256(fs.readFileSync(path.join(root, rel), "utf8"))}`;
        } catch {
          unreadableInputs.add(rel);
          return `${rel}:unreadable`;
        }
      }).join("\n"));

  const byPath = new Map(documents.map((doc) => [doc.path, doc]));
  const byId = new Map<string, InventoryDocument[]>();
  for (const doc of documents) {
    if (doc.id === null) continue;
    byId.set(doc.id, [...(byId.get(doc.id) ?? []), doc]);
  }
  const maps: DocMaps = { byPath, byId };

  const decisions: SemanticDecision[] = [];
  const convertibles: Convertible[] = [];
  const collisions: PlanCollision[] = [];
  const plannedWrites: PlannedWrite[] = [];
  const removals: PlannedRemoval[] = [];
  const outOfScope: OutOfScopeItem[] = [];
  const residualRisks: ResidualRisk[] = [];
  const destinations: Destination[] = [];
  const legacyRelations: InventoryLegacyRelation[] = [];
  const bookkeeping = new Map<string, InventoryBookkeeping>();

  const decide = (decision: Omit<SemanticDecision, "decisionId">): void => {
    decisions.push({ ...decision, decisionId: "" });
  };
  const dest = (row: Destination): void => { destinations.push(row); };
  const existingPaths = new Set(inputFiles);
  // The path whose run claims a carrier's bookkeeping records — a locale
  // sibling's bookkeeping rides with its primary's run.
  const bookkeepingRunKey = new Map<string, string>();
  // Where each primary artifact lands — locale siblings resolve their
  // concrete destinations from the primary's outcome after the doc pass.
  const primaryOutcome = new Map<string, { fileTarget: string; newId: string | null }>();

  const fmOf = (doc: InventoryDocument): Record<string, unknown> => rawOf(doc.path).data;
  const bodyOf = (doc: InventoryDocument): string => rawOf(doc.path).body;

  // Caller bookkeeping — emitted for EVERY inventoried document, whatever
  // its own disposition: a populated `effectOutcomes`/`checkpointEvidence`
  // is live content that must reach a decision or a destination, never hide
  // behind an out-of-scope or needs-classification verdict. A present
  // non-list payload cannot be enumerated, so it is its own decision kind.
  const emitBookkeeping = (doc: InventoryDocument, fm: Record<string, unknown>): void => {
    if (doc.bookkeepingFields.length === 0) return;
    const carrier = doc.disposition === "convert:run-plan" ? "plan"
      : doc.disposition === "convert:run-task" ? "task" : "other";
    bookkeeping.set(doc.path, {
      path: doc.path,
      carrier,
      effectOutcomes: Array.isArray(fm.effectOutcomes) ? fm.effectOutcomes.length : 0,
      checkpointEvidence: Array.isArray(fm.checkpointEvidence) ? fm.checkpointEvidence.length : 0,
      malformed: doc.bookkeepingFields.filter((field) => !Array.isArray(fm[field])),
    });
    bookkeepingRunKey.set(doc.path, doc.localeSiblingOf ?? doc.path);
    for (const field of doc.bookkeepingFields) {
      const element = `frontmatter.${field}`;
      if (!Array.isArray(fm[field])) {
        decide({
          kind: "malformed-bookkeeping",
          path: doc.path,
          element,
          candidates: ["repair-then-replan", "preserve-as-diagnostic-trace", "drop-as-unmapped"],
          default: null,
          required: true,
          summary: `${field} is not a list — the caller-bookkeeping payload cannot be enumerated into records; repair it, divert it to diagnostics, or drop it explicitly`,
        });
        dest({ source: doc.path, element, action: "decision", target: "decision:malformed-bookkeeping" });
        continue;
      }
      if (carrier === "other") {
        decide({
          kind: "bookkeeping-assignment",
          path: doc.path,
          element,
          candidates: ["assign-to-run:<runId>", "diagnostic-trace"],
          default: "diagnostic-trace",
          required: true,
          summary: `${field} caller bookkeeping sits on a non-execution doc — the run it migrates into must be declared`,
        });
        dest({ source: doc.path, element, action: "decision", target: "decision:bookkeeping-assignment" });
      } else {
        dest({ source: doc.path, element, action: "map", target: field === "effectOutcomes" ? "run receipts / run_trace.jsonl" : "run checkpoints" });
      }
    }
  };

  // Populated legacy relations and bookkeeping on documents the main pass
  // will not interpret (locale siblings, out-of-scope, needs-classification)
  // still surface as semantic decisions with destinations — the document's
  // disposition covers the document, never the live content inside it.
  const emitScopedLegacyContent = (doc: InventoryDocument, fm: Record<string, unknown>, relations: { field: string; targets: string[] }[]): void => {
    for (const entry of relations) {
      if (nonReferenceRelationKeys.has(entry.field) || (PROVENANCE_RELATION_KEYS as readonly string[]).includes(entry.field)) continue;
      if (V1_RELATION_FIELDS.has(entry.field) || entry.targets.length === 0) continue;
      decide({
        kind: "legacy-relation",
        path: doc.path,
        element: `relations.${entry.field}`,
        field: entry.field,
        targets: [...entry.targets].sort(compareCodeUnits),
        candidates: ["declare-v1-mapping", "drop-as-unmapped", "preserve-as-body-note"],
        default: null,
        required: true,
        summary: `relations.${entry.field} is pre-v3 vocabulary with ${entry.targets.length} target(s) — semantics are decided, never mechanically rewritten`,
      });
      dest({ source: doc.path, element: `relations.${entry.field}`, action: "decision", target: "decision:legacy-relation" });
    }
    emitBookkeeping(doc, fm);
  };

  // --- classification --------------------------------------------------------
  // Computed before writes so the write plan can gate doc edits: a
  // manifest-only repo's bounded apply installs the manifest alone, while a
  // real migration also annotates mechanical field fixes.
  const legacyDomainCount =
    documents.filter((doc) =>
      (doc.disposition !== "preserve" && doc.disposition !== "out-of-scope")
      || doc.legacyRelationFields.length > 0
      || doc.malformedRelationFields.length > 0
      || doc.bookkeepingFields.length > 0).length
    + experiments.length
    + foreignState.length
    + indexes.filter((index) => index.dirKind === "migration-owned").length;
  const classification: PlanClassification =
    // Escaped paths mean the inventory is provably incomplete — the tree
    // cannot be verified, so it is blocked no matter what the preflight saw
    // (doc-tree escapes are silent to it by design).
    escapes.length > 0 ? "blocked"
      : preflight.status === "current" ? "current"
        : preflight.status === "migration-incomplete" ? "recovery"
          : preflight.status === "invalid" || preflight.status === "unsupported-version" ? "blocked"
            : inputFiles.length === 0 ? "bootstrap"
              : legacyDomainCount === 0 ? "manifest-only" : "migration";
  // Mechanical field fixes on preserve docs become planned writes only when
  // the full migration apply (#247) is the consumer; the bounded #233 apply
  // installs the manifest alone, so manifest-only plans stay advisory.
  const emitDocEdits = classification === "migration";

  // --- run grouping ------------------------------------------------------------
  const runIdFor = (seed: string): string => `RUN-${hashId(seed)}`;
  const planRuns = new Map<string, string>(); // plan doc path -> runId
  const runPlans = new Map<string, string>(); // runId -> plan doc path
  const runTasks = new Map<string, string[]>(); // runId -> task doc paths
  const taskDeps = new Map<string, { docPath: string; taskId: string }[]>(); // resolved dep docs
  const taskMembershipPending = new Map<string, string[]>(); // task path -> [planPath]

  const planDocs = documents.filter((doc) => doc.disposition === "convert:run-plan" && doc.localeSiblingOf === null);
  const taskDocs = documents.filter((doc) => doc.disposition === "convert:run-task" && doc.localeSiblingOf === null);

  for (const plan of planDocs) {
    const runId = runIdFor(`run:plan:${plan.path}`);
    planRuns.set(plan.path, runId);
    runPlans.set(runId, plan.path);
    runTasks.set(runId, []);
  }

  for (const task of taskDocs) {
    const { entries } = relationEntries(fmOf(task));
    const planVotes = new Set<string>();
    const deps: { docPath: string; taskId: string }[] = [];
    let membershipBlocked = false;
    for (const entry of entries) {
      if (entry.field !== "implements" && entry.field !== "depends-on" && entry.field !== "depends_on") continue;
      for (const target of entry.targets) {
        const resolved = resolveDocRef(task, target, maps);
        if (resolved.status === "resolved" && resolved.doc.disposition === "convert:run-plan") {
          planVotes.add(resolved.doc.path);
        } else if (entry.field === "implements") {
          decide({
            kind: "run-membership",
            path: task.path,
            element: `relations.${entry.field}`,
            field: entry.field,
            targets: [target],
            candidates: ["orphan-run"],
            default: "orphan-run",
            required: true,
            summary: `task implements target ${JSON.stringify(target)} does not resolve to a migrated plan — the run membership must be declared`,
          });
          membershipBlocked = true;
        } else if (resolved.status === "resolved" && resolved.doc.disposition === "convert:run-task") {
          deps.push({ docPath: resolved.doc.path, taskId: resolved.doc.id ?? `TASK-${hashId(`task:${resolved.doc.path}`)}` });
        } else {
          decide({
            kind: "depends-on-resolution",
            path: task.path,
            element: `relations.${entry.field}`,
            field: entry.field,
            targets: [target],
            candidates: ["declare-sibling-task-id", "drop-dependency"],
            default: null,
            required: true,
            summary: `depends-on target ${JSON.stringify(target)} does not resolve to a task in the migration corpus — same-run dependencies are the only legal form`,
          });
        }
      }
    }
    taskDeps.set(task.path, deps);
    if (planVotes.size === 1) {
      taskMembershipPending.set(task.path, [...planVotes]);
    } else if (planVotes.size > 1) {
      decide({
        kind: "run-membership",
        path: task.path,
        element: "relations.implements",
        targets: [...planVotes].sort(compareCodeUnits),
        candidates: [...planVotes].sort(compareCodeUnits).map((planPath) => `run:${planRuns.get(planPath)}`).concat(["orphan-run"]),
        default: null,
        required: true,
        summary: `task resolves to ${planVotes.size} different plans — one run membership must be chosen`,
      });
    } else if (!membershipBlocked) {
      taskMembershipPending.set(task.path, []);
    }
  }

  // Orphan tasks share one deterministic run.
  const orphanPaths = sortStrings([...taskMembershipPending.entries()].filter(([, votes]) => votes.length === 0).map(([taskPath]) => taskPath));
  const orphanRun = orphanPaths.length > 0 ? runIdFor(`run:orphan:${orphanPaths.join(",")}`) : null;
  if (orphanRun !== null) runTasks.set(orphanRun, []);
  const taskRun = new Map<string, string>(); // task path -> runId (decided members only)
  for (const [taskPath, votes] of taskMembershipPending) {
    const runId = votes.length === 1 ? planRuns.get(votes[0])! : orphanRun!;
    taskRun.set(taskPath, runId);
    runTasks.get(runId)?.push(taskPath);
  }

  // Same-run DAG check: a resolved dep that lands in a different run is
  // still illegal — cross-run edges are never fabricated.
  for (const [taskPath, deps] of taskDeps) {
    const ownRun = taskRun.get(taskPath);
    for (const dep of deps) {
      const depRun = taskRun.get(dep.docPath);
      if (ownRun !== undefined && depRun !== undefined && depRun !== ownRun) {
        decide({
          kind: "depends-on-resolution",
          path: taskPath,
          element: "relations.depends-on",
          field: "depends-on",
          targets: [dep.taskId],
          candidates: ["drop-dependency", "declare-single-run-merge"],
          default: null,
          required: true,
          summary: `depends-on target ${dep.taskId} belongs to run ${depRun} while this task lands in ${ownRun} — the DAG must stay inside one run`,
        });
      }
    }
  }

  // --- per-document interpretation ---------------------------------------------
  const idClaims = new Map<string, string[]>();
  const siblingDocs: InventoryDocument[] = [];
  for (const doc of documents) {
    const fm = fmOf(doc);
    const body = bodyOf(doc);
    const { entries: relations, malformedFields } = relationEntries(fm);

    // Legacy relation reporting (non-v1 fields on every doc kind) — recorded
    // before any disposition branch so nothing is invisible.
    for (const entry of relations) {
      if (nonReferenceRelationKeys.has(entry.field) || (PROVENANCE_RELATION_KEYS as readonly string[]).includes(entry.field)) continue;
      if (!V1_RELATION_FIELDS.has(entry.field)) {
        legacyRelations.push({ path: doc.path, field: entry.field, targets: [...entry.targets].sort(compareCodeUnits) });
      }
    }
    // Malformed relation payloads are semantic decisions on every doc kind —
    // never silently dropped as "empty" fields.
    for (const malformedField of malformedFields) {
      decide({
        kind: "malformed-relation-value",
        path: doc.path,
        element: `relations.${malformedField.field}`,
        field: malformedField.field,
        targets: [JSON.stringify(malformedField.raw)],
        candidates: ["repair-then-replan", "drop-as-unmapped"],
        default: null,
        required: true,
        summary: `relations.${malformedField.field} is not a string or list of strings (raw: ${JSON.stringify(malformedField.raw)}) — malformed payloads are decided, never silently dropped`,
      });
      dest({ source: doc.path, element: `relations.${malformedField.field}`, action: "decision", target: "decision:malformed-relation-value" });
    }

    // Locale siblings ride with their primary artifact — the sibling pass
    // below resolves concrete destinations once primaries are planned.
    if (doc.localeSiblingOf !== null) {
      emitScopedLegacyContent(doc, fm, relations);
      siblingDocs.push(doc);
      continue;
    }

    if (doc.disposition === "out-of-scope") {
      outOfScope.push({
        path: doc.path,
        kind: "unmanaged-doc",
        action: "unchanged",
        detail: "typeless or unmanaged Markdown outside the migration scope — the lint layer owns it",
      });
      dest({ source: doc.path, element: "file", action: "preserve", target: doc.path });
      primaryOutcome.set(doc.path, { fileTarget: doc.path, newId: doc.id });
      emitScopedLegacyContent(doc, fm, relations);
      continue;
    }

    if (doc.disposition === "decision") {
      const kind = unreadableInputs.has(doc.path)
        ? "unreadable-input"
        : doc.parseError !== null
          ? (fm.relations !== undefined && !isPlainObject(fm.relations) ? "malformed-frontmatter" : "unparseable-frontmatter")
          : doc.kind === "unknown-type"
            ? "unknown-type"
            : doc.kind === "untyped"
              ? "untyped-legacy-doc"
              : "doc-placement";
      const candidates: Record<string, string[]> = {
        "unreadable-input": ["restore-readability-then-replan", "discard"],
        "unparseable-frontmatter": ["repair-front-matter-then-replan", "discard"],
        "malformed-frontmatter": ["repair-relations-then-replan", "discard"],
        "unknown-type": ["declare-target-type", "preserve-as-unmanaged", "discard"],
        "untyped-legacy-doc": ["plan", "task", "test-spec", "knowledge", "diagnostic-trace", "leave-unmanaged"],
        "doc-placement": ["move-to-canonical-dir", "keep-and-accept-finding"],
      };
      decide({
        kind,
        path: doc.path,
        element: "document",
        candidates: candidates[kind] ?? ["review"],
        default: null,
        required: true,
        summary: kind === "unreadable-input"
          ? `file cannot be read (${doc.parseError}) — the artifact is unclassifiable until readable`
          : doc.parseError !== null
            ? `front matter cannot be parsed (${doc.parseError}) — the artifact is unclassifiable until repaired`
            : kind === "unknown-type"
              ? `type ${JSON.stringify(doc.type)} is not a Registry-3 type — migration needs a declared classification`
              : kind === "untyped-legacy-doc"
                ? `typeless Markdown inside a migration-owned dir — declare its artifact class`
                : `${doc.type} document sits inside migration-owned ${normalizeDir(path.posix.dirname(doc.path))} — choose the canonical home`,
      });
      dest({ source: doc.path, element: "file", action: "decision", target: `decision:${kind}` });
      primaryOutcome.set(doc.path, { fileTarget: `decision:${kind}`, newId: null });
      removals.push({ path: doc.path, when: "decision", note: "source disposition pending the classification decision" });
      emitScopedLegacyContent(doc, fm, relations);
      continue;
    }

    const isRunBound = doc.disposition === "convert:run-plan" || doc.disposition === "convert:run-task";
    const convertsToDurable = doc.disposition === "convert:verification" || doc.disposition === "classify";
    const runDirFor = (): string => {
      const runId = doc.disposition === "convert:run-plan"
        ? planRuns.get(doc.path)
        : taskRun.get(doc.path);
      return runId === undefined ? "decision:run-membership" : `${EXECUTION_STATE_ROOT}/runs/${runId}`;
    };

    const fmRow = (field: string, action: Destination["action"], target: string, note?: string): void => {
      dest({ source: doc.path, element: `frontmatter.${field}`, action, target, note });
    };

    let targetPath = doc.path;
    let newId = doc.id;
    if (convertsToDurable) {
      const stem = path.posix.basename(doc.path).replace(/\.md$/i, "");
      const targetDir = doc.disposition === "convert:verification" ? "docs/verification" : "docs/knowledge";
      const targetPrefix = doc.disposition === "convert:verification" ? "VD" : "KNOW";
      targetPath = `${targetDir}/${stem}.md`;
      newId = convertedId(doc.id, doc.path, targetPrefix);
      if (existingPaths.has(targetPath) && targetPath !== doc.path) {
        const alternates = [`${targetDir}/${stem}-migrated.md`, `${targetDir}/${stem}-migrated-2.md`, `${targetDir}/${stem}-migrated-3.md`];
        const suggested = alternates.find((rel) => !existingPaths.has(rel)) ?? null;
        collisions.push({ target: targetPath, kind: "target-exists", sources: [doc.path], suggestedTarget: suggested });
        decide({
          kind: "target-collision",
          path: doc.path,
          element: "file",
          candidates: suggested === null ? ["rename-manually", "skip-source"] : [`write:${suggested}`, "skip-source"],
          default: suggested === null ? null : `write:${suggested}`,
          required: true,
          summary: `conversion target ${targetPath} already exists — it is never overwritten`,
        });
      }
      const idOwners = (byId.get(newId!) ?? []).filter((owner) => owner.path !== doc.path);
      if (idOwners.length > 0) {
        const suggested = `${targetPrefix}-${hashId(`collision:${doc.path}:${newId}`)}`;
        collisions.push({ target: newId!, kind: "id-exists", sources: [doc.path, ...idOwners.map((owner) => owner.path)].sort(compareCodeUnits), suggestedTarget: suggested });
        decide({
          kind: "id-collision",
          path: doc.path,
          element: "id",
          targets: [newId!],
          candidates: [`assign:${suggested}`, "skip-source"],
          default: `assign:${suggested}`,
          required: true,
          summary: `converted id ${newId} already belongs to ${idOwners.map((owner) => owner.path).join(", ")}`,
        });
      }
      idClaims.set(newId!, [...(idClaims.get(newId!) ?? []), doc.path]);
      plannedWrites.push({
        target: targetPath,
        kind: "durable-document",
        source: doc.path,
        destination: doc.disposition === "convert:verification"
          ? `Verification Design at ${targetPath} — test-spec intent preserved as design prose; checks bind explicitly`
          : `knowledge record at ${targetPath} — impl body preserved verbatim pending the classification decision`,
      });
      removals.push({ path: doc.path, when: "at-finalize", note: "converted source removed only after post-migration integrity checks" });
    }

    // Execution-bound sources leave Git at finalize — a plan/task file left
    // behind would stay a `legacy-execution-doc` marker and hold the
    // preflight at `migration-required` forever.
    if (isRunBound) {
      removals.push({ path: doc.path, when: "at-finalize", note: "execution-bound source leaves Git at finalize — the migrated run snapshot replaces it" });
    }

    // --- destination rows shared by every interpretation ---
    const runTarget = isRunBound ? runDirFor() : null;
    dest({ source: doc.path, element: "file", action: convertsToDurable || isRunBound ? "convert" : "preserve", target: convertsToDurable ? targetPath : runTarget ?? doc.path });
    dest({ source: doc.path, element: "filename", action: convertsToDurable ? "convert" : "preserve", target: convertsToDurable ? path.posix.basename(targetPath) : path.posix.basename(doc.path) });
    dest({ source: doc.path, element: "id", action: convertsToDurable ? "map" : "preserve", target: convertsToDurable ? newId! : (doc.id ?? "decision:id-assignment") });

    if (doc.id === null) {
      const prefix = doc.disposition === "convert:verification" ? "VD"
        : doc.disposition === "classify" ? "KNOW"
          : doc.disposition === "convert:run-plan" ? "PLAN"
            : doc.disposition === "convert:run-task" ? "TASK"
              : doc.resolvedType !== null ? (resolveDocType(doc.resolvedType).entry?.idPrefix ?? "DOC") : "DOC";
      const proposed = `${prefix}-${hashId(`id:${doc.path}`)}`;
      decide({
        kind: "id-assignment",
        path: doc.path,
        element: "id",
        candidates: [`assign:${proposed}`],
        default: `assign:${proposed}`,
        required: true,
        summary: `no id declared — the canonical id ${proposed} is proposed deterministically and needs confirmation`,
      });
    }

    fmRow("type", convertsToDurable ? "map" : "preserve", convertsToDurable ? (doc.disposition === "convert:verification" ? "verification" : "knowledge") : (doc.type ?? "—"));

    // status destination.
    const status = doc.status;
    if (doc.disposition === "convert:run-task") {
      const vocab = ephemeralConfigs.task.statusValues as readonly string[];
      if (status !== null && vocab.includes(status)) {
        fmRow("status", "map", `taskRecord.status=${status}`);
      } else {
        decide({
          kind: "status-mapping",
          path: doc.path,
          element: "frontmatter.status",
          targets: status === null ? [] : [status],
          candidates: [...vocab],
          default: null,
          required: true,
          summary: status === null
            ? "task status is absent — a TaskRecord status must be declared, never assumed"
            : `task status ${JSON.stringify(status)} is outside the TaskRecord vocabulary — an explicit mapping is required`,
        });
        fmRow("status", "decision", "decision:status-mapping");
      }
    } else if (convertsToDurable) {
      const vocab = doc.disposition === "convert:verification"
        ? (configs.verification.statusValues as readonly string[])
        : (configs.knowledge.statusValues as readonly string[]);
      if (status !== null && vocab.includes(status)) {
        fmRow("status", "map", status);
      } else {
        decide({
          kind: "status-mapping",
          path: doc.path,
          element: "frontmatter.status",
          targets: status === null ? [] : [status],
          candidates: [...vocab],
          default: null,
          required: true,
          summary: status === null
            ? "status is absent — a value must be declared, never assumed"
            : `status ${JSON.stringify(status)} has no declared mapping into ${doc.disposition === "convert:verification" ? "verification" : "knowledge"} — choose one`,
        });
        fmRow("status", "decision", "decision:status-mapping");
      }
    } else {
      const vocab = statusValuesFor(doc);
      if (status === null) {
        decide({
          kind: "status-mapping",
          path: doc.path,
          element: "frontmatter.status",
          candidates: vocab.length > 0 ? [...vocab] : ["<resolved-after-type-decision>"],
          default: null,
          required: vocab.length > 0,
          summary: "status is absent — a value must be declared, never assumed",
        });
        fmRow("status", "decision", "decision:status-mapping");
      } else if (vocab.length > 0 && !vocab.includes(status)) {
        decide({
          kind: "status-mapping",
          path: doc.path,
          element: "frontmatter.status",
          targets: [status],
          candidates: [...vocab],
          default: null,
          required: true,
          summary: `status ${JSON.stringify(status)} is outside the ${doc.resolvedType} vocabulary`,
        });
        fmRow("status", "decision", "decision:status-mapping");
      } else {
        fmRow("status", "preserve", status ?? "—");
      }
    }

    // lifecycle destination (durable-bound docs only; run-bound have none).
    if (!isRunBound) {
      if (doc.lifecycle !== null && (LIFECYCLE_VALUES as readonly string[]).includes(doc.lifecycle)) {
        fmRow("lifecycle", "preserve", doc.lifecycle);
      } else {
        const proposed = status !== null ? LIFECYCLE_DEFAULTS[status] ?? null : null;
        decide({
          kind: "lifecycle-assignment",
          path: doc.path,
          element: "frontmatter.lifecycle",
          targets: doc.lifecycle === null ? [] : [doc.lifecycle],
          candidates: proposed === "retired" || proposed === "superseded" ? [...LIFECYCLE_VALUES] : ["draft", "current"],
          default: proposed,
          required: true,
          summary: doc.lifecycle === null
            ? `no lifecycle declared (pre-Registry-3 doc); status ${JSON.stringify(status)} proposes ${JSON.stringify(proposed)} — explicit confirmation required`
            : `lifecycle ${JSON.stringify(doc.lifecycle)} is not a declared value — choose one`,
        });
        fmRow("lifecycle", "decision", "decision:lifecycle-assignment");
      }
    }

    // Remaining base fields.
    const h1 = firstH1(body);
    if (doc.title !== null || h1 !== null) {
      fmRow("title", "preserve", doc.title ?? h1!);
    } else {
      decide({
        kind: "missing-field",
        path: doc.path,
        element: "frontmatter.title",
        candidates: ["declare-title"],
        default: null,
        required: true,
        summary: "no title in front matter or H1 — a title must be declared",
      });
      fmRow("title", "decision", "decision:missing-field");
    }
    for (const field of ["created", "updated"] as const) {
      const value = stringField(fm, field);
      if (value !== null) {
        fmRow(field, "preserve", value);
      } else {
        decide({
          kind: "missing-field",
          path: doc.path,
          element: `frontmatter.${field}`,
          candidates: ["declare-date"],
          default: null,
          required: true,
          summary: `${field} is absent — provenance dates are never fabricated; an explicit date must be declared`,
        });
        fmRow(field, "decision", "decision:missing-field");
      }
    }
    if (fm.owners === undefined) {
      convertibles.push({ kind: "add-missing-field", path: doc.path, element: "frontmatter.owners", action: "annotate", detail: "owners: [] default at rewrite" });
      if (emitDocEdits && doc.disposition === "preserve") {
        plannedWrites.push({ target: doc.path, kind: "document-edit", source: doc.path, destination: "annotate owners: []" });
      }
      fmRow("owners", "map", "[] (default)");
    } else {
      fmRow("owners", "preserve", "unchanged");
    }
    if (fm.relations === undefined) {
      convertibles.push({ kind: "add-missing-field", path: doc.path, element: "frontmatter.relations", action: "annotate", detail: "relations: {} default at rewrite" });
      if (emitDocEdits && doc.disposition === "preserve") {
        plannedWrites.push({ target: doc.path, kind: "document-edit", source: doc.path, destination: "annotate relations: {}" });
      }
      fmRow("relations", "map", "{} (default)");
    } else {
      fmRow("relations", "preserve", "unchanged — per-field destinations follow");
    }
    if (fm.metadata !== undefined) {
      fmRow("metadata", "preserve", doc.resolvedType === "impl" ? "experiment provenance — adopted/rejected pointers carried into conversion provenance" : "unchanged");
    }

    // Per-relation-field destinations and conversion handling.
    for (const entry of relations) {
      const element = `relations.${entry.field}`;
      if (nonReferenceRelationKeys.has(entry.field)) {
        fmRow(element, "preserve", "metadata field — unchanged");
        continue;
      }
      if ((PROVENANCE_RELATION_KEYS as readonly string[]).includes(entry.field)) {
        fmRow(element, "preserve", "provenance contract — unchanged");
        continue;
      }
      if (entry.targets.length === 0) {
        convertibles.push({ kind: "drop-empty-relation", path: doc.path, element, action: "drop", detail: `relations.${entry.field} is empty legacy vocabulary — dropped at rewrite` });
        fmRow(element, "drop", "empty legacy field — removed");
        continue;
      }
      if (doc.disposition === "convert:run-task" && (entry.field === "implements" || entry.field === "depends-on" || entry.field === "depends_on")) {
        fmRow(element, "map", "taskRecord.dependsOn / run membership");
        continue;
      }
      if (isRunBound && entry.field === "verified-by") {
        decide({
          kind: "check-binding",
          path: doc.path,
          element,
          field: entry.field,
          targets: [...entry.targets],
          candidates: ["declare VD-<id>::CHK-NN references"],
          default: null,
          required: true,
          summary: `verified-by points at legacy verification intent — taskRecord.checks accepts only qualified Verification Design check references`,
        });
        fmRow(element, "decision", "decision:check-binding");
        continue;
      }
      if (doc.disposition === "convert:verification" && entry.field === "verifies") {
        fmRow(element, "decision", "decision:check-binding");
        continue; // binding decisions are emitted in the test-spec section below
      }
      if (V1_RELATION_FIELDS.has(entry.field) && doc.disposition === "preserve") {
        const broken = entry.targets.filter((target) => {
          if (target.includes("::")) return false; // claim refs resolve through the claim index
          return resolveDocRef(doc, target, maps).status === "unresolved";
        });
        const converts = entry.targets.filter((target) => {
          const resolved = resolveDocRef(doc, target, maps);
          return resolved.status === "resolved" && (resolved.doc.disposition.startsWith("convert") || resolved.doc.disposition === "classify");
        });
        if (broken.length > 0) {
          decide({
            kind: "unresolved-relation-target",
            path: doc.path,
            element,
            field: entry.field,
            targets: broken,
            candidates: ["retarget", "drop"],
            default: null,
            required: true,
            summary: `relations.${entry.field} targets do not resolve — never silently dropped`,
          });
          fmRow(element, "decision", "decision:unresolved-relation-target");
        } else if (converts.length > 0) {
          decide({
            kind: "legacy-relation-target",
            path: doc.path,
            element,
            field: entry.field,
            targets: converts,
            candidates: ["retarget-to-converted-doc", "drop"],
            default: null,
            required: true,
            summary: `relations.${entry.field} targets convert out of durable form — a live target must be chosen`,
          });
          fmRow(element, "decision", "decision:legacy-relation-target");
        } else {
          convertibles.push({ kind: "preserve-relation", path: doc.path, element, field: entry.field, action: "preserve", detail: `relations.${entry.field} is canonical Knowledge Relations v1 — kept verbatim` });
          fmRow(element, "preserve", "unchanged");
        }
        continue;
      }
      // Populated legacy vocabulary — semantic judgment only.
      decide({
        kind: "legacy-relation",
        path: doc.path,
        element,
        field: entry.field,
        targets: [...entry.targets].sort(compareCodeUnits),
        candidates: ["declare-v1-mapping", "drop-as-unmapped", "preserve-as-body-note"],
        default: null,
        required: true,
        summary: `relations.${entry.field} is pre-v3 vocabulary with ${entry.targets.length} target(s) — semantics are decided, never mechanically rewritten`,
      });
      fmRow(element, "decision", "decision:legacy-relation");
    }

    // Unmapped extra fields.
    for (const field of Object.keys(fm).sort(compareCodeUnits)) {
      if (KNOWN_FM_FIELDS.has(field)) continue;
      dest({ source: doc.path, element: `frontmatter.${field}`, action: "unmapped", target: "conversion provenance", note: "no declared v3 destination — carried verbatim into migration provenance, never interpreted" });
      residualRisks.push({ kind: "unmapped-field", path: doc.path, detail: `front matter field ${JSON.stringify(field)} has no v3 destination — preserved in conversion provenance only` });
    }

    // Body destination.
    dest({
      source: doc.path,
      element: "body",
      action: convertsToDurable || isRunBound ? "convert" : "preserve",
      target: convertsToDurable
        ? `preserved verbatim into ${targetPath}`
        : doc.disposition === "convert:run-plan"
          ? "run plan.md — verbatim plan content"
          : doc.disposition === "convert:run-task"
            ? "taskRecord title/notes — verbatim content into the task record payload"
            : doc.path,
    });

    // Caller bookkeeping fields — aggregated once per carrier doc; the
    // shared emitter covers every disposition so populated bookkeeping is
    // never invisible.
    emitBookkeeping(doc, fm);

    primaryOutcome.set(doc.path, {
      fileTarget: convertsToDurable ? targetPath : isRunBound ? runTarget! : doc.path,
      newId: convertsToDurable ? newId : doc.id,
    });
  }

  // --- locale siblings ride with their primary --------------------------------------
  // Primaries plan first; each sibling then lands on a concrete destination —
  // never a vague "migrates with". A converting primary's sibling gets its own
  // concrete target path and removal; a run-bound primary's sibling leaves Git
  // with it at finalize.
  for (const sib of siblingDocs) {
    const primary = byPath.get(sib.localeSiblingOf!);
    const outcome = primaryOutcome.get(sib.localeSiblingOf!);
    const localeExt = (() => {
      const match = /\.([a-z]{2})\.md$/i.exec(path.posix.basename(sib.path));
      return match ? match[1].toLowerCase() : "locale";
    })();
    const { entries: sibRelations } = relationEntries(fmOf(sib));
    if (primary !== undefined && outcome !== undefined
      && (primary.disposition === "convert:verification" || primary.disposition === "classify")) {
      const siblingTarget = outcome.fileTarget.replace(/\.md$/i, `.${localeExt}.md`);
      if (existingPaths.has(siblingTarget)) {
        collisions.push({ target: siblingTarget, kind: "target-exists", sources: [sib.path], suggestedTarget: null });
        decide({
          kind: "target-collision",
          path: sib.path,
          element: "file",
          candidates: ["rename-manually", "skip-source"],
          default: null,
          required: true,
          summary: `locale-sibling target ${siblingTarget} already exists — it is never overwritten`,
        });
      }
      plannedWrites.push({
        target: siblingTarget,
        kind: "durable-document",
        source: sib.path,
        destination: `locale sibling of ${primary.path} — localized artifact file preserved verbatim`,
      });
      removals.push({ path: sib.path, when: "at-finalize", note: `converted with primary ${primary.path} — removed after post-migration integrity checks` });
      dest({ source: sib.path, element: "file", action: "convert", target: siblingTarget, note: `locale sibling of ${primary.path}` });
      dest({ source: sib.path, element: "filename", action: "convert", target: path.posix.basename(siblingTarget) });
      dest({ source: sib.path, element: "id", action: "map", target: `${outcome.newId ?? "decision:id-assignment"} — one artifact, localized files` });
      dest({ source: sib.path, element: "body", action: "convert", target: `preserved verbatim into ${siblingTarget}` });
      // Empty legacy fields on a converting sibling are mechanical drops at rewrite.
      for (const entry of sibRelations) {
        if (nonReferenceRelationKeys.has(entry.field) || (PROVENANCE_RELATION_KEYS as readonly string[]).includes(entry.field)) continue;
        if (V1_RELATION_FIELDS.has(entry.field) || entry.targets.length > 0) continue;
        convertibles.push({ kind: "drop-empty-relation", path: sib.path, element: `relations.${entry.field}`, action: "drop", detail: `relations.${entry.field} is empty legacy vocabulary — dropped at rewrite` });
      }
    } else if (primary !== undefined && outcome !== undefined
      && (primary.disposition === "convert:run-plan" || primary.disposition === "convert:run-task")) {
      dest({ source: sib.path, element: "file", action: "convert", target: `${outcome.fileTarget} — locale variant rides with ${primary.path}`, note: "locale sibling of the primary artifact" });
      dest({ source: sib.path, element: "id", action: "preserve", target: `no separate record — rides with ${primary.path}` });
      dest({ source: sib.path, element: "body", action: "convert", target: `carries with ${primary.path} into the run snapshot` });
      removals.push({ path: sib.path, when: "at-finalize", note: `execution-bound locale sibling leaves Git with ${primary.path}` });
    } else if (primary !== undefined && primary.disposition === "decision") {
      dest({ source: sib.path, element: "file", action: "decision", target: outcome?.fileTarget ?? "decision:doc-placement", note: `rides with primary ${primary.path}` });
      removals.push({ path: sib.path, when: "decision", note: `rides with primary ${primary.path} — pending the classification decision` });
    } else if (primary !== undefined && primary.disposition === "out-of-scope") {
      outOfScope.push({ path: sib.path, kind: "unmanaged-doc", action: "unchanged", detail: `locale sibling of ${primary.path} — outside the migration scope` });
      dest({ source: sib.path, element: "file", action: "preserve", target: sib.path, note: `locale sibling of ${primary.path}` });
    } else {
      dest({ source: sib.path, element: "file", action: "preserve", target: sib.path, note: primary !== undefined ? `locale sibling of ${primary.path} — stays with its primary` : "locale sibling" });
    }
  }

  // --- unmanaged / already-current files ----------------------------------------
  for (const file of files) {
    if (file.cls === "unmanaged") {
      outOfScope.push({ path: file.path, kind: "unmanaged-file", action: "unchanged", detail: "outside every managed scope — not migration content" });
    } else if (file.cls === "evidence-file") {
      outOfScope.push({ path: file.path, kind: "evidence-store", action: "unchanged", detail: "declared Evidence Store layout — already current state" });
    }
  }

  // --- run snapshot writes --------------------------------------------------------
  const migratedRunIds = new Set([...planRuns.values(), ...(orphanRun !== null ? [orphanRun] : [])]);
  const diagnosticsRun = experiments.length > 0
    ? runIdFor(`run:diagnostics:${experiments.map((exp) => exp.path).join(",")}`)
    : null;
  if (diagnosticsRun !== null) migratedRunIds.add(diagnosticsRun);

  for (const runId of [...migratedRunIds].sort(compareCodeUnits)) {
    const runDir = `${EXECUTION_STATE_ROOT}/runs/${runId}`;
    const planPath = runPlans.get(runId) ?? null;
    plannedWrites.push({
      target: `${runDir}/manifest.json`,
      kind: "run-manifest",
      source: planPath ?? "synthesized",
      destination: `run manifest for ${runId} — status/approval decided below; never fabricated`,
    });
    if (planPath !== null) {
      plannedWrites.push({ target: `${runDir}/plan.md`, kind: "run-plan", source: planPath, destination: `run plan.md — verbatim body of ${planPath}` });
      const planDoc = byPath.get(planPath)!;
      const status = planDoc.status;
      if (status !== null && RUN_STATUS_DEFAULTS[status] !== undefined) {
        convertibles.push({ kind: "run-status", path: planPath, element: "frontmatter.status", action: "map", detail: `plan status ${status} → run status ${RUN_STATUS_DEFAULTS[status]}` });
      } else {
        decide({
          kind: "run-status",
          path: planPath,
          element: "frontmatter.status",
          targets: status === null ? [] : [status],
          candidates: status === "superseded" ? ["completed", "aborted"] : ["active", "completed", "aborted"],
          default: null,
          required: true,
          summary: `plan status ${JSON.stringify(status)} has no declared run-state mapping — whether the work finished or was cut is a human call`,
        });
      }
      if (status === "approved" || status === "in-progress" || status === "completed") {
        decide({
          kind: "run-approval",
          path: planPath,
          element: "frontmatter.status",
          candidates: ["re-approve via approve-plan after import", "proceed unapproved"],
          default: "re-approve via approve-plan after import",
          required: true,
          summary: "the plan carried approved/in-progress state — a v3 approval binds an actor and timestamp that must be re-declared, never reconstructed",
        });
        residualRisks.push({ kind: "approval-redeclare", path: planPath, detail: "migrated runs start unapproved; a stale v2 approval can never be replayed" });
      }
    } else {
      // Orphan/diagnostics run has no plan status to derive from.
      decide({
        kind: "run-status",
        path: runDir,
        element: "run",
        candidates: ["active", "completed", "aborted"],
        default: runId === diagnosticsRun ? "active" : null,
        required: runId !== diagnosticsRun,
        summary: diagnosticsRun === runId
          ? "diagnostics container run — created to hold migrated diagnostic trace content"
          : "orphan-task run has no source plan — its status is an explicit decision",
      });
    }
    for (const taskPath of (runTasks.get(runId) ?? []).sort(compareCodeUnits)) {
      const task = byPath.get(taskPath)!;
      const taskId = task.id ?? `TASK-${hashId(`task:${taskPath}`)}`;
      plannedWrites.push({
        target: `${runDir}/tasks/${taskId}.json`,
        kind: "task-record",
        source: taskPath,
        destination: `TaskRecord { taskId: ${taskId}, status, dependsOn, checks: [], scope: [] }`,
      });
      const deps = (taskDeps.get(taskPath) ?? []).map((dep) => dep.taskId);
      if (deps.length > 0) {
        convertibles.push({ kind: "task-depends-on", path: taskPath, element: "relations.depends-on", action: "map", targets: sortStrings(new Set(deps)), detail: `dependsOn resolved to same-run task ids: ${deps.join(", ")}` });
      }
      residualRisks.push({ kind: "scope-undeclared", path: taskPath, detail: "v2 tasks carried no write scope — the migrated TaskRecord starts scope-undeclared" });
    }
    if (diagnosticsRun === runId) {
      plannedWrites.push({
        target: `${runDir}/run_trace.jsonl`,
        kind: "run-trace",
        source: "diagnostic-sink",
        destination: "diagnostic trace — non-authoritative preservation sink for migrated diagnostic content",
      });
      residualRisks.push({ kind: "diagnostic-only", path: null, detail: `run ${runId} is a diagnostics container — its run_trace.jsonl asserts nothing` });
    }
  }

  // Caller bookkeeping → records/trace inside the carrier's run. A locale
  // sibling's records land in its primary's run.
  for (const entry of bookkeeping.values()) {
    if (entry.carrier === "other") continue; // decision already emitted
    const fm = fmOf(byPath.get(entry.path)!);
    const runKey = bookkeepingRunKey.get(entry.path) ?? entry.path;
    const runId = entry.carrier === "plan" ? planRuns.get(runKey) : taskRun.get(runKey);
    if (runId === undefined) {
      residualRisks.push({ kind: "bookkeeping-pending", path: entry.path, detail: "caller bookkeeping waits on the run-membership decision before records can be planned" });
      continue;
    }
    const runDir = `${EXECUTION_STATE_ROOT}/runs/${runId}`;
    const outcomes = Array.isArray(fm.effectOutcomes) ? fm.effectOutcomes : [];
    let traceNeeded = false;
    outcomes.forEach((outcome, index) => {
      if (isPlainObject(outcome) && outcome.status === "completed") {
        plannedWrites.push({
          target: `${runDir}/receipts/RCP-${hashId(`${entry.path}:effectOutcomes:${index}`)}.json`,
          kind: "receipt-record",
          source: entry.path,
          destination: `Effect Receipt — completed v2 effectOutcome ${index} carried verbatim with migrated provenance`,
        });
      } else {
        traceNeeded = true;
      }
    });
    const evidence = Array.isArray(fm.checkpointEvidence) ? fm.checkpointEvidence : [];
    evidence.forEach((_, index) => {
      plannedWrites.push({
        target: `${runDir}/checkpoints/CHKPT-${hashId(`${entry.path}:checkpointEvidence:${index}`)}.json`,
        kind: "checkpoint-record",
        source: entry.path,
        destination: `Checkpoint record — v2 checkpointEvidence ${index} carried verbatim with migrated provenance`,
      });
    });
    if (traceNeeded) {
      plannedWrites.push({
        target: `${runDir}/run_trace.jsonl`,
        kind: "run-trace",
        source: entry.path,
        destination: "diagnostic trace — non-completed effectOutcomes (yield/retry) are diagnostics, never receipts",
      });
    }
    residualRisks.push({ kind: "receipt-provenance", path: entry.path, detail: "migrated receipts/checkpoints assert only what the v2 record asserted — they are execution receipts, never verification Evidence" });
  }

  // --- test-spec check bindings -------------------------------------------------
  for (const doc of documents.filter((entry) => entry.disposition === "convert:verification" && entry.localeSiblingOf === null)) {
    const { entries } = relationEntries(fmOf(doc));
    for (const entry of entries) {
      if (entry.field !== "verifies") continue;
      for (const target of entry.targets) {
        decide({
          kind: "check-binding",
          path: doc.path,
          element: "relations.verifies",
          field: "verifies",
          targets: [target],
          candidates: ["declare <document-id>::<claim-key> target + method + passCriteria"],
          default: null,
          required: true,
          summary: `verifies target ${JSON.stringify(target)} is doc-level — Verification Design checks bind qualified claim references explicitly`,
        });
      }
    }
    const body = bodyOf(doc);
    for (const section of ["Guarantees", "Rules", "Examples", "Non-goals"]) {
      if (new RegExp(`^#{1,6}\\s+${section}\\b`, "m").test(body)) {
        decide({
          kind: "check-binding",
          path: doc.path,
          element: `body.${section.toLowerCase()}`,
          candidates: ["bind each item to a VerificationCheckV1 { id, target, method, passCriteria }"],
          default: null,
          required: true,
          summary: `test-spec ${section} section is preserved as design prose — each item needs an explicit check binding`,
        });
      }
    }
  }

  // --- impl classification -------------------------------------------------------
  for (const doc of documents.filter((entry) => entry.disposition === "classify" && entry.localeSiblingOf === null)) {
    const body = bodyOf(doc);
    decide({
      kind: doc.type === "exp" ? "exp-classification" : "ir-classification",
      path: doc.path,
      element: "document",
      candidates: ["knowledge", "adr", "spec", "design", "evidence-candidate", "diagnostic-trace"],
      default: "knowledge",
      required: true,
      summary: "impl/exp artifacts have no single v3 home — the classification is an explicit decision; the body is preserved verbatim by default",
    });
    if (/^#{1,6}\s+(Validation|Verification)\b/m.test(body)) {
      decide({
        kind: "evidence-admission",
        path: doc.path,
        element: "body.validation",
        candidates: ["admit-as-evidence-candidate", "keep-as-prose", "discard"],
        default: "keep-as-prose",
        required: true,
        summary: "validation prose claims outcomes — it is an evidence candidate requiring explicit admission, never automatically verified Evidence",
      });
    }
  }

  // --- experiment logs -----------------------------------------------------------
  for (const exp of experiments) {
    if (exp.hasValidationEvents || exp.malformedLines > 0) {
      decide({
        kind: "exp-classification",
        path: exp.path,
        element: "file",
        candidates: ["diagnostic-trace", "knowledge", "evidence-candidate", "discard"],
        default: "diagnostic-trace",
        required: true,
        summary: exp.hasValidationEvents
          ? "experiment log carries validation-type events — outcome claims need explicit classification, never fabricated Evidence"
          : `experiment log has ${exp.malformedLines} malformed event line(s) — classification needs review`,
      });
    } else {
      convertibles.push({
        kind: "exp-diagnostic-trace",
        path: exp.path,
        element: "events",
        action: "convert",
        detail: `experiment log (${exp.events} events) → diagnostic trace — preserved verbatim, asserts nothing`,
      });
    }
    if (diagnosticsRun !== null) {
      dest({ source: exp.path, element: "file", action: "diagnostic", target: `${EXECUTION_STATE_ROOT}/runs/${diagnosticsRun}/run_trace.jsonl`, note: "diagnostic-trace is the default sink; a classification decision may redirect" });
      dest({ source: exp.path, element: "events", action: "diagnostic", target: "run_trace.jsonl lines — verbatim payloads", note: `${exp.events} event(s), ${exp.malformedLines} malformed` });
    }
    removals.push({ path: exp.path, when: "at-finalize", note: "experiment JSONL has no durable v3 form — removed after content is accounted for" });
  }

  // --- indexes ---------------------------------------------------------------------
  for (const index of indexes) {
    if (index.disposition === "regenerate") {
      // A generated index in a durable dir is ordinary maintenance: the
      // full migration regenerates it post-apply, but on any other plan the
      // bounded apply never rewrites it — `index apply` owns that write.
      if (emitDocEdits) {
        convertibles.push({ kind: "index-regen", path: index.path, element: "file", action: "regenerate", detail: "managed index is a derived view — regenerated post-migration" });
        plannedWrites.push({ target: index.path, kind: "index-regen", source: "derived", destination: "managed index regenerated in place post-migration" });
        dest({ source: index.path, element: "file", action: "convert", target: `${index.path} (regenerated)` });
      } else {
        dest({ source: index.path, element: "file", action: "preserve", target: `${index.path} — managed derived view; regenerated via doc_maintenance index apply when stale` });
      }
    } else if (index.disposition === "remove") {
      convertibles.push({ kind: "index-remove", path: index.path, element: "file", action: "drop", detail: "generated index of a migration-owned dir — a derived view removed with its corpus" });
      removals.push({ path: index.path, when: "at-finalize", note: "generated index removed with the migrated corpus" });
      dest({ source: index.path, element: "file", action: "drop", target: "removed at finalize" });
    } else {
      decide({
        kind: "hand-curated-index",
        path: index.path,
        element: "file",
        candidates: index.dirKind === "migration-owned" ? ["extract-to-knowledge", "discard"] : ["adopt-managed", "keep-unmanaged"],
        default: null,
        required: true,
        summary: `hand-curated index in ${index.dir} carries human-authored content — never overwritten or silently dropped`,
      });
      dest({ source: index.path, element: "file", action: "decision", target: "decision:hand-curated-index" });
    }
  }

  // --- body link destinations -------------------------------------------------------
  const renameMap = new Map<string, string>();
  for (const write of plannedWrites.filter((entry) => entry.kind === "durable-document")) {
    renameMap.set(write.source, write.target);
  }
  const removedSources = new Set(removals.map((entry) => entry.path));
  for (const doc of documents) {
    if (doc.localeSiblingOf !== null) continue;
    for (const link of bodyLinks(bodyOf(doc))) {
      const resolved = resolveDocRef(doc, link, maps);
      const targetPath = resolved.status === "resolved" ? resolved.doc.path : normalizeDir(path.posix.normalize(path.posix.join(path.posix.dirname(doc.path), link)));
      if (renameMap.has(targetPath)) {
        convertibles.push({ kind: "retarget-link", path: doc.path, element: "body", action: "edit", targets: [renameMap.get(targetPath)!], detail: `link ${link} retargets ${targetPath} → ${renameMap.get(targetPath)}` });
        if (doc.disposition === "preserve" && emitDocEdits) {
          plannedWrites.push({ target: doc.path, kind: "document-edit", source: doc.path, destination: `retarget link ${link} → ${renameMap.get(targetPath)}` });
        }
      } else if (removedSources.has(targetPath)) {
        residualRisks.push({ kind: "stale-link", path: doc.path, detail: `link ${link} targets ${targetPath}, which leaves Git at migration — the reference has no durable target` });
        dest({ source: doc.path, element: "body", action: "unmapped", target: `link ${link} → stale (target converts out of durable form)` });
      }
    }
  }

  for (const [id, sources] of idClaims) {
    if (sources.length > 1) {
      collisions.push({ target: id, kind: "id-exists", sources: sortStrings(sources), suggestedTarget: null });
    }
  }
  for (const runId of migratedRunIds) {
    if (runs.some((run) => run.runId === runId)) {
      collisions.push({ target: `${EXECUTION_STATE_ROOT}/runs/${runId}`, kind: "run-exists", sources: ["migrated"], suggestedTarget: runIdFor(`run:collision:${runId}`) });
    }
  }

  // --- foreign state -----------------------------------------------------------------
  for (const entry of foreignState) {
    if (entry.kind === "escape") {
      decide({
        kind: "scope-escape",
        path: entry.path,
        element: entry.namespace === "dir" ? "directory" : "file",
        candidates: ["remove-the-link-then-replan"],
        default: null,
        required: true,
        summary: `${entry.detail} — inventory refuses to follow escaped paths`,
      });
      residualRisks.push({ kind: "scope-escape", path: entry.path, detail: entry.detail });
      continue;
    }
    if (entry.kind === "corrupt-run") {
      decide({
        kind: "foreign-state-disposition",
        path: entry.path,
        element: "run",
        candidates: ["discard-at-finalize", "preserve-as-diagnostic"],
        default: null,
        required: true,
        summary: `${entry.detail} — it cannot be adopted as a run`,
      });
      continue;
    }
    if (isUnderDir(entry.path, DOC_DRIVEN_DEV_DIR)) {
      outOfScope.push({
        path: entry.path,
        kind: "legacy-state-file",
        action: "remove-at-finalize",
        detail: "v2 state content inside the manifest namespace has no v3 target — removed at finalize, diagnostics only",
      });
      dest({ source: entry.path, element: "file", action: "drop", target: "removed at finalize (v2 state)" });
    } else {
      decide({
        kind: "foreign-state-disposition",
        path: entry.path,
        element: "file",
        candidates: ["discard-at-finalize", "preserve-as-diagnostic-trace"],
        default: null,
        required: true,
        summary: `${entry.detail} — disposition must be declared`,
      });
      dest({ source: entry.path, element: "file", action: "decision", target: "decision:foreign-state-disposition" });
    }
  }

  // --- unreadable inputs -------------------------------------------------------------
  // Every input the hash could not read is a structured finding — the report
  // never dies on one bad file. Documents already carry their own
  // unreadable-input decision through the per-document pass.
  for (const rel of sortStrings(unreadableInputs)) {
    residualRisks.push({ kind: "unreadable-input", path: rel, detail: "input could not be read — the plan is computed without its content" });
    const file = files.find((entry) => entry.path === rel);
    if (file?.cls === "doc") continue; // decided in the per-document pass
    decide({
      kind: "unreadable-input",
      path: rel,
      element: "file",
      candidates: ["restore-readability-then-replan", "discard"],
      default: null,
      required: true,
      summary: `${rel} cannot be read — the inventory is provably incomplete until the input is readable`,
    });
  }

  // --- schema manifest write ----------------------------------------------------------
  // Only planned when the classification actually runs an apply: bootstrap
  // gets scaffold_docs instead; current/recovery/blocked have their own path.
  if ((classification === "manifest-only" || classification === "migration")
    && (preflight.manifest.state === "missing" || preflight.manifest.state === "malformed" || preflight.status === "migration-required")) {
    plannedWrites.push({
      target: `${DOC_DRIVEN_DEV_DIR}/schema.json`,
      kind: "schema-manifest",
      source: "declared",
      destination: "schema manifest installed/repaired last — finalized `current` only after post-migration integrity checks",
    });
  }

  // --- duplicate write targets --------------------------------------------------------
  // Collision detection covers ALL planned writes — durable converts, run
  // records, receipts, checkpoints, run manifests, run traces, index regen,
  // and the schema manifest itself — so this pass runs only after every
  // write is emitted. Two writers on one path is never silently merged or
  // overwritten at apply.
  const writeClaims = new Map<string, string[]>();
  for (const write of plannedWrites) {
    writeClaims.set(write.target, [...(writeClaims.get(write.target) ?? []), write.source]);
  }
  for (const [target, sources] of writeClaims) {
    const unique = sortStrings(new Set(sources));
    // One source may plan several edits on its own target (annotate fields,
    // retarget links) — a collision is distinct writers sharing one path.
    if (unique.length > 1) {
      collisions.push({ target, kind: "duplicate-target", sources: unique, suggestedTarget: null });
      decide({
        kind: "target-collision",
        path: unique[0],
        element: "file",
        targets: unique,
        candidates: ["resolve-shared-target", "drop-duplicate-writes"],
        default: null,
        required: true,
        summary: `${unique.length} distinct writers target ${target} — concurrent writes on one path are never silently merged`,
      });
    }
  }

  // --- run handoffs ---------------------------------------------------------------------
  const runHandoffs: RunHandoff[] = [];
  for (const run of runs) {
    if (run.status === "corrupt") continue;
    runHandoffs.push({
      runId: run.runId,
      origin: "existing",
      status: run.status,
      handoffRequired: run.status === "active",
      methods: run.status === "active" ? [...HANDOFF_METHODS] : [],
    });
  }
  for (const runId of [...migratedRunIds].sort(compareCodeUnits)) {
    runHandoffs.push({
      runId,
      origin: "migrated",
      status: "active",
      handoffRequired: true,
      methods: [...HANDOFF_METHODS],
    });
  }
  runHandoffs.sort((a, b) => compareCodeUnits(a.runId, b.runId) || compareCodeUnits(a.origin, b.origin));

  // --- finalize decisions, verdict, hash ---------------------------------------------
  const sortedDecisions = decisions
    .sort((a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.path, b.path) || compareCodeUnits(a.element, b.element) || compareCodeUnits(a.summary, b.summary))
    .map((decision, index) => ({ ...decision, decisionId: `D-${String(index + 1).padStart(4, "0")}` }));

  const resolutionsRequired: ResolutionGroup[] = [...new Set(sortedDecisions.map((decision) => decision.kind))]
    .sort(compareCodeUnits)
    .map((kind) => {
      const group = sortedDecisions.filter((decision) => decision.kind === kind);
      return {
        kind,
        count: group.length,
        required: group.some((decision) => decision.required),
        decisionIds: group.map((decision) => decision.decisionId),
        prompt: `${group.length} ${kind} decision(s) require explicit resolution input before apply`,
      };
    });

  const issueKey = (issue: PreflightIssue): string => `${issue.reason}:${issue.path}:${issue.detail}`;
  const issueSort = (a: PreflightIssue, b: PreflightIssue): number => compareCodeUnits(issueKey(a), issueKey(b));
  const blockers = [...preflight.issues, ...preflight.detected.manifestMarkers]
    .filter((issue, index, all) => {
      const key = issueKey(issue);
      return (issue.reason.startsWith("legacy-") || issue.reason === "scope-escape" || issue.reason === "manifest-escaped" || issue.reason === "manifest-unreadable")
        && all.findIndex((other) => issueKey(other) === key) === index;
    })
    .sort(issueSort);

  // The emitted preflight is sorted like its hash inputs — byte-stable
  // report, byte-stable hash.
  const emittedPreflight: SchemaPreflightReport = {
    ...preflight,
    issues: [...preflight.issues].sort(issueSort),
    detected: { ...preflight.detected, manifestMarkers: [...preflight.detected.manifestMarkers].sort(issueSort) },
  };

  const migrationStatus: MigrationPlanReport["migration"]["status"] =
    classification === "blocked" || classification === "recovery"
      || collisions.length > 0 || foreignState.some((entry) => entry.kind === "escape")
      ? "blocked"
      : sortedDecisions.length > 0 ? "awaiting-resolution"
        : plannedWrites.length > 0 ? "planned" : "nothing";

  // The bounded apply exists only to install or repair the manifest on
  // content the plan itself classified as already consistent — it is never
  // eligible over legacy content, unverifiable state, or blocking findings.
  const applyEligible = (classification === "manifest-only" || classification === "current")
    && blockers.length === 0;

  const counts = {
    documents: documents.length,
    indexes: indexes.length,
    experimentLogs: experiments.length,
    runs: runs.length,
    foreignState: foreignState.length,
    legacyRelations: legacyRelations.length,
    callerBookkeeping: bookkeeping.size,
    unmanagedFiles: files.filter((file) => file.cls === "unmanaged").length,
  };

  const inventory = {
    inputFiles,
    inputHash,
    counts,
    documents,
    indexes,
    experimentLogs: experiments,
    callerBookkeeping: [...bookkeeping.values()].sort((a, b) => compareCodeUnits(a.path, b.path)),
    legacyRelations: legacyRelations.sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.field, b.field)),
    runs,
    foreignState,
  };
  const migration = {
    status: migrationStatus,
    plannedWrites: plannedWrites.sort((a, b) => compareCodeUnits(a.target, b.target) || compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.source, b.source)),
    removals: removals.sort((a, b) => compareCodeUnits(a.path, b.path)),
    collisions: collisions.sort((a, b) => compareCodeUnits(a.target, b.target)),
    convertibles: convertibles.sort((a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.path, b.path) || compareCodeUnits(a.element, b.element)),
    semanticDecisions: sortedDecisions,
    outOfScope: outOfScope.sort((a, b) => compareCodeUnits(a.path, b.path)),
    resolutionsRequired,
    residualRisks: residualRisks.sort((a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.path ?? "", b.path ?? "")),
    runHandoffs,
    destinations: destinations.sort((a, b) => compareCodeUnits(a.source, b.source) || compareCodeUnits(a.element, b.element)),
  };

  const hashPayload = {
    preflight: {
      status: emittedPreflight.status,
      issues: emittedPreflight.issues,
      manifest: emittedPreflight.manifest,
      detected: emittedPreflight.detected,
    },
    classification,
    inventory,
    migration,
  };
  const planHash = sha256(canonicalJson(hashPayload));

  // `next` mirrors the plan's own verdict: never "nothing to migrate" while
  // writes or decisions are pending, never "run apply" while ineligible.
  const next = classification === "bootstrap"
    ? "empty repository — this is a bootstrap target: scaffold_docs.js seeds the v3 tree, no migration is needed"
    : classification === "recovery"
      ? "a migration journal or in-progress marker is present — run doc_maintenance.js migrate recovery before replanning"
      : classification === "blocked"
        ? "the repository state cannot be verified or is newer than this toolchain — resolve the preflight issues and scope escapes first"
        : migrationStatus === "blocked"
          ? "the plan is blocked by collisions or scope escapes — resolve them and replan; nothing is applyable as scanned"
          : classification === "current"
            ? sortedDecisions.length > 0
              ? `already current — nothing migrates; ${sortedDecisions.length} advisory decision(s) remain over non-migration content`
              : "already current — nothing to migrate"
            : applyEligible
              ? sortedDecisions.length > 0
                ? `content is already consistent — run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… to install the manifest; ${sortedDecisions.length} advisory decision(s) also remain`
                : `content is already consistent — run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… to install the manifest`
              : blockers.length > 0
                ? sortedDecisions.length > 0
                  ? `legacy artifacts or unsafe state block the bounded apply — resolve them, or settle ${sortedDecisions.length} pending decision(s) and run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… --resolutions <file>`
                  : `legacy artifacts or unsafe state block the bounded apply — resolve them, or run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… for the journaled migration`
                : `migration plan assembled: ${plannedWrites.length} planned write(s), ${sortedDecisions.length} semantic decision(s) pending explicit input — resolve them in a resolutions file, then run doc_maintenance.js migrate apply --expect ${planHash.slice(0, 12)}… --resolutions <file>`;

  return {
    preflight: emittedPreflight,
    plan: {
      classification,
      applyEligible,
      requiresFullMigration: classification === "migration",
      blockers,
      planHash,
      next,
    },
    inventory,
    migration,
  };
}

export { buildMigrationPlan, convertedId, hashId, relationEntries };
export type {
  Destination,
  InventoryDocument,
  InventoryIndex,
  InventoryExperiment,
  InventoryBookkeeping,
  InventoryLegacyRelation,
  InventoryRun,
  ForeignStateEntry,
  MigrationPlanReport,
  PlannedWrite,
  PlannedRemoval,
  PlanCollision,
  Convertible,
  SemanticDecision,
  OutOfScopeItem,
  ResolutionGroup,
  ResidualRisk,
  RunHandoff,
  PlanClassification,
};
