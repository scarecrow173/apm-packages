"use strict";

/**
 * Issue #127 — deterministic document-lifecycle cost measurement.
 *
 * This module measures what a document corpus costs to keep around. It does
 * NOT re-implement any diagnostic: repository parsing, relation/path
 * resolution, orphan semantics, lint findings, health categories, and the
 * lifecycle status axes all come from the existing doc-status surface
 * (`scanRepository`, `collectFindings`, `summarizeHealth`,
 * `inboundLinkCounts`, `inboundRelationCounts`). The only addition is
 * aggregation (per-type bucketing) over the shared settled/in-flight and
 * stale-upstream semantics — the latter was promoted to the `stale-upstream`
 * lint rule in Issue #166 and lives in `doc_repository.ts`
 * (`staleUpstreamTargets`), which this projection consumes.
 *
 * Output is a JSON-stable object — sorted keys, no wall-clock values, no
 * environment-sensitive data — so committed fixtures can byte-compare it.
 */

import { collectFindings, summarizeHealth } from "./doc_report";
import {
  artifactKeyOf,
  documentContracts,
  isExternalReference,
  isSettled,
  lifecycleBucketOf,
  staleUpstreamTargets,
  type DocumentRepository,
  type Finding,
  type RepositoryDocument,
} from "./doc_repository";
import { inboundLinkCounts, inboundRelationCounts } from "./doc_structure_lint";
import type { HealthReport } from "./doc_report";

// ---------------------------------------------------------------------------
// Stats shapes
// ---------------------------------------------------------------------------

type RelationResolutionCounts = {
  declared: number;
  resolved: number;
  resolvedFile: number;
  ambiguous: number;
  unresolved: number;
  escaped: number;
  external: number;
};

type TypeStats = {
  files: number;
  localizedFiles: number;
  bodyBytes: number;
  maxBodyBytes: number;
  statusCounts: Record<string, number>;
  settled: number;
  inFlight: number;
  staleUpstream: number;
  inboundLinkTargets: number;
  inboundRelationTargets: number;
  relations: RelationResolutionCounts;
  links: { declared: number; images: number; internal: number; external: number; unresolved: number; escaped: number };
  orphanIndex: number;
  orphanNavigation: number;
  orphanRelation: number;
  findings: number;
  blockingFindings: number;
};

type CorpusLifecycleStats = {
  tool: string;
  label: string;
  corpus: {
    scannedMarkdown: number;
    documents: number;
    canonicalDocuments: number;
    unmanagedDocuments: number;
    indexes: number;
    bodyBytes: number;
    settledDocuments: number;
    inFlightDocuments: number;
    staleUpstreamDocuments: number;
    duplicateIdGroups: number;
    missingTypes: string[];
  };
  relations: RelationResolutionCounts & {
    inboundTargets: number;
    byField: Record<string, RelationResolutionCounts>;
  };
  links: {
    declared: number;
    images: number;
    internal: number;
    external: number;
    unresolved: number;
    escaped: number;
    inboundTargets: number;
  };
  findings: {
    total: number;
    blocking: number;
    warnings: number;
    infos: number;
    onDocuments: number;
    onIndexes: number;
    unattributed: number;
    byRuleId: Record<string, number>;
    byCategory: Record<string, number>;
    health: HealthReport;
  };
  types: Record<string, TypeStats>;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const LOCALE_RE = /\.[a-z]{2}\.md$/i;

function emptyResolutionCounts(): RelationResolutionCounts {
  return { declared: 0, resolved: 0, resolvedFile: 0, ambiguous: 0, unresolved: 0, escaped: 0, external: 0 };
}

function emptyTypeStats(): TypeStats {
  return {
    files: 0,
    localizedFiles: 0,
    bodyBytes: 0,
    maxBodyBytes: 0,
    statusCounts: {},
    settled: 0,
    inFlight: 0,
    staleUpstream: 0,
    inboundLinkTargets: 0,
    inboundRelationTargets: 0,
    relations: emptyResolutionCounts(),
    links: { declared: 0, images: 0, internal: 0, external: 0, unresolved: 0, escaped: 0 },
    orphanIndex: 0,
    orphanNavigation: 0,
    orphanRelation: 0,
    findings: 0,
    blockingFindings: 0,
  };
}

function addResolution(counts: RelationResolutionCounts, status: string): void {
  counts.declared += 1;
  if (status === "resolved") counts.resolved += 1;
  else if (status === "resolved-file") counts.resolvedFile += 1;
  else if (status === "ambiguous") counts.ambiguous += 1;
  else if (status === "unresolved") counts.unresolved += 1;
  else if (status === "escaped") counts.escaped += 1;
  else if (status === "external") counts.external += 1;
}

function sortedRecord<T>(entries: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * Scan `cwd` once through the doc-status pipeline and project the repository
 * model into per-type lifecycle stats. Deterministic: corpus bytes, statuses,
 * relations, and findings are fully pinned by the fixture content.
 */
async function analyzeCorpus(cwd: string, options: { label?: string } = {}): Promise<CorpusLifecycleStats> {
  const collected = await collectFindings(cwd, {});
  const model: DocumentRepository = collected.model;
  const findings: Finding[] = collected.findings;
  const health = summarizeHealth(collected, findings);

  const linkCounts = inboundLinkCounts(model);
  const relationCounts = inboundRelationCounts(model);

  const typeStats = new Map<string, TypeStats>();
  const statsFor = (document: RepositoryDocument): TypeStats => {
    const bucket = lifecycleBucketOf(document);
    let stats = typeStats.get(bucket);
    if (!stats) {
      stats = emptyTypeStats();
      typeStats.set(bucket, stats);
    }
    return stats;
  };

  const corpusRelations = emptyResolutionCounts();
  const byField = new Map<string, RelationResolutionCounts>();
  const corpusLinks = { declared: 0, images: 0, internal: 0, external: 0, unresolved: 0, escaped: 0 };
  const corpus = {
    scannedMarkdown: model.files.length,
    documents: 0,
    canonicalDocuments: 0,
    unmanagedDocuments: 0,
    indexes: 0,
    bodyBytes: 0,
    settledDocuments: 0,
    inFlightDocuments: 0,
    staleUpstreamDocuments: 0,
    duplicateIdGroups: model.duplicateIds().length,
    missingTypes: [] as string[],
  };

  // artifact-key → bucket, so inbound relations attribute once per logical
  // artifact rather than once per localized file.
  const artifactBucket = new Map<string, string>();

  for (const document of model.files) {
    if (document.kind === "index") {
      corpus.indexes += 1;
      continue;
    }
    const stats = statsFor(document);
    const bucket = lifecycleBucketOf(document);
    artifactBucket.set(artifactKeyOf(document.path), bucket);

    corpus.documents += 1;
    if (document.kind === "canonical") corpus.canonicalDocuments += 1;
    if (document.kind === "unmanaged") corpus.unmanagedDocuments += 1;

    const bodyBytes = Buffer.byteLength(document.body, "utf8");
    corpus.bodyBytes += bodyBytes;
    stats.files += 1;
    stats.bodyBytes += bodyBytes;
    stats.maxBodyBytes = Math.max(stats.maxBodyBytes, bodyBytes);
    if (LOCALE_RE.test(document.path)) stats.localizedFiles += 1;

    const status = document.status ?? "(missing)";
    stats.statusCounts[status] = (stats.statusCounts[status] ?? 0) + 1;
    if (isSettled(document)) {
      stats.settled += 1;
      corpus.settledDocuments += 1;
    } else {
      stats.inFlight += 1;
      corpus.inFlightDocuments += 1;
    }

    // Stale upstream: in-flight document riding on a dead upstream — the
    // shared `stale-upstream` rule semantics (Issue #166), consumed here as a
    // count rather than duplicated.
    if (staleUpstreamTargets(model, document).length > 0) {
      stats.staleUpstream += 1;
      corpus.staleUpstreamDocuments += 1;
    }

    for (const [field, targets] of Object.entries(document.relations)) {
      let fieldCounts = byField.get(field);
      if (!fieldCounts) {
        fieldCounts = emptyResolutionCounts();
        byField.set(field, fieldCounts);
      }
      for (const target of targets) {
        const resolved = model.resolveRelationTarget(document, target);
        addResolution(corpusRelations, resolved.status);
        addResolution(stats.relations, resolved.status);
        addResolution(fieldCounts, resolved.status);
      }
    }

    if ((linkCounts.get(document.path) ?? 0) > 0) stats.inboundLinkTargets += 1;

    for (const link of document.links) {
      stats.links.declared += 1;
      corpusLinks.declared += 1;
      if (link.isImage) {
        stats.links.images += 1;
        corpusLinks.images += 1;
        continue;
      }
      if (isExternalReference(link.target)) {
        stats.links.external += 1;
        corpusLinks.external += 1;
        continue;
      }
      const resolved = model.resolvePath(document, link.target);
      if (resolved.status === "resolved") {
        stats.links.internal += 1;
        corpusLinks.internal += 1;
      } else if (resolved.status === "escaped") {
        stats.links.escaped += 1;
        corpusLinks.escaped += 1;
      } else {
        stats.links.unresolved += 1;
        corpusLinks.unresolved += 1;
      }
    }
  }

  // Inbound relation targets are artifact-level: a locale sibling shares its
  // artifact key, so count keys once per bucket.
  const inboundRelationKeys = new Set(relationCounts.keys());
  const countedArtifacts = new Set<string>();
  for (const [key, bucket] of artifactBucket) {
    if (!inboundRelationKeys.has(key) || countedArtifacts.has(key)) continue;
    countedArtifacts.add(key);
    typeStats.get(bucket)!.inboundRelationTargets += 1;
  }

  // Findings attribution: reuse doc-status findings verbatim — attribute each
  // to the scanned document it points at (index rows → onIndexes, paths with
  // no scanned doc → unattributed).
  const byRuleId = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const findingsSummary = {
    total: findings.length,
    blocking: 0,
    warnings: 0,
    infos: 0,
    onDocuments: 0,
    onIndexes: 0,
    unattributed: 0,
  };
  for (const item of findings) {
    byRuleId.set(item.ruleId, (byRuleId.get(item.ruleId) ?? 0) + 1);
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    if (item.blocking) findingsSummary.blocking += 1;
    else if (item.severity === "info") findingsSummary.infos += 1;
    else findingsSummary.warnings += 1;

    const target = item.path ? model.byPath.get(item.path) : undefined;
    if (!target) {
      findingsSummary.unattributed += 1;
      continue;
    }
    if (target.kind === "index") {
      findingsSummary.onIndexes += 1;
      continue;
    }
    findingsSummary.onDocuments += 1;
    const stats = typeStats.get(lifecycleBucketOf(target));
    if (!stats) continue;
    stats.findings += 1;
    if (item.blocking) stats.blockingFindings += 1;
    if (item.ruleId === "orphan-index") stats.orphanIndex += 1;
    else if (item.ruleId === "orphan-navigation") stats.orphanNavigation += 1;
    else if (item.ruleId === "orphan-relation") stats.orphanRelation += 1;
  }

  const contractTypes = Object.keys(documentContracts()).sort((a, b) => a.localeCompare(b));
  const presentBuckets = new Set(typeStats.keys());
  corpus.missingTypes = contractTypes.filter((type) => !presentBuckets.has(type));

  const inboundLinkTargets = model.files.filter(
    (file) => file.kind !== "index" && (linkCounts.get(file.path) ?? 0) > 0,
  ).length;

  return {
    tool: "doc-lifecycle-stats/1",
    label: options.label ?? "(unlabeled)",
    corpus,
    relations: {
      ...corpusRelations,
      inboundTargets: countedArtifacts.size,
      byField: sortedRecord(byField.entries()),
    },
    links: { ...corpusLinks, inboundTargets: inboundLinkTargets },
    findings: {
      ...findingsSummary,
      byRuleId: sortedRecord(byRuleId.entries()),
      byCategory: sortedRecord(byCategory.entries()),
      health,
    },
    types: sortedRecord(
      [...typeStats.entries()].map(([name, stats]) => [
        name,
        { ...stats, statusCounts: sortedRecord(Object.entries(stats.statusCounts)) },
      ]),
    ),
  };
}

export { analyzeCorpus };
// Re-exported for API stability: the canonical definitions now live in
// `doc_repository.ts` alongside the `stale-upstream` rule (Issue #166).
export {
  DEAD_UPSTREAM_STATUSES,
  isSettled,
  lifecycleBucketOf,
  SETTLED_STATUSES,
  staleUpstreamTargets,
  UPSTREAM_FIELDS,
} from "./doc_repository";
export type { CorpusLifecycleStats, RelationResolutionCounts, TypeStats };
