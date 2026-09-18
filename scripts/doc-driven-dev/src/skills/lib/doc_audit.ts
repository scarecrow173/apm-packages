"use strict";

import path from "node:path";

import { lintScope, scopeFor } from "./doc_lint";
import { lintExternalLinks } from "./doc_structure_lint";
import { canonicalDocRoots, compareFindings, scanRepository } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import { configFor, docFiles, docTypes } from "./doc_suite_utils";
import { findDocumentDir, normalizeDir } from "./document_utils";

type AuditFinding = {
  severity: string;
  file: string | null;
  code: string;
  message: string;
};

type AuditReport = {
  directory: string;
  files: number;
  findings: AuditFinding[];
};

type AuditOptions = {
  externalLinks?: boolean;
};

function docDir(cwd: string, type: string, explicitDir?: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, explicitDir, config.dirs, config.dir);
}

function scanRoots(relativeDirs: string[]): string[] {
  return [...new Set(["docs", ...relativeDirs, ...canonicalDocRoots()].map((dir) => normalizeDir(dir)))];
}

function toLegacyFinding(directory: string, finding: Finding): AuditFinding {
  const file = finding.path
    ? path.posix.relative(normalizeDir(directory), finding.path) || path.posix.basename(finding.path)
    : null;
  return {
    severity: finding.severity,
    file,
    code: finding.ruleId,
    message: finding.message,
  };
}

async function buildModel(cwd: string, relativeDirs: string[]): Promise<DocumentRepository> {
  return scanRepository({ cwd, roots: scanRoots(relativeDirs) });
}

async function auditWithModel(
  model: DocumentRepository,
  cwd: string,
  type: string,
  explicitDir?: string,
  options?: AuditOptions,
): Promise<AuditReport> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const files = docFiles(path.join(cwd, relativeDir));
  const findings = lintScope(model, type, relativeDir);
  if (options?.externalLinks) {
    findings.push(...await lintExternalLinks(model, scopeFor(model, type, relativeDir)));
    findings.sort(compareFindings);
  }
  const legacy = findings.map((finding) => toLegacyFinding(relativeDir, finding));
  return { directory: relativeDir, files: files.length, findings: legacy };
}

async function auditDocuments(cwd: string, type: string, explicitDir?: string, options?: AuditOptions): Promise<AuditReport> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const model = await buildModel(cwd, [relativeDir]);
  return auditWithModel(model, cwd, type, explicitDir, options);
}

async function auditAllDocuments(cwd: string, explicitDir?: string, options?: AuditOptions): Promise<AuditReport> {
  const relativeDirs = docTypes.map((type) => docDir(cwd, type, explicitDir));
  const model = await buildModel(cwd, relativeDirs);
  const merged: AuditReport = { directory: ".", files: 0, findings: [] };
  for (const type of docTypes) {
    const report = await auditWithModel(model, cwd, type, explicitDir, options);
    merged.files += report.files;
    for (const finding of report.findings) {
      merged.findings.push({
        ...finding,
        file: finding.file ? `${report.directory}/${finding.file}` : report.directory,
      });
    }
  }
  return merged;
}

export { auditAllDocuments, auditDocuments };
export type { AuditFinding, AuditOptions, AuditReport };
