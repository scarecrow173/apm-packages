"use strict";

import fs from "node:fs";
import path from "node:path";
import {
  configFor,
  docFiles,
  parseDoc,
  relationValues,
  resolveDocumentReference,
  validateFrontMatter,
} from "../../../lib/doc_suite_utils";

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
  id: string | null;
  path: string;
  relations: Record<string, string[]>;
};

// Chain-status contract shared with artifact_graph.ts CHAIN_STATUSES.
const SPEC_STATUSES: ReadonlySet<string> = new Set(["proposed", "approved", "implemented"]);
const ADR_STATUSES: ReadonlySet<string> = new Set(["proposed", "accepted"]);

// Mirrors the direct spec<->adr pairing relations in preDesignAnchors
// (doc-driven-dev-graph/scripts/lib/artifact_graph.ts).
const PAIR_RELATIONS: ReadonlySet<string> = new Set(["derives-from", "derived-by", "refines", "refined-by"]);
const DERIVES_FROM: ReadonlySet<string> = new Set(["derives-from"]);
const DERIVED_BY: ReadonlySet<string> = new Set(["derived-by"]);

const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const PLACEHOLDER_MARKER = /TODO|{{[^}]+}}|<!--\s*(option|driver|justification|Describe)/i;

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function isInside(cwd: string, candidate: string): boolean {
  const root = path.resolve(cwd);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function normalizePath(cwd: string, target: string): string {
  return path.relative(path.resolve(cwd), path.resolve(target)).split(path.sep).join("/");
}

// Every non-"changes" front-matter relation key is a candidate link, matching
// the artifact graph's relation extraction (artifact_graph.ts relationValues).
function relationMap(data: Record<string, unknown>): Record<string, string[]> {
  const raw = data.relations;
  const result: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const key of Object.keys(raw as Record<string, unknown>).sort(compareStrings)) {
    if (key === "changes") continue;
    const values = relationValues((raw as Record<string, unknown>)[key]);
    if (values.length > 0) result[key] = values;
  }
  return result;
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
    id: typeof parsed.data.id === "string" ? parsed.data.id : null,
    path: normalizePath(cwd, absolutePath),
    relations: relationMap(parsed.data),
  };
}

function loadDoc(cwd: string, inputPath: string, role: DocRole, findings: BriefingAuditFinding[]): AuditedDoc | null {
  const absolutePath = path.resolve(cwd, inputPath);
  const relativePath = normalizePath(cwd, absolutePath);
  const label = role === "spec" ? "Spec" : "ADR";
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    findings.push({
      severity: "error",
      code: "missing-file",
      file: relativePath,
      message: `${label} file not found: ${relativePath}`,
    });
    return null;
  }
  const content = fs.readFileSync(absolutePath, "utf8");
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

function resolveTarget(cwd: string, owner: AuditedDoc, target: string): string | null {
  const trimmed = target.trim();
  if (EXTERNAL_REFERENCE.test(trimmed)) return null;
  const resolved = resolveDocumentReference(cwd, trimmed, path.dirname(owner.absolutePath));
  if (!resolved || !isInside(cwd, resolved)) return null;
  return path.resolve(resolved);
}

// True when one of owner's `relationNames` values points at `target`, matching
// the graph's id-first-then-path resolution in resolveArtifactRelation.
function referencesDoc(cwd: string, owner: AuditedDoc, relationNames: ReadonlySet<string>, target: AuditedDoc): boolean {
  for (const [field, values] of Object.entries(owner.relations)) {
    if (!relationNames.has(field)) continue;
    for (const value of values) {
      const trimmed = value.trim();
      if (EXTERNAL_REFERENCE.test(trimmed)) continue;
      if (target.id && trimmed === target.id) return true;
      const resolved = resolveTarget(cwd, owner, trimmed);
      if (resolved && resolved === target.absolutePath) return true;
    }
  }
  return false;
}

// Candidate discovery anchors: every type:"discovery" record in the canonical
// discovery directories plus any resolvable derives-from target elsewhere,
// mirroring the record set preDesignAnchors filters over.
function discoveryAnchors(cwd: string, spec: AuditedDoc, adr: AuditedDoc): AuditedDoc[] {
  const candidates = new Map<string, AuditedDoc>();
  const add = (absolutePath: string): void => {
    const resolved = path.resolve(absolutePath);
    if (!isInside(cwd, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return;
    const relativePath = normalizePath(cwd, resolved);
    if (candidates.has(relativePath)) return;
    let content: string;
    try {
      content = fs.readFileSync(resolved, "utf8");
    } catch {
      return;
    }
    const doc = toAuditedDoc(cwd, resolved, content);
    if (doc && doc.data.type === "discovery") candidates.set(relativePath, doc);
  };
  for (const dir of configFor("discovery").dirs) {
    const base = path.join(cwd, dir);
    for (const file of docFiles(base)) add(path.join(base, file));
  }
  for (const artifact of [spec, adr]) {
    for (const value of artifact.relations["derives-from"] ?? []) {
      const resolved = resolveTarget(cwd, artifact, value);
      if (resolved) add(resolved);
    }
  }
  return [...candidates.values()].sort((left, right) => compareStrings(left.path, right.path));
}

// Mirrors preDesignAnchors: consistent when a direct typed lineage relation
// links spec<->adr in either direction, or one discovery record anchors both
// (artifact --derives-from--> discovery or discovery --derived-by--> artifact).
function isPairingConsistent(cwd: string, spec: AuditedDoc, adr: AuditedDoc): boolean {
  if (referencesDoc(cwd, spec, PAIR_RELATIONS, adr) || referencesDoc(cwd, adr, PAIR_RELATIONS, spec)) {
    return true;
  }
  return discoveryAnchors(cwd, spec, adr).some((discovery) =>
    (referencesDoc(cwd, spec, DERIVES_FROM, discovery) || referencesDoc(cwd, discovery, DERIVED_BY, spec))
    && (referencesDoc(cwd, adr, DERIVES_FROM, discovery) || referencesDoc(cwd, discovery, DERIVED_BY, adr)));
}

function auditDocContent(cwd: string, doc: AuditedDoc, role: DocRole, findings: BriefingAuditFinding[]): void {
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
  for (const [field, values] of Object.entries(doc.relations)) {
    for (const target of values) {
      if (EXTERNAL_REFERENCE.test(target.trim())) continue;
      if (!resolveTarget(cwd, doc, target)) {
        findings.push({
          severity: "error",
          code: "broken-relation-link",
          file: doc.path,
          message: `Relation ${field} points to missing target: ${target}`,
        });
      }
    }
  }
}

/** Audit a spec/ADR pair for briefing consistency. Read-only; never writes. */
export function auditBriefingPair(cwd: string, specPath: string, adrPath: string): BriefingAuditReport {
  const root = path.resolve(cwd);
  const findings: BriefingAuditFinding[] = [];
  const spec = loadDoc(root, specPath, "spec", findings);
  if (spec) auditDocContent(root, spec, "spec", findings);
  const adr = loadDoc(root, adrPath, "adr", findings);
  if (adr) auditDocContent(root, adr, "adr", findings);
  if (spec && adr && !isPairingConsistent(root, spec, adr)) {
    findings.push({
      severity: "error",
      code: "inconsistent-pairing",
      file: null,
      message: `Spec ${spec.path} and ADR ${adr.path} share no derives-from/derived-by/refines/refined-by relation or common discovery anchor`,
    });
  }
  return {
    spec: spec?.path ?? null,
    adr: adr?.path ?? null,
    findings,
    consistent: !findings.some((finding) => finding.severity === "error"),
  };
}
