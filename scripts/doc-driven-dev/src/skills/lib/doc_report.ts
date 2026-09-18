"use strict";

import { lintScope, scopeFor } from "./doc_lint";
import { lintExternalLinks } from "./doc_structure_lint";
import { canonicalDocRoots, compareFindings, scanRepository } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import { configFor, docEntries, docTypes } from "./doc_suite_utils";
import { findDocumentDir, normalizeDir } from "./document_utils";

type DocStatusQuery = {
  type?: string;
  dir?: string;
  externalLinks?: boolean;
};

type FindingFilter = {
  rule?: string;
  severity?: string;
  blocking?: boolean;
};

type CollectedFindings = {
  model: DocumentRepository;
  types: string[];
  documents: number;
  findings: Finding[];
};

type HealthCategory = {
  category: string;
  blocking: number;
  warnings: number;
  infos: number;
  clean: boolean;
};

type HealthReport = {
  documents: number;
  blocking: number;
  warnings: number;
  infos: number;
  categories: HealthCategory[];
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

function docDir(cwd: string, type: string, explicitDir?: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, explicitDir, config.dirs, config.dir);
}

function scanRoots(relativeDirs: string[]): string[] {
  return [...new Set(["docs", ...relativeDirs, ...canonicalDocRoots()].map((dir) => normalizeDir(dir)))];
}

function resolveTypes(type?: string): string[] {
  if (!type || type === "all") return [...docTypes];
  configFor(type);
  return [type];
}

async function collectFindings(cwd: string, query: DocStatusQuery): Promise<CollectedFindings> {
  const types = resolveTypes(query.type);
  const relativeDirs = types.map((type) => docDir(cwd, type, query.dir));
  const model = await scanRepository({ cwd, roots: scanRoots(relativeDirs) });
  const findings: Finding[] = [];
  let documents = 0;
  for (const type of types) {
    const directory = docDir(cwd, type, query.dir);
    const scope = scopeFor(model, type, directory);
    documents += scope.documents.length;
    findings.push(...lintScope(model, type, directory));
    if (query.externalLinks) {
      findings.push(...await lintExternalLinks(model, scope));
    }
  }
  findings.sort(compareFindings);
  return { model, types, documents, findings };
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
  return { documents: collected.documents, blocking, warnings, infos, categories };
}

async function listDocuments(cwd: string, query: { type?: string; dir?: string; status?: string }) {
  const types = resolveTypes(query.type);
  const groups: { type: string; directory: string; entries: Awaited<ReturnType<typeof docEntries>> }[] = [];
  for (const type of types) {
    const directory = docDir(cwd, type, query.dir);
    const entries = (await docEntries(cwd, type, query.dir))
      .filter((entry) => !query.status || entry.status === query.status);
    groups.push({ type, directory, entries });
  }
  return groups;
}

export { collectFindings, docDir, filterFindings, listDocuments, summarizeHealth };
export type { CollectedFindings, DocStatusQuery, FindingFilter, HealthCategory, HealthReport };
