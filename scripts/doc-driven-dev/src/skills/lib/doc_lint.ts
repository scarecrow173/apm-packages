"use strict";

import path from "node:path";

import { contractForType, finding, isExternalReference, sortFindings } from "./doc_repository";
import type { DocumentRepository, Finding, RepositoryDocument } from "./doc_repository";
import { lintProvenance, lintTraceability } from "./doc_provenance_lint";
import { lintStructure } from "./doc_structure_lint";
import { frontMatterSchema, isForeignDocType } from "./doc_suite_utils";
import { isIndexFileName, normalizeDir } from "./document_utils";

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
// Relation helpers
// ---------------------------------------------------------------------------

const RECIPROCAL_RELATIONS: Record<string, string> = {
  "implements": "implemented-by",
  "implemented-by": "implements",
  "derives-from": "derived-by",
  "derived-by": "derives-from",
  "refines": "refined-by",
  "refined-by": "refines",
  "verifies": "verified-by",
  "verified-by": "verifies",
  "supersedes": "superseded-by",
  "superseded-by": "supersedes",
  "defers": "deferred-by",
  "deferred-by": "defers",
  "depends-on": "blocks",
  "blocks": "depends-on",
  "related": "related",
};

function relationSourcePaths(document: RepositoryDocument): string[] {
  return [document.path, ...(document.id ? [document.id] : [])];
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
          : `Artifact ID ${document.id} does not match the ${scopeType} ID format (${contract.idPrefix}-<id>)`,
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

function lintRelations(model: DocumentRepository, document: RepositoryDocument, scopeType: string): Finding[] {
  const findings: Finding[] = [];
  const contract = contractForType(scopeType);
  const typedFields = new Map<string, string[]>();
  for (const required of contract?.requiredRelations ?? []) {
    typedFields.set(required.field, required.targetTypes);
  }

  for (const [field, targets] of Object.entries(document.relations)) {
    if (field === "source") continue;
    for (const target of targets) {
      if (isExternalReference(target)) continue;
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
      if (!targetDocument) continue;

      if (targetDocument.path === document.path) {
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
        continue;
      }

      const expectedTypes = typedFields.get(field);
      if (expectedTypes && targetDocument.type && !expectedTypes.includes(targetDocument.type)) {
        const ruleId = scopeType === "test-spec" && field === "verifies"
          ? "test-spec-invalid-verifies-target"
          : "invalid-relation-target-type";
        findings.push(finding({
          ruleId,
          category: "traceability",
          severity: "warning",
          blocking: true,
          path: document.path,
          artifactId: document.id,
          message: scopeType === "test-spec" && field === "verifies"
            ? `Test spec verifies target resolves to type "${targetDocument.type}", expected ${expectedTypes.join(", ").replace(/, ([^,]*)$/, ", or $1")}: ${target}`
            : `Relation ${field} target resolves to type "${targetDocument.type}", expected one of: ${expectedTypes.join(", ")}: ${target}`,
          target,
          repair: "manual",
        }));
      }

      const reciprocal = RECIPROCAL_RELATIONS[field];
      if (reciprocal) {
        const inverse = targetDocument.relations[reciprocal] ?? [];
        const sources = relationSourcePaths(document);
        if (inverse.length > 0 && !inverse.some((value) => sources.includes(value))) {
          const resolvedInverse = inverse.some((value) => {
            const back = model.resolveRelationTarget(targetDocument, value);
            return back.status === "resolved" && back.document.path === document.path;
          });
          if (!resolvedInverse) {
            findings.push(finding({
              ruleId: "inconsistent-reciprocal-relation",
              category: "relation",
              severity: "warning",
              path: document.path,
              artifactId: document.id,
              message: `Relation ${field} targets ${targetDocument.path}, which declares ${reciprocal} without a link back`,
              target,
              repair: "manual",
            }));
          }
        }
      }
    }
  }
  return findings;
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
    const skip = required.skipField
      && typeof document.frontMatter[required.skipField] === "string"
      && (document.frontMatter[required.skipField] as string).trim().length > 0;
    if (linked || skip) continue;

    if (scopeType === "test-spec" && required.field === "verifies") {
      findings.push(finding({
        ruleId: "test-spec-missing-verifies",
        category: "traceability",
        severity: "warning",
        blocking: true,
        path: document.path,
        artifactId: document.id,
        message: `Test spec has no relations.verifies target (${required.gateCode ?? "TEST-SPEC-DOC-GATE-001"})`,
        target: required.field,
        repair: "manual",
      }));
    } else if (scopeType === "plan" && required.field === "verified-by") {
      findings.push(finding({
        ruleId: "plan-missing-test-spec-evidence",
        category: "traceability",
        severity: "warning",
        blocking: true,
        path: document.path,
        artifactId: document.id,
        message: "Plan links no test-spec via relations.verified-by and records no test-spec-skip reason",
        target: required.field,
        repair: "manual",
      }));
    } else {
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
  }
  return findings;
}

function lintDirectory(model: DocumentRepository, scope: LintScope): Finding[] {
  const findings: Finding[] = [];
  const contract = contractForType(scope.type);
  const dir = scope.directory;

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
// Entry point
// ---------------------------------------------------------------------------

function lintScope(model: DocumentRepository, type: string, directory: string): Finding[] {
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
      ...lintRelations(model, document, type),
      ...lintRequiredRelations(model, document, type),
    );
  }
  findings.push(...lintDuplicateIds(model, scope));
  findings.push(...lintDirectory(model, scope));
  findings.push(...lintStructure(model, scope));
  findings.push(...lintProvenance(model, scope));
  findings.push(...lintTraceability(model, scope));
  return sortFindings(findings);
}

export { lintScope, scopeFor };
export type { LintScope };
