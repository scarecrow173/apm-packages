"use strict";

import { auditExperimentLogs, auditImplementationRecords, implDir } from "../../../impl-doc/scripts/lib/impl_doc_utils";
import type { OwnerAuditSummary } from "../../lib/doc_audit";

// Package-wide audit aggregation (Issue #189): invoke the owner-authoritative
// audits for impl-doc's owned directories instead of duplicating their
// parsers. Owner findings carry no blocking flag; severity "error" projects
// to blocking=true so the merged report keeps gate semantics consistent.
// Owner file paths are reported repo-relative (<dir>/<file>) like the
// --type all merge in auditAllDocuments.
const OWNER_AUDITS: ReadonlyArray<{
  name: string;
  run: (cwd: string) => { directory: string; files: number; findings: { code: string; file: string | null; line?: number; message: string; severity: string }[] };
}> = [
  { name: "impl-record", run: (cwd) => auditImplementationRecords(cwd, implDir(cwd, "ir")) },
  { name: "experiment-log", run: (cwd) => auditExperimentLogs(cwd, implDir(cwd, "exp")) },
];

function collectOwnerAudits(cwd: string): OwnerAuditSummary[] {
  return OWNER_AUDITS.map(({ name, run }) => {
    const report = run(cwd);
    return {
      name,
      directory: report.directory,
      files: report.files,
      findings: report.findings.map((finding) => ({
        severity: finding.severity,
        file: finding.file ? `${report.directory}/${finding.file}` : report.directory,
        line: finding.line,
        code: finding.code,
        message: finding.message,
        blocking: finding.severity === "error",
      })),
    };
  });
}

export { collectOwnerAudits };
