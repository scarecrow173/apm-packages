"use strict";

// ---------------------------------------------------------------------------
// Schema Manifest v1 + shared Migration Preflight (Issue #233)
// ---------------------------------------------------------------------------
//
// Consumer-side contract: `docs/.doc-driven-dev/schema.json` declares the
// schema generation the repository is on. A shared preflight sits at every
// normal CLI/generation/mutation entry and combines that manifest with a
// lightweight check of the actual files — never the manifest alone — to
// return exactly one of:
//
//   current | uninitialized | migration-required | migration-incomplete
//   | unsupported-version | invalid
//
// Normal execution is allowed only for `current` and `uninitialized`
// (nothing yet declared and nothing provably pre-contract). The three
// migration operations (`doc_maintenance migrate plan|apply|recovery`) are
// the only authorized way through a non-current state — there is no
// general guard-bypass, and legacy parsing lives only inside migration.
//
// Marker model (why it is asymmetric):
//   Without a manifest the repo is *undeclared*: every doc-tree shape —
//   canonical plan/task/impl docs, fm-less plans, impl evidence prose,
//   malformed front matter, populated non-v1 relations — is also a shape
//   this toolchain generation writes or tolerates, so none of it is
//   provably pre-contract. Only content inside the two namespaces the new
//   machinery owns is unmistakably foreign: files inside
//   `docs/.doc-driven-dev/` beyond the manifest/journal pair, legacy graph
//   YAML there, and content under `.apm/state/doc-driven-dev/` outside
//   `runs/<run-id>/` — the declared per-run layout (#236): files inside a
//   run directory are current state, while loose files directly under
//   `runs/` or anywhere else are foreign. Malformed docs stay the lint
//   layer's business.
//   Under a present manifest the repo has declared the v3 components, so
//   doc-tree inconsistency with that declaration flags too: execution-bound
//   canonical docs (plan/task/test-spec/impl no longer live in Git under
//   Document Registry 3) and relation fields outside the Knowledge
//   Relations v1 vocabulary.
//   When #234+ redefine the contract, the marker set tightens — the same
//   state machine keeps working.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import * as yaml from "js-yaml";

import { documentContracts } from "./doc_repository";
import {
  isIndexFileName,
  isInsideCheckout,
  nonReferenceRelationKeys,
} from "./document_utils";

// ---------------------------------------------------------------------------
// Manifest contract
// ---------------------------------------------------------------------------

const DOC_DRIVEN_DEV_DIR = "docs/.doc-driven-dev";
const SCHEMA_MANIFEST_PATH = `${DOC_DRIVEN_DEV_DIR}/schema.json`;
const MIGRATION_JOURNAL_PATH = `${DOC_DRIVEN_DEV_DIR}/migration.journal.json`;
const EXECUTION_STATE_ROOT = ".apm/state/doc-driven-dev";

const MANIFEST_SCHEMA_VERSION = 1;

// The schema generations this toolchain declares and accepts. Execution runs
// carry an independent `schemaVersion: 1` in their own run manifest (#236);
// they are not declared here.
const EXPECTED_COMPONENT_VERSIONS = {
  documentRegistry: 3,
  knowledgeRelations: 1,
  verificationDesign: 1,
  evidenceRecord: 1,
  graphDefinition: 3,
} as const;

const EXECUTION_RUN_SCHEMA_VERSION = 1;

const SCHEMA_PREFLIGHT_EXIT_CODE = 2;

function schemaManifestText(): string {
  return `${JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, ...EXPECTED_COMPONENT_VERSIONS }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

type SchemaPreflightStatus =
  | "current"
  | "uninitialized"
  | "migration-required"
  | "migration-incomplete"
  | "unsupported-version"
  | "invalid";

type PreflightReason =
  | "scope-escape"
  | "manifest-escaped"
  | "manifest-unreadable"
  | "manifest-malformed"
  | "schema-version-unsupported"
  | "component-version-unsupported"
  | "component-version-behind"
  | "manifest-migration-in-progress"
  | "migration-journal-present"
  | "legacy-execution-doc"
  | "legacy-relations"
  | "legacy-state-file"
  | "legacy-graph-state"
  | "legacy-execution-state";

type PreflightIssue = {
  reason: PreflightReason;
  path: string;
  detail: string;
};

type ManifestEvaluation =
  | { state: "missing" }
  | { state: "escaped" }
  | { state: "unreadable"; detail: string }
  | { state: "malformed"; detail: string }
  | {
      state: "read";
      declared: Record<string, number>;
      migrationInProgress: boolean;
      versionIssues: PreflightIssue[];
    };

type SchemaPreflightReport = {
  status: SchemaPreflightStatus;
  issues: PreflightIssue[];
  manifest: {
    path: string;
    state: "missing" | "valid" | "escaped" | "unreadable" | "malformed" | "unsupported";
    declared: Record<string, number> | null;
  };
  detected: {
    generation: "current" | "legacy" | "mixed" | "empty" | "unknown";
    canonicalDocs: number;
    executionDocs: number;
    unmanagedDocs: number;
    legacyMarkers: number;
    // Markers that only take effect under a declared manifest — shown so
    // migration tooling can see what installing a manifest would flag.
    manifestMarkers: PreflightIssue[];
  };
  recommended: { command: string | null; note: string } | null;
};

// ---------------------------------------------------------------------------
// Marker vocabulary
// ---------------------------------------------------------------------------

// Types whose durable Git-Markdown form is removed by Document Registry 3 —
// they migrate to the Execution Store / Verification Design / Evidence
// (#234–#240). Aliases that have appeared in the wild are included.
const EXECUTION_BOUND_TYPES: ReadonlySet<string> = new Set([
  "plan",
  "task",
  "test-spec",
  "impl",
  "implementation-record",
  "ir",
  "exp",
  "experiment-log",
  "impl-record",
]);

// Knowledge Relations v1: typed, unidirectional, stored source→target only
// (#235). `checks`/`supported-by` are derived, never stored; every populated
// relation key outside this set (and outside the non-reference metadata keys
// in document_utils) is legacy vocabulary under a declared manifest.
const KNOWLEDGE_RELATIONS_V1: ReadonlySet<string> = new Set([
  "motivates",
  "decides-for",
  "realizes",
  "informs",
  "explains",
  "supersedes",
]);

// Files the migration machinery may place inside docs/.doc-driven-dev/
// alongside schema.json. Anything else in that namespace is unaccounted-for
// state — nothing else writes there.
const MANIFEST_DIR_ALLOWED_FILES: ReadonlySet<string> = new Set([
  "schema.json",
  "migration.journal.json",
]);

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

type DocScan = {
  issues: PreflightIssue[];
  // Issues that only count once a manifest is present — they prove the
  // declared schema generation wrong rather than the repo pre-contract.
  manifestScopedIssues: PreflightIssue[];
  canonicalDocs: number;
  executionDocs: number;
  unmanagedDocs: number;
};

function toRepoRelative(cwd: string, absolute: string): string {
  return path.relative(path.resolve(cwd), absolute).split(path.sep).join("/");
}

function isUnderDir(relPath: string, dir: string): boolean {
  return relPath === dir || relPath.startsWith(`${dir}/`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Managed scan roots: every contract dir, split into the `docs/` subtree
// (walked once, recursively) and root-level alias dirs (walked each).
function managedRootAliases(): string[] {
  const dirs = new Set<string>();
  for (const contract of Object.values(documentContracts())) {
    for (const dir of [...contract.dirs, contract.canonicalDir]) {
      if (!dir.startsWith("docs/")) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

// Recursive read-only walk. The scan never follows out-of-checkout links:
// they are skipped and reported through `onEscape` so the caller decides what
// an escape means — the managed doc tree treats per-path containment as each
// operation's own contract, while the preflight-owned namespaces
// (docs/.doc-driven-dev, .apm/state/doc-driven-dev) fail closed because the
// manifest itself cannot be verified through an escaping container. Returns
// false when the root itself is absent, not a directory, or escapes.
function walkTree(
  cwd: string,
  relRoot: string,
  visit: (relPath: string, direntIsDir: boolean) => void,
  onEscape?: (relPath: string, kind: "dir" | "entry") => void,
): boolean {
  const absRoot = path.resolve(cwd, relRoot);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) return false;
  if (!isInsideCheckout(cwd, absRoot)) return false;
  const stack: string[] = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toRepoRelative(cwd, abs);
      if (entry.isDirectory()) {
        if (!isInsideCheckout(cwd, abs)) {
          onEscape?.(rel, "dir");
          continue;
        }
        visit(rel, true);
        stack.push(abs);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (!isInsideCheckout(cwd, abs)) {
          onEscape?.(rel, "entry");
          continue;
        }
        visit(rel, false);
      }
    }
  }
  return true;
}

// Doc-tree relation findings are always manifest-scoped: without a declared
// manifest the doc tree is whatever the toolchain produced (populated
// non-v1 vocabulary is today's shape; malformed values are the lint layer's
// findings). Under a declared-current manifest every one of them is an
// un-migrated inconsistency.
function relationIssues(relPath: string, relations: unknown): PreflightIssue[] {
  const scoped: PreflightIssue[] = [];
  if (relations === undefined) return scoped;
  if (!isPlainObject(relations)) {
    scoped.push({
      reason: "legacy-relations",
      path: relPath,
      detail: "relations: is not a map of relation keys to target lists",
    });
    return scoped;
  }
  for (const [key, value] of Object.entries(relations)) {
    // Metadata keys (changes / test-spec-skip) carry change sets and human
    // reasons, not document references — their shape is the lifecycle
    // contract's business, not this preflight's.
    if (nonReferenceRelationKeys.has(key)) continue;
    const populated = typeof value === "string"
      ? value.trim() !== ""
      : Array.isArray(value) && value.length > 0;
    const wellFormed = typeof value === "string"
      || (Array.isArray(value) && value.every((item) => typeof item === "string"));
    if (!wellFormed) {
      scoped.push({
        reason: "legacy-relations",
        path: relPath,
        detail: `relations.${key} is not a string or list of strings`,
      });
      continue;
    }
    if (!populated) continue;
    if (!KNOWLEDGE_RELATIONS_V1.has(key)) {
      scoped.push({
        reason: "legacy-relations",
        path: relPath,
        detail: `relations.${key} is outside the Knowledge Relations v1 vocabulary (stored forward set: ${[...KNOWLEDGE_RELATIONS_V1].join(", ")})`,
      });
    }
  }
  return scoped;
}

function scanDocuments(cwd: string): DocScan {
  const scan: DocScan = {
    issues: [],
    manifestScopedIssues: [],
    canonicalDocs: 0,
    executionDocs: 0,
    unmanagedDocs: 0,
  };
  const visitMarkdown = (rel: string): void => {
    const abs = path.resolve(cwd, rel);
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      return;
    }
    let data: Record<string, unknown> = {};
    let parsed = true;
    try {
      // An options object keeps this probe out of gray-matter's process-global
      // cache: bare matter(raw) writes matter.cache[raw] BEFORE parsing, so a
      // throwing parse would leave a poisoned entry every later bare call —
      // parseDoc in the audit/lint pipeline — reads as error-free.
      const result = matter(raw, {});
      data = isPlainObject(result.data) ? result.data : {};
    } catch {
      parsed = false;
    }
    const type = parsed && typeof data.type === "string" ? data.type : null;

    if (type === null) {
      // Typeless Markdown — whether raw or carrying a malformed `---` block —
      // is a legitimate managed shape (plans are fm-optional, impl evidence
      // notes are plain prose, broken docs are the lint layer's findings).
      // Nothing here is provably pre-registry, so it never becomes a marker.
      scan.unmanagedDocs += 1;
      return;
    }

    scan.canonicalDocs += 1;
    if (EXECUTION_BOUND_TYPES.has(type)) {
      scan.executionDocs += 1;
      scan.manifestScopedIssues.push({
        reason: "legacy-execution-doc",
        path: rel,
        detail: `type: ${type} has no durable Git form under Document Registry 3 (execution/verification artifacts live outside Git)`,
      });
    }

    if (parsed) {
      scan.manifestScopedIssues.push(...relationIssues(rel, data.relations));
    }
  };

  const visitDocsTree = (rel: string): void => {
    if (isUnderDir(rel, DOC_DRIVEN_DEV_DIR)) return; // namespace scan handles it
    if (rel.endsWith(".md") && !isIndexFileName(path.basename(rel))) {
      visitMarkdown(rel);
      return;
    }
    // Non-Markdown inside docs/impl/** is execution state (EXP JSONL today).
    if (isUnderDir(rel, "docs/impl")) {
      scan.manifestScopedIssues.push({
        reason: "legacy-execution-doc",
        path: rel,
        detail: `execution artifact under docs/impl has no durable Git form under Document Registry 3`,
      });
    }
  };

  const roots = ["docs", ...managedRootAliases()];
  const walked = new Set<string>();
  for (const root of roots) {
    const abs = path.resolve(cwd, root);
    let key = abs;
    try { key = fs.realpathSync(abs); } catch { /* absent or link */ }
    if (walked.has(key)) continue;
    walked.add(key);
    // Doc-tree escapes are silent: per-path containment is each operation's
    // own contract (creators, audits, migrations reject or handle symlinked
    // leaves themselves), and a preflight refusal would pre-empt it.
    walkTree(cwd, root, (rel, isDir) => {
      if (isDir) return;
      if (root === "docs") visitDocsTree(rel);
      else visitMarkdown(rel);
    });
  }
  return scan;
}

function scanManifestDir(cwd: string, issues: PreflightIssue[]): void {
  const abs = path.resolve(cwd, DOC_DRIVEN_DEV_DIR);
  if (!fs.existsSync(abs)) return;
  const walked = walkTree(cwd, DOC_DRIVEN_DEV_DIR, (rel, isDir) => {
    const name = path.basename(rel);
    if (isDir) {
      if (rel !== DOC_DRIVEN_DEV_DIR) {
        issues.push({
          reason: "legacy-state-file",
          path: rel,
          detail: `unaccounted-for directory inside ${DOC_DRIVEN_DEV_DIR}`,
        });
      }
      return;
    }
    if (MANIFEST_DIR_ALLOWED_FILES.has(name)) return;
    if (/\.ya?ml$/i.test(name)) {
      let legacy = false;
      try {
        const parsed = yaml.load(fs.readFileSync(path.resolve(cwd, rel), "utf8"));
        if (isPlainObject(parsed)) {
          const version = (parsed as Record<string, unknown>).schemaVersion;
          legacy = (typeof version === "number" && version < EXPECTED_COMPONENT_VERSIONS.graphDefinition)
            || ("nodes" in parsed && "edges" in parsed);
        }
      } catch { /* unreadable yaml is still foreign state */ }
      issues.push({
        reason: legacy ? "legacy-graph-state" : "legacy-state-file",
        path: rel,
        detail: legacy
          ? `graph/state YAML inside ${DOC_DRIVEN_DEV_DIR} predates Graph Definition ${EXPECTED_COMPONENT_VERSIONS.graphDefinition}`
          : `unaccounted-for file inside ${DOC_DRIVEN_DEV_DIR}`,
      });
      return;
    }
    issues.push({
      reason: "legacy-state-file",
      path: rel,
      detail: `unaccounted-for file inside ${DOC_DRIVEN_DEV_DIR}`,
    });
  }, (rel) => {
    issues.push({
      reason: "legacy-state-file",
      path: rel,
      detail: `entry inside ${DOC_DRIVEN_DEV_DIR} escapes the checkout through a link`,
    });
  });
  if (!walked) {
    // walkTree refused the root: either it resolves outside the checkout
    // through a link, or it is not a directory at all.
    let directory = false;
    try {
      directory = fs.statSync(abs).isDirectory();
    } catch { /* stat failure reports the same boundary failure */ }
    issues.push({
      reason: "scope-escape",
      path: DOC_DRIVEN_DEV_DIR,
      detail: directory
        ? `${DOC_DRIVEN_DEV_DIR} escapes the checkout through a link; the manifest boundary cannot be trusted`
        : `${DOC_DRIVEN_DEV_DIR} is not a directory; the manifest boundary cannot be verified`,
    });
  }
}

function scanExecutionState(cwd: string, issues: PreflightIssue[]): void {
  const abs = path.resolve(cwd, EXECUTION_STATE_ROOT);
  if (!fs.existsSync(abs)) return;
  const marker = (rel: string, detail: string): void => {
    issues.push({ reason: "legacy-execution-state", path: rel, detail });
  };
  const walked = walkTree(cwd, EXECUTION_STATE_ROOT, (rel, isDir) => {
    const relUnderRoot = rel.slice(EXECUTION_STATE_ROOT.length).replace(/^\/+/, "");
    const segments = relUnderRoot.split("/").filter(Boolean);
    if (isDir) {
      // `runs/` and the per-run directories beneath it (at whatever depth a
      // run keeps its own structure) are the declared layout; any other
      // directory under the state root is foreign.
      if (segments.length === 0) return;
      if (segments[0] !== "runs") {
        marker(rel, `unaccounted-for directory inside ${EXECUTION_STATE_ROOT}`);
      }
      return;
    }
    // The declared layout puts run files inside `runs/<run-id>/` (depth 3+):
    // a loose file directly under `runs/` or outside `runs/` entirely is
    // unaccounted-for state.
    if (segments[0] !== "runs" || segments.length < 3) {
      marker(rel, `content outside runs/<run-id>/ inside ${EXECUTION_STATE_ROOT}`);
      return;
    }
    const name = segments[segments.length - 1];
    if (/^(run|manifest|run\.manifest|run-manifest)\.json$/i.test(name)) {
      let version: unknown;
      try {
        version = (JSON.parse(fs.readFileSync(path.resolve(cwd, rel), "utf8")) as Record<string, unknown>).schemaVersion;
      } catch {
        version = null;
      }
      if (version !== EXECUTION_RUN_SCHEMA_VERSION) {
        marker(rel, `run manifest schemaVersion is ${JSON.stringify(version)}, expected ${EXECUTION_RUN_SCHEMA_VERSION}`);
      }
    }
  }, (rel) => {
    marker(rel, `entry inside ${EXECUTION_STATE_ROOT} escapes the checkout through a link`);
  });
  if (!walked) {
    let directory = false;
    try {
      directory = fs.statSync(abs).isDirectory();
    } catch { /* stat failure reports the same boundary failure */ }
    issues.push({
      reason: "scope-escape",
      path: EXECUTION_STATE_ROOT,
      detail: directory
        ? `${EXECUTION_STATE_ROOT} escapes the checkout through a link; execution state cannot be assessed`
        : `${EXECUTION_STATE_ROOT} is not a directory; execution state cannot be assessed`,
    });
  }
}

// ---------------------------------------------------------------------------
// Manifest boundary parsing
// ---------------------------------------------------------------------------

function readManifest(cwd: string): ManifestEvaluation {
  const rel = SCHEMA_MANIFEST_PATH;
  const abs = path.resolve(cwd, rel);
  if (!fs.existsSync(abs)) return { state: "missing" };
  if (!isInsideCheckout(cwd, abs)) return { state: "escaped" };
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (error: unknown) {
    return { state: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return { state: "malformed", detail: `schema.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isPlainObject(parsed)) {
    return { state: "malformed", detail: "schema.json must be a JSON object" };
  }
  const versionIssues: PreflightIssue[] = [];
  const schemaVersion = parsed.schemaVersion;
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) <= 0) {
    return { state: "malformed", detail: `schemaVersion must be a positive integer, got ${JSON.stringify(schemaVersion)}` };
  }
  if ((schemaVersion as number) > MANIFEST_SCHEMA_VERSION) {
    versionIssues.push({
      reason: "schema-version-unsupported",
      path: rel,
      detail: `manifest schemaVersion ${schemaVersion} is newer than supported ${MANIFEST_SCHEMA_VERSION} — upgrade the doc-driven-dev toolchain`,
    });
  }
  const declared: Record<string, number> = { schemaVersion: schemaVersion as number };
  for (const [key, expected] of Object.entries(EXPECTED_COMPONENT_VERSIONS)) {
    const value = parsed[key];
    if (value === undefined) {
      return { state: "malformed", detail: `missing component version: ${key}` };
    }
    if (!Number.isInteger(value) || (value as number) <= 0) {
      return { state: "malformed", detail: `${key} must be a positive integer, got ${JSON.stringify(value)}` };
    }
    declared[key] = value as number;
    if ((value as number) > expected) {
      versionIssues.push({
        reason: "component-version-unsupported",
        path: rel,
        detail: `${key} ${value} is newer than supported ${expected} — upgrade the doc-driven-dev toolchain`,
      });
    } else if ((value as number) < expected) {
      versionIssues.push({
        reason: "component-version-behind",
        path: rel,
        detail: `${key} ${value} is behind supported ${expected} — migration is required`,
      });
    }
  }
  let migrationInProgress = false;
  if (parsed.migration !== undefined) {
    if (!isPlainObject(parsed.migration)) {
      return { state: "malformed", detail: "migration must be an object when present" };
    }
    const status = parsed.migration.status;
    if (status !== undefined && status !== "in-progress") {
      return { state: "malformed", detail: `migration.status must be "in-progress" when present, got ${JSON.stringify(status)}` };
    }
    migrationInProgress = status === "in-progress";
  }
  return { state: "read", declared, migrationInProgress, versionIssues };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function journalPresent(cwd: string): boolean {
  return fs.existsSync(path.resolve(cwd, MIGRATION_JOURNAL_PATH));
}

function recommendedCommand(status: SchemaPreflightStatus, docCount: number): SchemaPreflightReport["recommended"] {
  const maintenance = "node .apm/skills/doc-maintenance/scripts/doc_maintenance.js";
  switch (status) {
    case "current":
      return null;
    case "uninitialized":
      return docCount === 0
        ? { command: "node .apm/skills/doc-maintenance/scripts/scaffold_docs.js", note: "no manifest and no managed content — scaffold the doc tree, or declare the current schema via doc_maintenance.js migrate plan/apply" }
        : { command: `${maintenance} migrate plan --json`, note: "no schema manifest — run migrate plan to evaluate whether migration is needed, then migrate apply to declare the schema" };
    case "migration-required":
      return { command: `${maintenance} migrate plan --json`, note: "legacy artifacts or older declared versions — plan the migration, then run migrate apply --expect <planHash>" };
    case "migration-incomplete":
      return { command: `${maintenance} migrate recovery --json`, note: "a migration journal or in-progress marker is present — inspect and recover before normal execution resumes" };
    case "unsupported-version":
      return { command: null, note: "the manifest declares a newer schema generation than this toolchain supports — upgrade doc-driven-dev, do not downgrade by hand" };
    case "invalid":
      return { command: `${maintenance} migrate plan --json`, note: "manifest or repository state cannot be verified — run migrate plan for the full diagnostic" };
  }
}

function statusSummary(report: SchemaPreflightReport): string {
  switch (report.status) {
    case "current": return "schema manifest and repository content are consistent with the declared versions";
    case "uninitialized": return "no schema manifest; nothing provably pre-contract found";
    case "migration-required": return "legacy artifacts or older declared schema versions require migration";
    case "migration-incomplete": return "a migration journal or in-progress marker indicates a half-applied migration";
    case "unsupported-version": return "the manifest declares a schema generation newer than this toolchain";
    case "invalid": return "the manifest or repository state failed boundary validation";
  }
}

function evaluateSchemaPreflight(cwd: string): SchemaPreflightReport {
  const root = path.resolve(cwd);
  const scan = scanDocuments(root);
  scanManifestDir(root, scan.issues);
  scanExecutionState(root, scan.issues);
  const manifest = readManifest(root);
  const journal = journalPresent(root);

  const escapes = scan.issues.filter((issue) => issue.reason === "scope-escape");

  const finish = (
    status: SchemaPreflightStatus,
    issues: PreflightIssue[],
    manifestInfo: SchemaPreflightReport["manifest"],
  ): SchemaPreflightReport => {
    const legacyMarkers = new Set(
      [...issues, ...scan.manifestScopedIssues]
        .filter((issue) => issue.reason.startsWith("legacy-"))
        .map((issue) => `${issue.reason}:${issue.path}`),
    ).size;
    const managedDocs = scan.canonicalDocs + scan.unmanagedDocs;
    const generation: SchemaPreflightReport["detected"]["generation"] =
      escapes.length > 0 ? "unknown"
        : legacyMarkers > 0 ? (scan.canonicalDocs > scan.executionDocs ? "mixed" : "legacy")
          : managedDocs === 0 ? "empty" : "current";
    const report: SchemaPreflightReport = {
      status,
      issues,
      manifest: manifestInfo,
      detected: {
        generation,
        canonicalDocs: scan.canonicalDocs,
        executionDocs: scan.executionDocs,
        unmanagedDocs: scan.unmanagedDocs,
        legacyMarkers,
        manifestMarkers: scan.manifestScopedIssues,
      },
      recommended: recommendedCommand(status, managedDocs),
    };
    return report;
  };

  // Fail closed on anything that prevents verifying the tree.
  const readManifestInfo: SchemaPreflightReport["manifest"] = manifest.state === "read"
    ? { path: SCHEMA_MANIFEST_PATH, state: "valid", declared: manifest.declared }
    : { path: SCHEMA_MANIFEST_PATH, state: "missing", declared: null };
  if (escapes.length > 0) {
    return finish("invalid", escapes, readManifestInfo);
  }
  if (manifest.state === "escaped") {
    return finish("invalid", [{ reason: "manifest-escaped", path: SCHEMA_MANIFEST_PATH, detail: "schema.json resolves outside the checkout" }], { path: SCHEMA_MANIFEST_PATH, state: "escaped", declared: null });
  }
  if (manifest.state === "unreadable") {
    return finish("invalid", [{ reason: "manifest-unreadable", path: SCHEMA_MANIFEST_PATH, detail: manifest.detail }], { path: SCHEMA_MANIFEST_PATH, state: "unreadable", declared: null });
  }
  if (manifest.state === "malformed") {
    return finish("invalid", [{ reason: "manifest-malformed", path: SCHEMA_MANIFEST_PATH, detail: manifest.detail }], { path: SCHEMA_MANIFEST_PATH, state: "malformed", declared: null });
  }

  if (manifest.state === "missing") {
    if (journal) {
      return finish("migration-incomplete", [{ reason: "migration-journal-present", path: MIGRATION_JOURNAL_PATH, detail: "a migration journal exists without a finalized manifest — the apply did not complete" }], { path: SCHEMA_MANIFEST_PATH, state: "missing", declared: null });
    }
    const relevant = scan.issues.filter((issue) => issue.reason.startsWith("legacy-"));
    if (relevant.length > 0) {
      return finish("migration-required", relevant, { path: SCHEMA_MANIFEST_PATH, state: "missing", declared: null });
    }
    return finish("uninitialized", [], { path: SCHEMA_MANIFEST_PATH, state: "missing", declared: null });
  }

  // manifest.state === "read"
  const manifestIssues: PreflightIssue[] = manifest.versionIssues;
  const unsupported = manifestIssues.filter((issue) => issue.reason === "schema-version-unsupported" || issue.reason === "component-version-unsupported");
  const manifestInfo: SchemaPreflightReport["manifest"] = { path: SCHEMA_MANIFEST_PATH, state: "valid", declared: manifest.declared };
  if (unsupported.length > 0) {
    return finish("unsupported-version", unsupported, { ...manifestInfo, state: "unsupported" });
  }
  const inProgress: PreflightIssue[] = [];
  if (manifest.migrationInProgress) {
    inProgress.push({ reason: "manifest-migration-in-progress", path: SCHEMA_MANIFEST_PATH, detail: "manifest declares migration.status: in-progress" });
  }
  if (journal) {
    inProgress.push({ reason: "migration-journal-present", path: MIGRATION_JOURNAL_PATH, detail: "a migration journal is present — the apply did not complete" });
  }
  if (inProgress.length > 0) {
    return finish("migration-incomplete", inProgress, manifestInfo);
  }
  const behind = manifestIssues.filter((issue) => issue.reason === "component-version-behind");
  const allIssues = [...scan.issues, ...scan.manifestScopedIssues, ...behind];
  if (allIssues.length > 0) {
    return finish("migration-required", allIssues, manifestInfo);
  }
  return finish("current", [], manifestInfo);
}

// ---------------------------------------------------------------------------
// Entrypoint guard + migration op support
// ---------------------------------------------------------------------------

// The statuses normal execution may proceed under. `uninitialized` is the
// undeclared-but-clean state: nothing is declared and nothing found proves
// the repo predates the current contract. Everything else fails closed and
// the only way through is the enumerated migration surface.
function normalExecutionAllowed(status: SchemaPreflightStatus): boolean {
  return status === "current" || status === "uninitialized";
}

function entrypointRefusal(report: SchemaPreflightReport): Record<string, unknown> {
  return {
    error: "schema-preflight-blocked",
    exitCode: SCHEMA_PREFLIGHT_EXIT_CODE,
    readOnly: true,
    preflight: report,
  };
}

// Shared guard for every normal entrypoint. Prints the machine-readable
// refusal to stdout, a one-line summary to stderr, sets exit code 2, and
// returns false — the caller returns immediately without touching state.
function schemaEntrypointGuard(cwd: string): boolean {
  const report = evaluateSchemaPreflight(cwd);
  if (normalExecutionAllowed(report.status)) return true;
  console.log(JSON.stringify(entrypointRefusal(report), null, 2));
  const recommended = report.recommended?.command ?? "inspect docs/.doc-driven-dev/schema.json";
  console.error(`schema preflight blocked (${report.status}): ${statusSummary(report)} — run ${recommended}`);
  process.exitCode = SCHEMA_PREFLIGHT_EXIT_CODE;
  return false;
}

export {
  DOC_DRIVEN_DEV_DIR,
  EXECUTION_RUN_SCHEMA_VERSION,
  EXECUTION_STATE_ROOT,
  EXPECTED_COMPONENT_VERSIONS,
  MANIFEST_SCHEMA_VERSION,
  MIGRATION_JOURNAL_PATH,
  SCHEMA_MANIFEST_PATH,
  SCHEMA_PREFLIGHT_EXIT_CODE,
  entrypointRefusal,
  evaluateSchemaPreflight,
  journalPresent,
  normalExecutionAllowed,
  schemaEntrypointGuard,
  schemaManifestText,
  statusSummary,
};

export type {
  ManifestEvaluation,
  PreflightIssue,
  PreflightReason,
  SchemaPreflightReport,
  SchemaPreflightStatus,
};
