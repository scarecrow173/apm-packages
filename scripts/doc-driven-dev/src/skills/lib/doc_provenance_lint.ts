"use strict";

import { contractForType, finding, isExternalReference, staleUpstreamTargets } from "./doc_repository";
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
        blocking: true,
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

// ---------------------------------------------------------------------------
// Stale upstreams (Issue #166)
// ---------------------------------------------------------------------------

/**
 * `traceability-missing-upstream` covers upstreams that were never declared;
 * `stale-upstream` covers declared upstreams that went dead underneath an
 * in-flight document — the "left behind" symptom the Issue #127 lifecycle
 * analysis measured and promoted here. The semantics live in
 * `staleUpstreamTargets` (`doc_repository.ts`): `implements`/`derives-from`/
 * `refines` targets resolving to a document whose status is dead
 * (`superseded`/`rejected`/`deprecated`/`archived`/`abandoned`/`wont-do`/
 * `completed`/`done`). A `completed`/`done` upstream does flag — an in-flight
 * task on a finished plan is the forgotten-leftover case — while
 * `approved`/`accepted`/`implemented`/`resolved` upstreams do not, because
 * deriving from a normative baseline or settled evidence is normal.
 * Non-blocking warning: stale lineage is a signal to re-point or close, not
 * a contract violation.
 */
function lintStaleUpstreams(model: DocumentRepository, scope: LintScope): Finding[] {
  const findings: Finding[] = [];
  for (const document of scope.documents) {
    if (document.parseError) continue;
    for (const stale of staleUpstreamTargets(model, document)) {
      findings.push(finding({
        ruleId: "stale-upstream",
        category: "traceability",
        severity: "warning",
        path: document.path,
        artifactId: document.id,
        message: `In-flight document ${stale.field} a ${stale.upstream.status} upstream: ${stale.target} — re-point or close`,
        target: stale.target,
        repair: "manual",
      }));
    }
  }
  return findings;
}

export { lintProvenance, lintStaleUpstreams, lintTraceability };
