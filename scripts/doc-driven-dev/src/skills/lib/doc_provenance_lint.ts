"use strict";

import { contractForType, finding, isExternalReference } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import type { LintScope } from "./doc_lint";

// ---------------------------------------------------------------------------
// Source provenance
// ---------------------------------------------------------------------------

function lintProvenance(model: DocumentRepository, scope: LintScope): Finding[] {
  const contract = contractForType(scope.type);
  const findings: Finding[] = [];

  for (const document of scope.documents) {
    if (document.parseError) continue;
    const sources = document.relations.source ?? [];
    const usable = sources.filter((value) => value.trim().length > 0);

    if (contract?.requiresSourceEvidence && usable.length === 0) {
      findings.push(finding({
        ruleId: "provenance-missing-source",
        category: "provenance",
        severity: "warning",
        path: document.path,
        artifactId: document.id,
        message: `${scope.type} requires relations.source evidence`,
        target: "source",
        repair: "manual",
      }));
    }

    for (const source of sources) {
      const value = source.trim();
      if (!value) {
        findings.push(finding({
          ruleId: "provenance-invalid-source",
          category: "provenance",
          severity: "warning",
          path: document.path,
          artifactId: document.id,
          message: "relations.source contains an empty value",
          target: source,
          repair: "manual",
        }));
        continue;
      }
      if (isExternalReference(value)) continue;

      const resolved = model.resolveRelationTarget(document, value);
      if (resolved.status === "resolved" || resolved.status === "resolved-file" || resolved.status === "external") continue;
      if (resolved.status === "ambiguous") {
        findings.push(finding({
          ruleId: "provenance-invalid-source",
          category: "provenance",
          severity: "warning",
          path: document.path,
          artifactId: document.id,
          message: `relations.source matches multiple artifacts: ${value}`,
          target: value,
          repair: "manual",
        }));
        continue;
      }
      if (resolved.status === "escaped") {
        findings.push(finding({
          ruleId: "provenance-invalid-source",
          category: "provenance",
          severity: "error",
          path: document.path,
          artifactId: document.id,
          message: `relations.source escapes the repository root: ${value}`,
          target: value,
          repair: "manual",
        }));
        continue;
      }
      findings.push(finding({
        ruleId: "provenance-unresolved-local-source",
        category: "provenance",
        severity: "warning",
        path: document.path,
        artifactId: document.id,
        message: `relations.source points to a missing local file: ${value}`,
        target: value,
        repair: "manual",
      }));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Artifact traceability
// ---------------------------------------------------------------------------

function lintTraceability(model: DocumentRepository, scope: LintScope): Finding[] {
  const contract = contractForType(scope.type);
  if (!contract || contract.expectedUpstream.length === 0) return [];
  const findings: Finding[] = [];

  for (const document of scope.documents) {
    if (document.parseError) continue;
    const status = document.status ?? "";
    for (const expectation of contract.expectedUpstream) {
      if (expectation.skipStatuses?.includes(status)) continue;
      const declared = expectation.fields.some((field) =>
        (document.relations[field] ?? []).some((target) => target.trim().length > 0));
      if (declared) continue;
      findings.push(finding({
        ruleId: "traceability-missing-upstream",
        category: "traceability",
        severity: "warning",
        path: document.path,
        artifactId: document.id,
        message: `${scope.type} declares no upstream relation (expected one of: ${expectation.fields.join(", ")})`,
        target: expectation.fields.join(", "),
        repair: "manual",
      }));
    }
  }
  return findings;
}

export { lintProvenance, lintTraceability };
