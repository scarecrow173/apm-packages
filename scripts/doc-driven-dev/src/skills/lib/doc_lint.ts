"use strict";

import fs from "node:fs";
import path from "node:path";

import { contractForType, finding, isExternalReference, REQUIRED_FRONT_MATTER_FIELDS, sortFindings } from "./doc_repository";
import type { DocumentRepository, Finding, RepositoryDocument } from "./doc_repository";
import { lintProvenance, lintStaleUpstreams, lintTraceability } from "./doc_provenance_lint";
import { lintStructure } from "./doc_structure_lint";
import { configFor, docTypes, frontMatterSchema, isForeignDocType } from "./doc_suite_utils";
import { allIdPrefixes } from "./doc_types";
import { isIndexFileName, isInsideRealpath, normalizeDir } from "./document_utils";
import { parseClaimReference } from "./claim_ids";
import { projectKnowledgeGraph } from "./knowledge_graph";
import type { KnowledgeGraphIssueCode } from "./knowledge_graph";

// ---------------------------------------------------------------------------
// Audit profiles
// ---------------------------------------------------------------------------

// `artifact` audits the canonical document graph only — front matter,
// relations, links, provenance, traceability, required canonical files, and
// canonical-graph orphans. `materialized` (the default, Issue #195) adds the
// managed-index checks on top: index presence, membership, consistency, and
// index-membership orphans.
type AuditProfile = "artifact" | "materialized";

// RuleIds evaluated only under the materialized profile. The tag lives next
// to the rules it classifies; finding categories are not a faithful boundary
// (`orphan-index` is category "orphan", `missing-overview` is "structure").
const MATERIALIZED_RULE_IDS: ReadonlySet<string> = new Set([
  "missing-index",
  "index-missing-entry",
  "index-missing-overview",
  "index-unparseable",
  "index-escapes-root",
  "index-stale-entry",
  "index-tier-mismatch",
  "index-duplicate-entry",
  "index-metadata-mismatch",
  "index-ordering",
  "orphan-index",
]);

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

type LintScope = {
  type: string;
  directory: string;
  documents: RepositoryDocument[];
  files: RepositoryDocument[];
};

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

function relativeToDir(directory: string, repoPath: string): string {
  const relative = path.posix.relative(normalizeDir(directory), repoPath);
  return relative === "" ? path.posix.basename(repoPath) : relative;
}

function scopeFor(model: DocumentRepository, type: string, directory: string): LintScope {
  const dir = normalizeDir(directory);
  const files = model.files.filter(
    (file) => isUnderDir(file.path, dir) && !isIndexFileName(path.posix.basename(file.path)),
  );
  const documents = files.filter(
    (file) => !isForeignDocType(file.type, type, dir),
  );
  return { type, directory: dir, documents, files };
}

// ---------------------------------------------------------------------------
// Knowledge Relations v1 (Issue #235)
// ---------------------------------------------------------------------------
//
// Stored relations are canonical forward fields only — inverse links are
// derived projections, never stored input, so there is no reciprocal-link
// check to run: consistency is structural (the inverse view is computed
// from the same forward collation). The Knowledge Graph projection is the
// read authority for relation health; each projected issue maps to one
// rule here. `legacy-relation-field` is the migration-domain marker for
// populated pre-v3 keys — they are findings, never graph input.

const GRAPH_ISSUE_RULES: Record<KnowledgeGraphIssueCode, {
  ruleId: string;
  category: string;
  severity: "error" | "warning" | "info";
  blocking: boolean;
  repair: "safe" | "manual" | "migration";
}> = {
  "invalid-claim-id": { ruleId: "invalid-claim-id", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "claim-without-doc-id": { ruleId: "claim-without-doc-id", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "duplicate-claim": { ruleId: "duplicate-claim", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "claim-doc-mismatch": { ruleId: "claim-doc-mismatch", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "unresolved-claim-target": { ruleId: "unresolved-claim-target", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "legacy-relation-field": { ruleId: "legacy-relation-field", category: "relation", severity: "warning", blocking: true, repair: "migration" },
  "invalid-relation-field": { ruleId: "invalid-relation-field", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "unresolved-relation-target": { ruleId: "broken-relation-link", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "ambiguous-relation-target": { ruleId: "ambiguous-relation-target", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "relation-escapes-root": { ruleId: "relation-escapes-root", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "self-relation": { ruleId: "self-relation", category: "relation", severity: "warning", blocking: false, repair: "manual" },
  "invalid-relation-target-type": { ruleId: "invalid-relation-target-type", category: "traceability", severity: "warning", blocking: true, repair: "manual" },
  "relation-cycle": { ruleId: "relation-cycle", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  // Verification Design v1 Check contract (#239). Structural violations of
  // the `checks:` front-matter schema are errors like every other schema
  // rule; claim-resolution and body-anchor findings follow the
  // claim/relation convention of blocking warnings.
  "malformed-checks": { ruleId: "malformed-checks", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "malformed-check-entry": { ruleId: "malformed-check-entry", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "missing-check-field": { ruleId: "missing-check-field", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "invalid-check-id": { ruleId: "invalid-check-id", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "duplicate-check": { ruleId: "duplicate-check", category: "front-matter", severity: "warning", blocking: true, repair: "manual" },
  "invalid-check-target": { ruleId: "invalid-check-target", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "invalid-check-method": { ruleId: "invalid-check-method", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "check-criteria-mismatch": { ruleId: "check-criteria-mismatch", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "incomplete-required-check": { ruleId: "incomplete-required-check", category: "front-matter", severity: "error", blocking: true, repair: "manual" },
  "misplaced-checks": { ruleId: "misplaced-checks", category: "front-matter", severity: "warning", blocking: true, repair: "manual" },
  "unresolved-check-target": { ruleId: "unresolved-check-target", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "ambiguous-check-target": { ruleId: "ambiguous-check-target", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "invalid-check-anchor": { ruleId: "invalid-check-anchor", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "unresolved-check-anchor": { ruleId: "unresolved-check-anchor", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "duplicate-check-anchor": { ruleId: "duplicate-check-anchor", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "check-anchor-mismatch": { ruleId: "check-anchor-mismatch", category: "relation", severity: "warning", blocking: true, repair: "manual" },
  "misplaced-check-anchor": { ruleId: "misplaced-check-anchor", category: "relation", severity: "warning", blocking: true, repair: "manual" },
};

// Project the Knowledge Graph once per scope and attribute its issues to
// the files under this scope's directory. Shared dirs (docs/discovery hosts
// brainstorm and discovery) may surface the same issue under two scopes —
// report-level dedup collapses the repeats; the projection itself is the
// single authority.
function lintKnowledgeGraph(model: DocumentRepository, scope: LintScope): Finding[] {
  const graph = projectKnowledgeGraph(model);
  const findings: Finding[] = [];
  for (const issue of graph.issues) {
    if (!isUnderDir(issue.path, scope.directory)) continue;
    const rule = GRAPH_ISSUE_RULES[issue.code];
    findings.push(finding({
      ruleId: rule.ruleId,
      category: rule.category,
      severity: rule.severity,
      blocking: rule.blocking,
      path: issue.path,
      line: issue.line,
      artifactId: model.byPath.get(issue.path)?.id ?? null,
      message: issue.message,
      target: issue.target,
      repair: rule.repair,
    }));
  }
  return findings;
}

// Unmanaged files inside a managed dir are not Knowledge Graph nodes —
// their populated relation keys still resolve as references so dangling
// targets stay visible, but no stored-vocabulary or matrix rule applies.
// Claim-qualified values (`DOC::KEY`) are skipped rather than misread as
// paths: outside a canonical document they are unvalidated input, not
// broken links.
function lintUnmanagedRelations(model: DocumentRepository, document: RepositoryDocument): Finding[] {
  const findings: Finding[] = [];
  for (const [field, targets] of Object.entries(document.relations)) {
    // `source` provenance has its own rule family (lintProvenance).
    if (field === "source") continue;
    for (const target of targets) {
      if (isExternalReference(target) || parseClaimReference(target)) continue;
      const resolved = model.resolveRelationTarget(document, target);
      if (resolved.status === "external") continue;
      if (resolved.status === "ambiguous") {
        findings.push(finding({
          ruleId: "ambiguous-relation-target",
          category: "relation",
          severity: "warning",
          blocking: true,
          path: document.path,
          artifactId: document.id,
          message: `Relation ${field} target ${target} matches multiple artifacts: ${resolved.candidates.map((doc) => doc.path).join(", ")}`,
          target,
          repair: "manual",
        }));
        continue;
      }
      if (resolved.status === "escaped") {
        findings.push(finding({
          ruleId: "relation-escapes-root",
          category: "relation",
          severity: "warning",
          blocking: true,
          path: document.path,
          artifactId: document.id,
          message: `Relation ${field} points outside the repository root: ${target}`,
          target,
          repair: "manual",
        }));
        continue;
      }
      if (resolved.status === "unresolved") {
        findings.push(finding({
          ruleId: "broken-relation-link",
          category: "relation",
          severity: "warning",
          blocking: true,
          path: document.path,
          artifactId: document.id,
          message: `Relation ${field} points to missing target: ${target}`,
          target,
          repair: "manual",
        }));
        continue;
      }
      const targetDocument = resolved.status === "resolved" ? resolved.document : null;
      if (targetDocument && model.sameLogicalArtifact(targetDocument.path, document.path)) {
        findings.push(finding({
          ruleId: "self-relation",
          category: "relation",
          severity: "warning",
          path: document.path,
          artifactId: document.id,
          message: `Relation ${field} references the document itself: ${target}`,
          target,
          repair: "manual",
        }));
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function lintParseErrors(document: RepositoryDocument): Finding[] {
  if (!document.parseError) return [];
  return [finding({
    ruleId: "unparseable-front-matter",
    category: "front-matter",
    severity: "error",
    path: document.path,
    artifactId: document.id,
    message: `Front matter is not valid YAML: ${document.parseError}`,
    repair: "manual",
  })];
}

function formatIssuePath(pathParts: PropertyKey[]): string {
  return pathParts.length === 0 ? "$" : pathParts.map((part) => String(part)).join(".");
}

function lintFrontMatter(document: RepositoryDocument, scopeType: string): Finding[] {
  const findings: Finding[] = [];
  const schemaResult = frontMatterSchema.safeParse(document.frontMatter);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      // The lifecycle axis carries dedicated rule ids below — the schema's
      // generic enum complaint on that path would double-report.
      if (issue.path.length === 1 && issue.path[0] === "lifecycle") continue;
      findings.push(finding({
        ruleId: "invalid-front-matter",
        category: "front-matter",
        severity: "error",
        path: document.path,
        artifactId: document.id,
        message: `Invalid front matter ${formatIssuePath(issue.path)}: ${issue.message}`,
        target: formatIssuePath(issue.path),
        repair: "manual",
      }));
    }
  }
  if (document.type !== scopeType) {
    findings.push(finding({
      ruleId: "invalid-type",
      category: "front-matter",
      severity: "error",
      path: document.path,
      artifactId: document.id,
      message: `Expected type ${scopeType}`,
      target: document.type,
      repair: "manual",
    }));
  }
  const contract = contractForType(scopeType);
  if (contract && typeof document.status === "string" && !contract.statusValues.includes(document.status)) {
    findings.push(finding({
      ruleId: "invalid-status",
      category: "front-matter",
      severity: "error",
      path: document.path,
      artifactId: document.id,
      message: `Invalid ${scopeType} status: ${document.status}`,
      target: document.status,
      repair: "manual",
    }));
  }
  // The lifecycle axis is its own contract — never read off `status`.
  // Absent (or blank) is migration debt (`missing-lifecycle`, repairable
  // by the docs migration); a populated value — off-axis string *or*
  // wrong-typed (`lifecycle: 5`) — is `invalid-lifecycle` and is never
  // coerced to `current` (Issue #234). The repository model only exposes
  // string values, so the populated check reads the raw front matter.
  const rawLifecycle = document.frontMatter.lifecycle;
  const lifecyclePopulated = rawLifecycle !== undefined
    && rawLifecycle !== null
    && !(typeof rawLifecycle === "string" && rawLifecycle.trim() === "");
  if (!lifecyclePopulated) {
    findings.push(finding({
      ruleId: "missing-lifecycle",
      category: "front-matter",
      severity: "warning",
      blocking: true,
      path: document.path,
      artifactId: document.id,
      message: `Missing required front matter field: lifecycle (expected one of: ${(contract?.lifecycleValues ?? []).join(", ") || "draft, current, superseded, retired"})`,
      target: "lifecycle",
      repair: "migration",
    }));
  } else if (document.lifecycle === null || (contract && !contract.lifecycleValues.includes(document.lifecycle))) {
    const shown = typeof rawLifecycle === "string" ? rawLifecycle : JSON.stringify(rawLifecycle);
    findings.push(finding({
      ruleId: "invalid-lifecycle",
      category: "front-matter",
      severity: "error",
      path: document.path,
      artifactId: document.id,
      message: `Invalid ${scopeType} lifecycle: ${shown} (expected one of: ${(contract?.lifecycleValues ?? []).join(", ") || "draft, current, superseded, retired"})`,
      target: document.lifecycle ?? "lifecycle",
      repair: "manual",
    }));
  }
  // Type-specific required fields beyond the base set the schema already
  // enforces (e.g. `knowledge_kind` on knowledge docs), plus their declared
  // vocabularies — both come from the registry contract.
  const baseFields = new Set<string>(REQUIRED_FRONT_MATTER_FIELDS);
  for (const field of contract?.requiredFields ?? []) {
    if (baseFields.has(field)) continue;
    const value = document.frontMatter[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      findings.push(finding({
        ruleId: "missing-required-field",
        category: "front-matter",
        severity: "error",
        path: document.path,
        artifactId: document.id,
        message: `Missing required ${scopeType} front matter field: ${field}`,
        target: field,
        repair: "manual",
      }));
      continue;
    }
    const vocabulary = contract?.fieldVocabularies[field];
    if (vocabulary && typeof value === "string" && !vocabulary.includes(value)) {
      findings.push(finding({
        ruleId: "invalid-field-value",
        category: "front-matter",
        severity: "error",
        path: document.path,
        artifactId: document.id,
        message: `Invalid ${scopeType} ${field}: ${value} (expected one of: ${vocabulary.join(", ")})`,
        target: field,
        repair: "manual",
      }));
    }
  }
  if (contract && document.id && !contract.idExceptions.includes(document.id)) {
    if (!contract.idPattern.test(document.id)) {
      const wrongPrefix = /^[A-Z][A-Z0-9]*-[0-9A-Za-z]+$/.test(document.id);
      findings.push(finding({
        ruleId: wrongPrefix ? "invalid-id-prefix" : "invalid-id-format",
        category: "front-matter",
        severity: "error",
        path: document.path,
        artifactId: document.id,
        message: wrongPrefix
          ? `Artifact ID ${document.id} does not use the ${contract.idPrefix}- prefix required for type ${scopeType}`
          : `Artifact ID ${document.id} does not match the ${scopeType} ID format (${contract.idPrefix}-<digits> or ${contract.idPrefix}-<22-char Base62>)`,
        target: document.id,
        repair: "migration",
      }));
    }
  }
  return findings;
}

function lintDuplicateIds(model: DocumentRepository, scope: LintScope): Finding[] {
  const scoped = new Set(scope.documents.map((document) => document.path));
  const findings: Finding[] = [];
  for (const duplicate of model.duplicateIds()) {
    const inScope = duplicate.paths.filter((candidate) => scoped.has(candidate));
    for (const docPath of inScope) {
      findings.push(finding({
        ruleId: "duplicate-id",
        category: "relation",
        severity: "error",
        path: docPath,
        artifactId: duplicate.id,
        message: `Duplicate artifact ID ${duplicate.id}: ${duplicate.paths.join(", ")}`,
        target: duplicate.id,
        repair: "migration",
      }));
    }
  }
  return findings;
}

// A skip field such as `test-spec-skip` carries a free-text reason, not a
// relation target. The convention records it under `relations:` next to the
// `verified-by` it replaces; a top-level front-matter field also counts for
// backward compatibility. It never appears in `document.relations` — the
// repository model exempts it as a non-reference key at ingestion — so the
// gate reads the raw front matter (Issue #165).
function skipReasonRecorded(document: RepositoryDocument, field: string): boolean {
  const topLevel = document.frontMatter[field];
  if (typeof topLevel === "string" && topLevel.trim().length > 0) return true;
  const relations = document.frontMatter.relations;
  if (relations && typeof relations === "object" && !Array.isArray(relations)) {
    const nested = (relations as Record<string, unknown>)[field];
    if (typeof nested === "string" && nested.trim().length > 0) return true;
  }
  return false;
}

function lintRequiredRelations(model: DocumentRepository, document: RepositoryDocument, scopeType: string): Finding[] {
  const contract = contractForType(scopeType);
  if (!contract) return [];
  const findings: Finding[] = [];
  for (const required of contract.requiredRelations) {
    if (required.appliesToStatuses && !required.appliesToStatuses.includes(document.status ?? "")) continue;
    const values = document.relations[required.field] ?? [];
    const linked = values.some((target) => {
      const resolved = model.resolveRelationTarget(document, target);
      return resolved.status === "resolved" && required.targetTypes.includes(resolved.document.type ?? "");
    });
    const skip = required.skipField !== undefined && skipReasonRecorded(document, required.skipField);
    if (linked || skip) continue;

    findings.push(finding({
      ruleId: "missing-required-relation",
      category: "traceability",
      severity: "warning",
      blocking: true,
      path: document.path,
      artifactId: document.id,
      message: `Document requires a resolvable relations.${required.field} target of type ${required.targetTypes.join(" or ")}`,
      target: required.field,
      repair: "manual",
    }));
  }
  return findings;
}

function lintDirectory(model: DocumentRepository, scope: LintScope, profile: AuditProfile): Finding[] {
  const findings: Finding[] = [];
  const contract = contractForType(scope.type);
  const dir = scope.directory;

  // Required canonical files (e.g. the design overview.md) are part of the
  // artifact contract itself — they run under both profiles.
  for (const requiredFile of contract?.requiredDirectoryFiles ?? []) {
    const requiredPath = `${dir}/${requiredFile}`;
    if (!model.files.some((file) => file.path === requiredPath)) {
      findings.push(finding({
        ruleId: "missing-overview",
        category: "structure",
        severity: "error",
        path: null,
        message: `Missing required ${requiredPath}`,
        target: requiredFile,
        repair: "manual",
      }));
    }
  }

  // Everything below evaluates the managed index — a materialized view of the
  // canonical graph, not part of the artifact contract (Issue #195).
  if (profile === "artifact") return findings;

  const indexCandidates = model.files.filter((file) =>
    normalizeDir(path.posix.dirname(file.path)) === dir
    && /^(readme|index)\.md$/i.test(path.posix.basename(file.path)));
  const index = indexCandidates.find((file) => /^readme\.md$/i.test(path.posix.basename(file.path)))
    ?? indexCandidates[0];
  if (!index) {
    findings.push(finding({
      ruleId: "missing-index",
      category: "index",
      severity: "warning",
      blocking: true,
      path: null,
      message: `Missing ${scope.type} index README.md or index.md`,
      repair: "safe",
    }));
    return findings;
  }

  const indexContent = index.body;
  for (const document of scope.documents) {
    const file = relativeToDir(dir, document.path);
    if (!indexContent.includes(file)) {
      findings.push(finding({
        ruleId: "index-missing-entry",
        category: "index",
        severity: "warning",
        blocking: true,
        path: document.path,
        artifactId: document.id,
        message: `Index does not link ${file}`,
        target: file,
        repair: "safe",
      }));
    }
  }
  if (scope.type === "design" && !indexContent.includes("overview.md")) {
    findings.push(finding({
      ruleId: "index-missing-overview",
      category: "index",
      severity: "warning",
      blocking: true,
      path: `${dir}/overview.md`,
      message: "Index does not link overview.md",
      target: "overview.md",
      repair: "safe",
    }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Legacy id references in document bodies
// ---------------------------------------------------------------------------

const LEGACY_ID_TOKEN = /(?<![0-9A-Za-z])[A-Z][A-Z0-9]*-\d+(?![0-9A-Za-z])/g;
const EXPERIMENT_ID_PREFIX = "EXP";
const IMPL_EXP_DIR = "docs/impl/exp";
const NUMBERED_EXPERIMENT_FILE = /^(\d{4,})-.*\.jsonl$/i;

// Every ID prefix the toolchain has ever issued — durable, execution-bound,
// and legacy — is a legacy-reference vocabulary member: the registry's
// `allIdPrefixes` is the single declaration (Issue #234).
function legacyIdPrefixes(): Set<string> {
  return new Set<string>(allIdPrefixes());
}

// Experiment logs carry no artifact id; `EXP-NNNN` resolves only while
// exactly one numbered `NNNN-*.jsonl` exists, matching the migrate_ids.js
// contract that rewrites these tokens to `.jsonl` paths. Counts are kept per
// number so a duplicate number is ambiguous rather than silently resolved.
// Symlinked entries are excluded and the exp dir itself must stay inside the
// repository so audit semantics match the migrator, which never adopts
// symlinked logs or roots.
function experimentNumbers(root: string): Map<string, number> {
  const expDir = path.join(root, IMPL_EXP_DIR);
  if (!fs.existsSync(expDir)) return new Map();
  // The exp dir must stay inside the repository by real path — the shared
  // check fails closed so a symlinked dir cannot import outside logs.
  if (!isInsideRealpath(root, expDir)) return new Map();
  const counts = new Map<string, number>();
  for (const name of fs.readdirSync(expDir)) {
    if (isSymlinkPath(path.join(expDir, name))) continue;
    const match = NUMBERED_EXPERIMENT_FILE.exec(name);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

function isSymlinkPath(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function lintLegacyIdReferences(model: DocumentRepository, files: RepositoryDocument[]): Finding[] {
  const prefixes = legacyIdPrefixes();
  const expNumbers = experimentNumbers(model.root);
  const findings: Finding[] = [];
  for (const document of files) {
    const seen = new Map<string, number>();
    for (const match of document.body.matchAll(LEGACY_ID_TOKEN)) {
      const token = match[0];
      if (!prefixes.has(prefixOf(token))) continue;
      if (!seen.has(token)) {
        const bodyLine = document.body.slice(0, match.index).split("\n").length;
        seen.set(token, document.bodyStartLine + bodyLine);
      }
    }
    for (const [token, line] of [...seen.entries()].sort((a, b) => a[1] - b[1])) {
      if (model.lookupById(token).status !== "none") continue;
      if (prefixOf(token) === EXPERIMENT_ID_PREFIX) {
        const count = expNumbers.get(token.slice(EXPERIMENT_ID_PREFIX.length + 1)) ?? 0;
        if (count === 1) continue;
        if (count > 1) {
          findings.push(finding({
            ruleId: "ambiguous-experiment-reference",
            category: "relation",
            severity: "error",
            path: document.path,
            line,
            artifactId: document.id,
            message: `Experiment reference ${token} matches multiple experiment logs; rewrite it to a .jsonl path manually`,
            target: token,
            repair: "manual",
          }));
          continue;
        }
      }
      findings.push(finding({
        ruleId: "unresolved-legacy-reference",
        category: "relation",
        severity: "error",
        path: document.path,
        line,
        artifactId: document.id,
        message: `Body references legacy artifact id ${token}, which no artifact provides`,
        target: token,
        repair: "manual",
      }));
    }
  }
  return findings;
}

function prefixOf(token: string): string {
  return token.slice(0, token.lastIndexOf("-"));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function lintScope(
  model: DocumentRepository,
  type: string,
  directory: string,
  profile: AuditProfile = "materialized",
): Finding[] {
  const scope = scopeFor(model, type, directory);
  const findings: Finding[] = [];
  for (const document of scope.documents) {
    const parseFindings = lintParseErrors(document);
    if (parseFindings.length > 0) {
      findings.push(...parseFindings);
      continue;
    }
    findings.push(
      ...lintFrontMatter(document, type),
      ...lintRequiredRelations(model, document, type),
    );
    // Canonical durable documents are Knowledge Graph nodes — their relation
    // findings come from the projection (vocabulary, matrix, claims, cycles).
    // Unmanaged files inside a managed dir get resolution checks only.
    if (document.kind !== "canonical") {
      findings.push(...lintUnmanagedRelations(model, document));
    }
  }
  findings.push(...lintKnowledgeGraph(model, scope));
  findings.push(...lintLegacyIdReferences(model, scope.files));
  findings.push(...lintDuplicateIds(model, scope));
  findings.push(...lintDirectory(model, scope, profile));
  findings.push(...lintStructure(model, scope, profile));
  findings.push(...lintProvenance(model, scope));
  findings.push(...lintTraceability(model, scope));
  findings.push(...lintStaleUpstreams(model, scope));
  return sortFindings(findings);
}

export { lintLegacyIdReferences, lintScope, MATERIALIZED_RULE_IDS, scopeFor };
export type { AuditProfile, LintScope };
