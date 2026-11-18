"use strict";

// ---------------------------------------------------------------------------
// Repository-level authorities lint (Issue #246)
// ---------------------------------------------------------------------------
//
// Two repo-wide check families that no per-type scope can express:
//
//   tracked execution docs — every Git-tracked Markdown under a
//     migration-owned dir (former plan/task homes, legacy test-spec/impl/exp
//     scope). Under Document Registry 3 those bytes are migration input,
//     never runtime state: plan/task state lives in the Git-external
//     Execution Store, legacy formats are interpreted only by migration
//     tooling. Each tracked leftover is a blocking migration marker.
//
//   evidence — the immutable Evidence Store is the outcome authority for
//     verification. Records are re-assessed against the live Knowledge
//     Graph (claim/check refs, pinned revisions, check→claim pairing,
//     method) and the checkout's HEAD subject, so a stale, unresolvable,
//     expired, or self-contradicting record surfaces as a finding instead
//     of silently passing as current coverage. Nothing here reads or
//     copies record bodies into durable Markdown — the store stays the
//     single canonical authority.
//
// Both run only on repo-wide queries (no --type narrowing, no --dir): a
// scoped audit reports the scope, a repo audit reports the repo.

import fs from "node:fs";
import path from "node:path";

import { inspectEvidenceStore, resolveCommitSubject, query } from "./evidence_store";
import type { StoreRootOptions } from "./execution_store";
import { gitContext, gitTrackedPaths } from "./execution_store/boundary";
import type { EvidenceRecordV1 } from "./evidence_store";
import { finding, migrationOwnedDirs } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import { ephemeralConfigs, executionTypes, resolveDocType } from "./doc_types";
import { normalizeDir } from "./document_utils";
import { projectKnowledgeGraph } from "./knowledge_graph";
import type { KnowledgeGraph } from "./knowledge_graph";
import { assessEvidenceIn, recordSubjectDigest } from "./verification_assessment";
import type { AssessmentReasonCode } from "./verification_assessment";

// ---------------------------------------------------------------------------
// Git-tracked execution / legacy documents
// ---------------------------------------------------------------------------

// Every former dir an execution-bound type (plan/task) declared — content
// under these is Execution-Store state that must migrate out of Git.
function executionOwnedDirs(): readonly string[] {
  const dirs = new Set<string>();
  for (const type of executionTypes) {
    for (const dir of ephemeralConfigs[type].formerDirs) dirs.add(normalizeDir(dir));
  }
  return [...dirs];
}

const EXECUTION_DIRS = executionOwnedDirs();

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

const MIGRATE_HINT = "run doc_maintenance.js migrate plan --json";

// The model's `legacy` classification is the corpus boundary — non-index
// Markdown under a migration-owned dir, plus any file whose declared
// `type:` has no durable home wherever it sits (Issue #246). Whether Git
// tracks it is a separate question only the work tree can answer:
// `git ls-files` is the authority, so untracked leftovers and gitignored
// files report as corpus the migration sweep still owns, never as
// tracked state. Where no usable work tree exists, tracking cannot be
// verified at all — the same corpus marker reports that honestly rather
// than guessing either way. A `.git` marker git cannot read still fails
// closed inside `gitContext`, matching the state-root boundary probes.
const MIGRATION_DIRS = migrationOwnedDirs();

function lintTrackedExecutionDocs(model: DocumentRepository): Finding[] {
  const context = gitContext(model.root);
  const tracked = context.kind === "worktree" ? gitTrackedPaths(model.root) : null;
  const findings: Finding[] = [];
  for (const document of model.legacyDocuments) {
    const dir = normalizeDir(path.posix.dirname(document.path));
    // The corpus family is type-aware first: an execution-bound spelling
    // (plan/task) is execution corpus wherever it lands, a legacy
    // spelling (test-spec/impl/exp) is legacy corpus — a durable dir
    // cannot re-brand either. Untyped or durable-typed leftovers keep
    // the directory's answer.
    const declared = document.type === null ? null : resolveDocType(document.type).kind;
    const executionBound = declared === "ephemeral"
      || (declared !== "legacy" && EXECUTION_DIRS.some((root) => isUnderDir(dir, root)));
    const inMigrationDir = MIGRATION_DIRS.some((root) => isUnderDir(dir, root));
    const placement = inMigrationDir ? "under a migration-owned directory" : "inside a durable directory";
    const typeName = document.type ?? "untyped";
    const isTracked = tracked !== null && tracked.has(document.path);
    findings.push(finding({
      ruleId: isTracked
        ? (executionBound ? "tracked-execution-doc" : "tracked-legacy-doc")
        : "legacy-corpus-doc",
      category: "migration",
      severity: "warning",
      blocking: true,
      path: document.path,
      artifactId: document.id,
      message: isTracked
        ? (executionBound
          ? `Git-tracked ${typeName} document has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store; ${MIGRATE_HINT} to inventory the migration`
          : `Git-tracked ${typeName} document is a legacy format under Document Registry 3 — migration tooling owns its interpretation; ${MIGRATE_HINT} to plan the migration`)
        : (tracked === null
          ? `${typeName} document sits ${placement} where Git tracking cannot be verified (no usable work tree) — corpus the migration sweep still owns; ${MIGRATE_HINT} to plan the migration`
          : `untracked ${typeName} document sits ${placement} — corpus the migration sweep still owns, never durable Git state; ${MIGRATE_HINT} to plan the migration`),
      target: document.type,
      repair: "migration",
    }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Evidence Store findings
// ---------------------------------------------------------------------------

// One lint rule per assessment reason code. Codes that name an axis the
// record itself controls map to blocking warnings — a stale or
// self-contradicting record must never read as current coverage. Codes
// reporting a judgment that is merely unconcluded (attestation-only,
// unverifiable subject, inconclusive outcome) stay informational.
const EVIDENCE_REASON_RULES: Record<AssessmentReasonCode, {
  ruleId: string;
  severity: "error" | "warning" | "info";
  blocking: boolean;
  message: string;
}> = {
  "claim-unresolved": { ruleId: "unresolved-evidence-claim", severity: "warning", blocking: true, message: "evidence claim ref no longer resolves in the Knowledge Graph" },
  "check-unresolved": { ruleId: "unresolved-evidence-check", severity: "warning", blocking: true, message: "evidence check ref no longer resolves in the Knowledge Graph" },
  "claim-revision-mismatch": { ruleId: "stale-evidence-revision", severity: "warning", blocking: true, message: "claim document revision moved since the evidence was recorded" },
  "check-revision-mismatch": { ruleId: "stale-evidence-revision", severity: "warning", blocking: true, message: "check design revision moved since the evidence was recorded" },
  "check-target-mismatch": { ruleId: "evidence-check-target-mismatch", severity: "warning", blocking: true, message: "the resolved check does not verify the claim the record credits" },
  "method-mismatch": { ruleId: "evidence-method-mismatch", severity: "warning", blocking: true, message: "recorded method is not the method the check designs" },
  "subject-mismatch": { ruleId: "stale-evidence-subject", severity: "warning", blocking: true, message: "evidence measured a different subject than the checkout's HEAD" },
  "subject-unverifiable": { ruleId: "unverifiable-evidence-subject", severity: "info", blocking: false, message: "the record's own subject cannot be digest-verified in this checkout" },
  "target-unverifiable": { ruleId: "unverifiable-evidence-target", severity: "info", blocking: false, message: "the audit target (HEAD) cannot be digest-resolved in this checkout" },
  "artifact-unavailable": { ruleId: "evidence-artifact-unavailable", severity: "warning", blocking: true, message: "a declared evidence artifact is known-inaccessible" },
  "artifact-expired": { ruleId: "evidence-artifact-expired", severity: "warning", blocking: true, message: "a declared evidence artifact is past its retention deadline" },
  "artifact-unverified": { ruleId: "unverified-evidence-artifact", severity: "warning", blocking: false, message: "a declared evidence artifact was never digest-verified" },
  "attestation-only": { ruleId: "attestation-only-evidence", severity: "info", blocking: false, message: "recorded outcome declares no fetchable artifacts — attestation-only" },
  "outcome-failed": { ruleId: "failed-evidence", severity: "warning", blocking: true, message: "an applicable evidence record measured a failed outcome" },
  "outcome-not-passed": { ruleId: "inconclusive-evidence", severity: "info", blocking: false, message: "recorded outcome is not a conclusive pass/fail measurement" },
};

const EVIDENCE_RULE_IDS: ReadonlySet<string> = new Set(
  Object.values(EVIDENCE_REASON_RULES).map((rule) => rule.ruleId),
);

// Store-level markers — not per-record axes, but the state of the store
// surface itself (`inspectEvidenceStore`). A torn or missing manifest can
// never certify the records under it, so the marker is blocking.
const EVIDENCE_STORE_RULE_IDS: ReadonlySet<string> = new Set([
  "corrupt-evidence-store",
  "unmanifested-evidence-store",
]);

// Migration-corpus markers — tracked leftovers name their committed
// state, untracked/unverifiable corpus names only that the sweep still
// owns it.
const CORPUS_DOC_RULE_IDS: ReadonlySet<string> = new Set([
  "legacy-corpus-doc",
  "tracked-execution-doc",
  "tracked-legacy-doc",
]);

// Rule ids a repo-wide query can emit that no per-type scope produces —
// doc_maintenance reads these off the collected findings as skipped
// (never repairable by the safe whitelist).
const REPO_LEVEL_RULE_IDS: ReadonlySet<string> = new Set([
  ...CORPUS_DOC_RULE_IDS,
  ...EVIDENCE_RULE_IDS,
  ...EVIDENCE_STORE_RULE_IDS,
]);

// Re-assess one record against the live graph and the checkout's HEAD
// subject — the same axes the Verification Summary consumes, reported as
// per-reason findings so a lint run names exactly which axis failed.
// `head` is the caller's single HEAD resolution — re-resolving per record
// would pay a git probe for every row (Issue #246).
function evidenceFindings(
  graph: KnowledgeGraph,
  record: EvidenceRecordV1,
  cwd: string,
  now: string,
  head: { commitOid: string; subjectDigest: string } | null,
): Finding[] {
  const assessment = assessEvidenceIn(graph, record, {
    subject: { kind: "commit", commit: "HEAD" },
    subjectDigest: head === null ? null : head.subjectDigest,
  }, {
    readDocument: (docPath) => {
      try {
        return fs.readFileSync(path.join(cwd, docPath), "utf8");
      } catch {
        return null;
      }
    },
    resolveSubjectDigest: (subject) => recordSubjectDigest(cwd, subject),
    now,
  });
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const reason of assessment.reasons) {
    const rule = EVIDENCE_REASON_RULES[reason.code];
    if (rule === undefined || seen.has(rule.ruleId)) continue;
    seen.add(rule.ruleId);
    findings.push(finding({
      ruleId: rule.ruleId,
      category: "evidence",
      severity: rule.severity,
      blocking: rule.blocking,
      path: null,
      artifactId: record.evidenceId,
      message: `${rule.message}: ${record.evidenceId} (claim ${record.claim.ref}, check ${record.check.ref}, outcome ${record.outcome})${reason.detail === null ? "" : ` — ${reason.detail}`}`,
      target: record.evidenceId,
      repair: "manual",
    }));
  }
  return findings;
}

// The store's own marker surface is audited once per run, before any
// record body is read (`inspectEvidenceStore`): a manifest that cannot
// certify its records is a blocking `evidence` finding, never a silent
// skip and never a thrown error that aborts the whole lint. An absent
// store is legitimate — there is nothing to audit and absent coverage is
// the Verification Summary's judgment, not a per-record lint finding.
async function lintEvidenceStore(
  cwd: string,
  model: DocumentRepository,
  options: StoreRootOptions & { now?: string } = {},
): Promise<Finding[]> {
  // `now` is the assessment instant (a timestamp string), not the store's
  // write clock — strip it so store reads see only the selector options.
  const { now: optionNow, ...storeOptions } = options;
  const store = inspectEvidenceStore(cwd, storeOptions);
  const findings: Finding[] = [];
  if (store.integrity === "corrupt" || store.integrity === "unmanifested") {
    findings.push(finding({
      ruleId: store.integrity === "corrupt" ? "corrupt-evidence-store" : "unmanifested-evidence-store",
      category: "evidence",
      severity: store.integrity === "corrupt" ? "error" : "warning",
      blocking: true,
      path: null,
      message: store.integrity === "corrupt"
        ? `Evidence Store manifest cannot certify the store — record integrity is unverifiable: ${store.detail}`
        : `Evidence records exist without the store's manifest marker — record integrity is unverifiable: ${store.detail}`,
      repair: "manual",
    }));
  }
  if (store.integrity === "absent") return findings;
  const records = query(cwd, {}, storeOptions);
  if (records.length === 0) return findings;
  const graph = projectKnowledgeGraph(model);
  const root = path.resolve(cwd);
  // HEAD resolves once per lint run — the target subject is identical for
  // every record, so a per-record git probe only paid for redundancy.
  const head = resolveCommitSubject(root, "HEAD");
  const now = optionNow ?? new Date().toISOString();
  for (const record of records) {
    findings.push(...evidenceFindings(graph, record, root, now, head));
  }
  return findings;
}

export {
  CORPUS_DOC_RULE_IDS,
  EVIDENCE_RULE_IDS,
  EVIDENCE_STORE_RULE_IDS,
  lintEvidenceStore,
  lintTrackedExecutionDocs,
  MIGRATE_HINT,
  REPO_LEVEL_RULE_IDS,
};
