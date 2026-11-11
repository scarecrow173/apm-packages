"use strict";

import fs from "node:fs";
import path from "node:path";

import { lintLegacyIdReferences, lintScope, scopeFor } from "./doc_lint";
import { profileGates } from "./doc_report";
import type { AuditProfile, ProfileGates } from "./doc_report";
import { lintExternalLinks } from "./doc_structure_lint";
import { scopeTypesForQuery } from "./doc_ownership";
import { canonicalDocRoots, compareFindings, scanRepository } from "./doc_repository";
import type { DocumentRepository, Finding } from "./doc_repository";
import { docDir, docFiles } from "./doc_suite_utils";
import { isInsideRealpath, normalizeDir, resolveContainedDir } from "./document_utils";

type AuditFinding = {
  severity: string;
  file: string | null;
  code: string;
  message: string;
  blocking: boolean;
};

type AuditReport = {
  directory: string;
  files: number;
  findings: AuditFinding[];
  profile: AuditProfile;
  gates: ProfileGates;
};

type AuditOptions = {
  externalLinks?: boolean;
  profile?: AuditProfile;
};

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
    blocking: finding.blocking,
  };
}

async function buildModel(cwd: string, relativeDirs: string[]): Promise<DocumentRepository> {
  return scanRepository({ cwd, roots: scanRoots(relativeDirs) });
}

// A symlinked doc dir escaping the repository is treated as absent: file
// listing must not follow it and count outside documents it never audited.
// The shared realpath containment check fails closed (Issue #156).
async function auditWithModel(
  model: DocumentRepository,
  cwd: string,
  type: string,
  explicitDir?: string,
  options?: AuditOptions,
): Promise<AuditReport> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const fullDir = path.join(cwd, relativeDir);
  const files = fs.existsSync(fullDir) && isInsideRealpath(cwd, fullDir) ? docFiles(fullDir) : [];
  const profile = options?.profile ?? "materialized";
  const findings = lintScope(model, type, relativeDir, profile);
  if (options?.externalLinks) {
    findings.push(...await lintExternalLinks(model, scopeFor(model, type, relativeDir)));
    findings.sort(compareFindings);
  }
  const legacy = findings.map((finding) => toLegacyFinding(relativeDir, finding));
  return { directory: relativeDir, files: files.length, findings: legacy, profile, gates: profileGates(profile) };
}

async function auditDocuments(cwd: string, type: string, explicitDir?: string, options?: AuditOptions): Promise<AuditReport> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const model = await buildModel(cwd, [relativeDir]);
  return auditWithModel(model, cwd, type, explicitDir, options);
}

// Distributed agent-facing docs (.apm skill documents) carry the same
// artifact references the migrator rewrites, so the --type all legacy-token
// sweep needs them in the model to catch re-introduced legacy ids. Root
// containment by real path is enforced inside scanRepository.
function distributionDocRoots(cwd: string): string[] {
  const candidates = [".apm"];
  const packagesDir = path.join(cwd, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`packages/${entry.name}/.apm`);
    }
  }
  return candidates.filter((candidate) => {
    const full = path.join(cwd, candidate);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  });
}

async function auditAllDocuments(cwd: string, explicitDir?: string, options?: AuditOptions): Promise<AuditReport> {
  const normalizedDir = explicitDir ? resolveContainedDir(cwd, explicitDir) : null;
  const types = scopeTypesForQuery(normalizedDir, "all");
  const relativeDirs = types.map((type) => normalizedDir ?? docDir(cwd, type));
  const model = await buildModel(cwd, [...relativeDirs, ...distributionDocRoots(cwd)]);
  const profile = options?.profile ?? "materialized";
  const merged: AuditReport = { directory: ".", files: 0, findings: [], profile, gates: profileGates(profile) };
  for (const type of types) {
    const report = await auditWithModel(model, cwd, type, normalizedDir ?? undefined, options);
    merged.files += report.files;
    for (const finding of report.findings) {
      merged.findings.push({
        ...finding,
        file: finding.file ? `${report.directory}/${finding.file}` : report.directory,
      });
    }
  }
  // Per-type scopes cover every file under a canonical directory but stop at
  // unmanaged roots (AGENTS.md, indexes, misplaced docs); the legacy-token
  // sweep still checks them because they carry the same artifact references.
  const covered = new Set<string>();
  for (const type of types) {
    for (const file of scopeFor(model, type, normalizedDir ?? docDir(cwd, type)).files) {
      covered.add(file.path);
    }
  }
  const uncovered = model.files.filter((file) => !covered.has(file.path));
  for (const finding of lintLegacyIdReferences(model, uncovered)) {
    merged.findings.push({
      severity: finding.severity,
      file: finding.path,
      code: finding.ruleId,
      message: finding.message,
      blocking: finding.blocking,
    });
  }
  const seenFindings = new Set<string>();
  merged.findings = merged.findings.filter((finding) => {
    const key = `${finding.code}${finding.file}${finding.message}`;
    if (seenFindings.has(key)) return false;
    seenFindings.add(key);
    return true;
  });
  return merged;
}

export { auditAllDocuments, auditDocuments };
export type { AuditFinding, AuditOptions, AuditReport };
