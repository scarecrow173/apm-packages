"use strict";

import { lintScope, scopeFor } from "./doc_lint";
import type { AuditProfile } from "./doc_lint";
import { lintExternalLinks } from "./doc_structure_lint";
import { scopeTypesForQuery } from "./doc_ownership";
import { canonicalDocRoots, compareFindings, lifecycleBucketOf, scanRepository } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import { docDir, docEntries } from "./doc_suite_utils";
import { normalizeDir, resolveContainedDir } from "./document_utils";

type DocStatusQuery = {
  type?: string;
  dir?: string;
  externalLinks?: boolean;
  profile?: AuditProfile;
};

type FindingFilter = {
  rule?: string;
  severity?: string;
  blocking?: boolean;
};

type ProfileGates = {
  ran: string[];
  skipped: string[];
};

type CollectedFindings = {
  model: DocumentRepository;
  types: string[];
  documents: number;
  findings: Finding[];
  profile: AuditProfile;
  gates: ProfileGates;
};

type HealthCategory = {
  category: string;
  blocking: number;
  warnings: number;
  infos: number;
  clean: boolean;
};

type HealthOrphanSummary = {
  total: number;
  byRule: Record<string, number>;
  byType: Record<string, number>;
};

type HealthReport = {
  documents: number;
  blocking: number;
  warnings: number;
  infos: number;
  categories: HealthCategory[];
  orphans: HealthOrphanSummary;
};

const CATEGORY_ORDER = [
  "front-matter",
  "relation",
  "traceability",
  "provenance",
  "link",
  "index",
  "orphan",
  "structure",
];

// Check-group names reported in the lint/audit/health output envelopes — the
// names are stable and JSON-visible, so consumers can tell which evaluation
// surface a run covered. `artifact` runs the canonical-document gates;
// `materialized` adds the managed-index gates on top (Issue #195).
const ARTIFACT_GATES = [
  "front-matter",
  "relations",
  "directory-required-files",
  "links",
  "orphan-navigation",
  "orphan-relation",
  "provenance",
  "traceability",
] as const;

const MATERIALIZED_ONLY_GATES = [
  "index-presence",
  "index-membership",
  "index-consistency",
  "orphan-index-membership",
] as const;

function profileGates(profile: AuditProfile): ProfileGates {
  return profile === "artifact"
    ? { ran: [...ARTIFACT_GATES], skipped: [...MATERIALIZED_ONLY_GATES] }
    : { ran: [...ARTIFACT_GATES, ...MATERIALIZED_ONLY_GATES], skipped: [] };
}

function scanRoots(relativeDirs: string[]): string[] {
  return [...new Set(["docs", ...relativeDirs, ...canonicalDocRoots()].map((dir) => normalizeDir(dir)))];
}

function resolveQueryScope(cwd: string, query: { type?: string; dir?: string }): { types: string[]; explicitDir: string | null } {
  const explicitDir = query.dir ? resolveContainedDir(cwd, query.dir) : null;
  return { types: scopeTypesForQuery(explicitDir, query.type), explicitDir };
}

async function collectFindings(cwd: string, query: DocStatusQuery): Promise<CollectedFindings> {
  const { types, explicitDir } = resolveQueryScope(cwd, query);
  const profile = query.profile ?? "materialized";
  const relativeDirs = types.map((type) => explicitDir ?? docDir(cwd, type));
  const model = await scanRepository({ cwd, roots: scanRoots(relativeDirs) });
  const findings: Finding[] = [];
  let documents = 0;
  for (const type of types) {
    const directory = explicitDir ?? docDir(cwd, type);
    const scope = scopeFor(model, type, directory);
    documents += scope.documents.length;
    findings.push(...lintScope(model, type, directory, profile));
    if (query.externalLinks) {
      findings.push(...await lintExternalLinks(model, scope));
    }
  }
  // A shared directory hosts multiple document types, so overlapping scopes
  // can emit identical findings; collapse them before reporting.
  const seen = new Set<string>();
  const deduped = findings.filter((finding) => {
    const key = `${finding.ruleId}${finding.path}${finding.line}${finding.target}${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort(compareFindings);
  return { model, types, documents, findings: deduped, profile, gates: profileGates(profile) };
}

function filterFindings(findings: Finding[], filter: FindingFilter): Finding[] {
  return findings.filter((finding) => {
    if (filter.rule && finding.ruleId !== filter.rule) return false;
    if (filter.severity && finding.severity !== filter.severity) return false;
    if (filter.blocking !== undefined && finding.blocking !== filter.blocking) return false;
    return true;
  });
}

function summarizeHealth(collected: CollectedFindings, findings: Finding[]): HealthReport {
  const byCategory = new Map<string, HealthCategory>();
  const bucketFor = (category: string): HealthCategory => {
    const existing = byCategory.get(category);
    if (existing) return existing;
    const created: HealthCategory = { category, blocking: 0, warnings: 0, infos: 0, clean: false };
    byCategory.set(category, created);
    return created;
  };

  let blocking = 0;
  let warnings = 0;
  let infos = 0;
  for (const finding of findings) {
    const bucket = bucketFor(finding.category);
    if (finding.blocking) {
      blocking += 1;
      bucket.blocking += 1;
    } else if (finding.severity === "info") {
      infos += 1;
      bucket.infos += 1;
    } else {
      warnings += 1;
      bucket.warnings += 1;
    }
  }

  const known = CATEGORY_ORDER.filter((category) => byCategory.has(category));
  const extras = [...byCategory.keys()].filter((category) => !CATEGORY_ORDER.includes(category)).sort();
  const categories = [...known, ...extras].map((category) => {
    const bucket = byCategory.get(category) as HealthCategory;
    bucket.clean = bucket.blocking === 0 && bucket.warnings === 0 && bucket.infos === 0;
    return bucket;
  });

  // Orphan roll-up (Issue #162 B3): the per-document `orphan-*` findings stay
  // the diagnostic detail, but health consumers get the capture-layer
  // linked-ness signal as one aggregate — total orphans, split per rule
  // (index / navigation / relation) and per lifecycle bucket.
  const orphans: HealthOrphanSummary = { total: 0, byRule: {}, byType: {} };
  for (const item of findings) {
    if (item.category !== "orphan") continue;
    orphans.total += 1;
    orphans.byRule[item.ruleId] = (orphans.byRule[item.ruleId] ?? 0) + 1;
    const member = item.path ? collected.model.byPath.get(item.path) : undefined;
    const bucket = member ? lifecycleBucketOf(member) : "unattributed";
    orphans.byType[bucket] = (orphans.byType[bucket] ?? 0) + 1;
  }
  return { documents: collected.documents, blocking, warnings, infos, categories, orphans };
}

async function listDocuments(cwd: string, query: { type?: string; dir?: string; status?: string }) {
  const { types, explicitDir } = resolveQueryScope(cwd, query);
  const groups: { type: string; directory: string; entries: Awaited<ReturnType<typeof docEntries>> }[] = [];
  for (const type of types) {
    const directory = explicitDir ?? docDir(cwd, type);
    const entries = (await docEntries(cwd, type, directory))
      .filter((entry) => !query.status || entry.status === query.status);
    groups.push({ type, directory, entries });
  }
  return groups;
}

export {
  ARTIFACT_GATES,
  collectFindings,
  docDir,
  filterFindings,
  listDocuments,
  MATERIALIZED_ONLY_GATES,
  profileGates,
  summarizeHealth,
};
export type { AuditProfile, CollectedFindings, DocStatusQuery, FindingFilter, HealthCategory, HealthOrphanSummary, HealthReport, ProfileGates };
