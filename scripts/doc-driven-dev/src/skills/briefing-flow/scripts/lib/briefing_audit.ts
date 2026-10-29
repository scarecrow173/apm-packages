"use strict";

import fs from "node:fs";
import path from "node:path";
import {
  parseDoc,
  validateFrontMatter,
} from "../../../lib/doc_suite_utils";
import { markdownDestinations } from "../../../adr-doc/scripts/lib/adr_utils";
import {
  artifactChainCandidates,
  isExternalArtifactReference,
  localTarget,
  resolveArtifactRelation,
  scanArtifactGraph,
  type ArtifactRecord,
} from "../../../doc-driven-dev-graph/scripts/lib/artifact_graph";

export type BriefingAuditFinding = {
  severity: "error" | "warning" | "info";
  code: string;
  file: string | null;
  message: string;
};

export type BriefingAuditReport = {
  spec: string | null;
  adr: string | null;
  findings: BriefingAuditFinding[];
  consistent: boolean;
};

type DocRole = "spec" | "adr";

type AuditedDoc = {
  absolutePath: string;
  body: string;
  content: string;
  data: Record<string, unknown>;
  path: string;
};

// Chain-status contract shared with artifact_graph.ts CHAIN_STATUSES.
const SPEC_STATUSES: ReadonlySet<string> = new Set(["proposed", "approved", "implemented"]);
const ADR_STATUSES: ReadonlySet<string> = new Set(["proposed", "accepted"]);

const PLACEHOLDER_MARKER = /TODO|{{[^}]+}}|<!--\s*(option|driver|justification|Describe)/i;

function isInside(cwd: string, candidate: string): boolean {
  const root = path.resolve(cwd);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function normalizePath(cwd: string, target: string): string {
  return path.relative(path.resolve(cwd), path.resolve(target)).split(path.sep).join("/");
}

// Verbatim port of sectionBody/consideredOptionCount from
// doc-driven-dev-graph/scripts/lib/graph_state.ts so option counting cannot drift.
function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
  if (start < 0) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const section = endOffset < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + endOffset);
  return section.join("\n").trim();
}

function consideredOptionCount(body: string): number {
  const section = sectionBody(body, "Considered Options");
  if (!section) return 0;
  const headings = section.match(/^###\s+.+$/gim)?.length ?? 0;
  const listItems = section.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  return Math.max(headings, listItems);
}

function acceptanceCriterionCount(body: string): number {
  const section = sectionBody(body, "Acceptance Criteria");
  if (!section) return 0;
  return section.match(/^\s*(?:[-*+]|\d+\.)\s+\S/gm)?.length ?? 0;
}

function toAuditedDoc(cwd: string, absolutePath: string, content: string): AuditedDoc | null {
  const parsed = parseDoc(content);
  if (parsed.error) return null;
  return {
    absolutePath: path.resolve(absolutePath),
    body: parsed.body,
    content,
    data: parsed.data,
    path: normalizePath(cwd, absolutePath),
  };
}

function loadDoc(cwd: string, inputPath: string, role: DocRole, findings: BriefingAuditFinding[]): AuditedDoc | null {
  const absolutePath = path.resolve(cwd, inputPath);
  const relativePath = normalizePath(cwd, absolutePath);
  const label = role === "spec" ? "Spec" : "ADR";
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, "utf8");
  } catch {
    findings.push({
      severity: "error",
      code: "missing-file",
      file: relativePath,
      message: `${label} file not found: ${relativePath}`,
    });
    return null;
  }
  const doc = toAuditedDoc(cwd, absolutePath, content);
  if (!doc) {
    const parsed = parseDoc(content);
    findings.push({
      severity: "error",
      code: "unparseable-front-matter",
      file: relativePath,
      message: `Front matter is not valid YAML: ${parsed.error ?? "unknown parse error"}`,
    });
    return null;
  }
  return doc;
}

async function auditDocContent(cwd: string, doc: AuditedDoc, role: DocRole, findings: BriefingAuditFinding[]): Promise<void> {
  for (const issue of validateFrontMatter(doc.content)) {
    findings.push({
      severity: "error",
      code: "invalid-front-matter",
      file: doc.path,
      message: `Invalid front matter ${issue.path}: ${issue.message}`,
    });
  }
  if (doc.data.type !== role) {
    findings.push({
      severity: "error",
      code: `${role}-type`,
      file: doc.path,
      message: `Expected type "${role}", found "${typeof doc.data.type === "string" ? doc.data.type : "(missing)"}"`,
    });
  }
  const status = typeof doc.data.status === "string" ? doc.data.status : "";
  const allowed = role === "spec" ? SPEC_STATUSES : ADR_STATUSES;
  if (!allowed.has(status)) {
    findings.push({
      severity: "error",
      code: `${role}-status`,
      file: doc.path,
      message: `Invalid ${role} status "${status || "(missing)"}" (expected one of: ${[...allowed].join(", ")})`,
    });
  }
  if (role === "spec" && acceptanceCriterionCount(doc.body) < 1) {
    findings.push({
      severity: "error",
      code: "spec-acceptance-criteria",
      file: doc.path,
      message: 'Expected "## Acceptance Criteria" with at least one list item',
    });
  }
  if (role === "adr" && consideredOptionCount(doc.body) < 2) {
    findings.push({
      severity: "error",
      code: "adr-considered-options",
      file: doc.path,
      message: 'Expected "## Considered Options" with at least two options',
    });
  }
  if (PLACEHOLDER_MARKER.test(doc.content)) {
    findings.push({
      severity: "warning",
      code: "unresolved-placeholder",
      file: doc.path,
      message: "Contains unresolved placeholders",
    });
  }
  for (const url of await markdownDestinations(doc.content)) {
    if (isExternalArtifactReference(url) || url.startsWith("#")) continue;
    const pathname = url.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      findings.push({ severity: "error", code: "broken-local-link", file: doc.path, message: `Invalid local link: ${url}` });
      continue;
    }
    const target = path.resolve(path.dirname(doc.absolutePath), decoded);
    if (!isInside(cwd, target) || !fs.existsSync(target)) {
      findings.push({ severity: "error", code: "broken-local-link", file: doc.path, message: `Broken local link: ${url}` });
    }
  }
}

/** Audit a spec/ADR pair for briefing consistency. Read-only; never writes. */
export async function auditBriefingPair(cwd: string, specPath: string, adrPath: string): Promise<BriefingAuditReport> {
  const root = path.resolve(cwd);
  const findings: BriefingAuditFinding[] = [];
  const spec = loadDoc(root, specPath, "spec", findings);
  if (spec) await auditDocContent(root, spec, "spec", findings);
  const adr = loadDoc(root, adrPath, "adr", findings);
  if (adr) await auditDocContent(root, adr, "adr", findings);
  const { graph, records } = scanArtifactGraph({ cwd: root });
  const candidates = spec && adr
    ? artifactChainCandidates(graph, records).filter((chain) => chain.spec === spec.path && chain.adr === adr.path)
    : [];
  if (spec && adr && candidates.length !== 1) {
    findings.push({
      severity: "error",
      code: "inconsistent-pairing",
      file: null,
      message: `Spec ${spec.path} and ADR ${adr.path} must belong to one unambiguous typed artifact chain`,
    });
  }
  const chain = candidates.length === 1 ? candidates[0] : undefined;
  const relevant = new Set([spec?.path, adr?.path, chain?.design, chain?.plan, ...(chain?.anchors ?? [])]);
  for (const doc of [spec, adr]) {
    if (doc && !records.some((record) => record.path === doc.path)) {
      findings.push({ severity: "error", code: "noncanonical-artifact", file: doc.path, message: "Document is not in the artifact graph's canonical record set" });
    }
  }
  for (const record of records.filter((item) => relevant.has(item.path))) {
    auditRelations(root, record, records, findings);
  }
  return {
    spec: spec?.path ?? null,
    adr: adr?.path ?? null,
    findings,
    consistent: !findings.some((finding) => finding.severity === "error"),
  };
}

function auditRelations(cwd: string, record: ArtifactRecord, records: ArtifactRecord[], findings: BriefingAuditFinding[]): void {
  if (record.id && records.filter((other) => other.id === record.id).length > 1) {
    findings.push({ severity: "error", code: "duplicate-id", file: record.path, message: `Duplicate artifact ID: ${record.id}` });
  }
  for (const issue of record.relationIssues) {
    findings.push({ severity: "error", code: "invalid-relation", file: record.path, message: issue });
  }
  for (const [field, values] of Object.entries(record.relations)) {
    for (const value of values) {
      if (isExternalArtifactReference(value)) continue;
      const matches = records.filter((other) => other.id === value);
      const target = resolveArtifactRelation(cwd, record, value, records);
      if (matches.length > 1 || (!target && !localTarget(cwd, record, value).exists)) {
        findings.push({ severity: "error", code: "broken-relation-link", file: record.path, message: `Relation ${field} has an unresolved or ambiguous target: ${value}` });
      } else if (target?.id && records.filter((other) => other.id === target.id).length > 1) {
        findings.push({ severity: "error", code: "duplicate-id", file: record.path, message: `Relation ${field} targets duplicate artifact ID: ${target.id}` });
      }
    }
  }
}
