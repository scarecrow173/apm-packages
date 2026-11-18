"use strict";

// ---------------------------------------------------------------------------
// Knowledge consolidation contract (Issue #242)
// ---------------------------------------------------------------------------
//
// Durable knowledge is consolidated, never accreted: before a finding becomes
// a new document, the corpus is screened for an existing record the finding
// should update, supersede, or route to (existing Spec / Design / ADR /
// Knowledge first — new Knowledge only when nothing existing can carry it,
// and "save nothing" is an explicit, valid decision).
//
// This module owns the deterministic half of that contract:
//
//   assess   — read-only screening of a candidate finding against every
//              durable document directory. Candidates are reported with the
//              route the consolidation contract assigns them: `integrate`
//              for existing knowledge documents, or the owning skill name
//              for other durable types (consolidation never writes a
//              spec/design/ADR itself — the responsibility boundary).
//              Overlapping non-settled knowledge records are `conflicts`:
//              a create decision must acknowledge each of them explicitly —
//              semantic duplicates/contradictions are reviewed, never added
//              unconditionally.
//   integrate— record an integration into an existing knowledge document:
//              provenance (原典) lands in `relations.source`, the basis
//              (根拠) lands as a dated entry in the Source/Provenance
//              section, `updated` bumps, status/relations stay registry-
//              validated. Targets that are not knowledge documents are
//              refused — their changes belong to their owning skills.
//
// The judgment of *what is worth persisting* (the extraction criteria —
// why-designed-so, recurrence prevention, confirmed constraints and
// properties; never timelines, command logs, or chat-like work records) is
// the skill contract documented in references/knowledge-extraction.md; the
// CLI enforces the bookkeeping side of it.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import {
  configFor,
  docTypes,
  isDurableType,
  settledStatusesFor,
} from "../../../lib/doc_types";
import {
  docFiles,
  parseDoc,
  resolveDocumentReference,
} from "../../../lib/doc_suite_utils";
import {
  isIndexFileName,
  isInsideCheckout,
  normalizeDir,
} from "../../../lib/document_utils";

// ---------------------------------------------------------------------------
// Assessment (read-only screening)
// ---------------------------------------------------------------------------

// The skill that owns consolidation decisions for each durable type —
// the `route` a non-knowledge candidate reports. Consolidation never
// writes through these owners; it names where the change belongs.
const ROUTE_SKILLS: Readonly<Record<string, string>> = {
  idea: "idea-doc",
  brainstorm: "briefing-flow",
  discovery: "discovery-doc",
  spec: "spec-doc",
  design: "design-doc",
  adr: "adr-doc",
  knowledge: "integrate",
  verification: "verification-doc",
};

const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are", "was",
  "were", "has", "have", "had", "not", "but", "all", "can", "its",
]);

// Lexical screening tokens — a heuristic surface for human review, not a
// semantic proof: runs of ≥3 letters/numbers, lowercased, stop words out.
function tokenizeQuery(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const token = match[0];
    if (!STOP_WORDS.has(token)) tokens.add(token);
  }
  return [...tokens].sort();
}

type ConsolidationCandidate = {
  id: string | null;
  type: string;
  path: string;
  title: string;
  status: string | null;
  lifecycle: string | null;
  knowledgeKind: string | null;
  matchedTokens: string[];
  score: number;
  settled: boolean;
  // `integrate` for knowledge documents; the owning skill name for every
  // other durable type (the responsibility boundary — consolidation reports
  // the route, the owning skill writes).
  route: string;
  conflict: boolean;
};

type ConsolidationAssessment = {
  title: string;
  kind: string | null;
  keywords: string[];
  candidates: ConsolidationCandidate[];
  conflicts: ConsolidationCandidate[];
  // `review-required` while conflicts are unacknowledged — the signal a
  // run's exit gate is told about; `clear` when nothing blocks a decision.
  gate: "clear" | "review-required";
};

function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isSettledDoc(type: string, status: string | null, lifecycle: string | null): boolean {
  if (lifecycle === "superseded" || lifecycle === "retired") return true;
  return status !== null && settledStatusesFor(type).includes(status);
}

function assessConsolidation(
  cwd: string,
  input: { title: string; keywords?: string[]; kind?: string },
): ConsolidationAssessment {
  const queryTokens = new Set(tokenizeQuery(`${input.title} ${(input.keywords ?? []).join(" ")}`));
  const candidates: ConsolidationCandidate[] = [];
  const normalizedTitle = normalizeTitle(input.title);

  // Each physical dir is scanned exactly once — several durable types can
  // share a canonical dir (brainstorm is co-resident with discovery in
  // `docs/discovery`), so iterating per type would report one document
  // under every resident type. A shared dir's fallback owner is its
  // index-primary type, else the first claimant in registry order — the
  // same ownership rule the scaffold/index contract uses.
  const dirOwners = new Map<string, string>();
  for (const type of docTypes) {
    const config = configFor(type);
    for (const dirName of config.dirs.map((dir) => normalizeDir(dir))) {
      const existing = dirOwners.get(dirName);
      if (!existing || config.indexPrimary) dirOwners.set(dirName, type);
    }
  }

  const seen = new Set<string>();
  for (const [dirName, ownerType] of dirOwners) {
    const absDir = path.join(cwd, dirName);
    for (const file of docFiles(absDir)) {
      if (isIndexFileName(path.basename(file))) continue;
      const fullPath = path.join(absDir, file);
      const relative = `${dirName}/${file}`;
      if (seen.has(relative)) continue;
      seen.add(relative);
      const parsed = parseDoc(fs.readFileSync(fullPath, "utf8"));
      const data = parsed.error ? {} : parsed.data;
      const title = typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : path.basename(file, ".md");
      const haystack = `${title} ${path.basename(file, ".md")}`;
      const docTokens = new Set(tokenizeQuery(haystack));
      const matchedTokens = [...queryTokens].filter((token) => docTokens.has(token));
      if (matchedTokens.length === 0 && normalizeTitle(title) !== normalizedTitle) continue;
      const status = typeof data.status === "string" ? data.status : null;
      const lifecycle = typeof data.lifecycle === "string" ? data.lifecycle : null;
      const knowledgeKind = typeof data.knowledge_kind === "string" ? data.knowledge_kind : null;
      // A document is judged as what it declares itself to be — `type`,
      // `route`, `settled`, and `conflict` all key on the document's own
      // `data.type`, never on every type its dir happens to host. Front
      // matter that names no durable type falls back to the dir's owner.
      const type = typeof data.type === "string" && isDurableType(data.type)
        ? data.type
        : ownerType;
      const settled = isSettledDoc(type, status, lifecycle);
      const sameKind = Boolean(input.kind) && knowledgeKind === input.kind;
      const score = matchedTokens.length + (sameKind ? 1 : 0);
      // A non-settled knowledge record that shares the kind plus any term,
      // shares two or more terms, or carries the same title is a potential
      // duplicate/contradiction: create must acknowledge it explicitly.
      const conflict = type === "knowledge" && !settled
        && (score >= 2 || normalizeTitle(title) === normalizedTitle);
      candidates.push({
        id: typeof data.id === "string" ? data.id : null,
        type,
        path: relative,
        title,
        status,
        lifecycle,
        knowledgeKind,
        matchedTokens,
        score,
        settled,
        route: ROUTE_SKILLS[type] ?? `${type}-owner`,
        conflict,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const conflicts = candidates.filter((candidate) => candidate.conflict);
  return {
    title: input.title,
    kind: input.kind ?? null,
    keywords: input.keywords ?? [],
    candidates,
    conflicts,
    gate: conflicts.length > 0 ? "review-required" : "clear",
  };
}

// ---------------------------------------------------------------------------
// Integration (mutating an existing knowledge document)
// ---------------------------------------------------------------------------

// The provenance entry appended under the document's Source/Provenance
// section on every recorded integration — date, basis (根拠), and the
// source references (原典) the front-matter `relations.source` unions.
function provenanceEntry(date: string, basis: string, sources: string[], note?: string): string {
  const parts = [`- ${date} — ${basis.trim()}`];
  if (sources.length > 0) parts.push(`(source: ${sources.join("; ")})`);
  if (note?.trim()) parts.push(`— ${note.trim()}`);
  return parts.join(" ");
}

// Section headings that carry provenance entries — the canonical `Source`
// heading the shipped templates emit (EN) and its localized spellings plus
// `Provenance` (the fallback body template's spelling). A document with no
// accepted heading gains a new `## Provenance` section at the end.
const PROVENANCE_HEADING = /^##\s+(source|provenance|出処)\s*$/i;

function appendProvenanceEntry(body: string, entry: string): string {
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((line) => PROVENANCE_HEADING.test(line.trimEnd()));
  if (headingIndex < 0) {
    return `${body.trimEnd()}\n\n## Provenance\n\n${entry}\n`;
  }
  // Insert at the end of the section — before the next `##` heading or EOF.
  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const section = lines.slice(headingIndex + 1, end);
  // Trim trailing blank lines, append the entry, keep surrounding spacing.
  let last = section.length;
  while (last > 0 && section[last - 1].trim() === "") last -= 1;
  const next = [
    ...lines.slice(0, headingIndex + 1),
    ...section.slice(0, last),
    entry,
    ...lines.slice(end),
  ];
  return next.join("\n");
}

type KnowledgeTarget = {
  relative: string;
  resolved: string;
  data: Record<string, unknown>;
  body: string;
};

// Resolve a document reference to an existing knowledge document — the only
// type consolidation may mutate. The Spec/ADR/design responsibility
// boundary: every other durable type routes to its owning skill (`assess`
// reports the route; `apply --decision route` names it) — a knowledge
// mutator never writes their documents.
function resolveKnowledgeTarget(cwd: string, reference: string, role = "target"): KnowledgeTarget {
  const knowledgeDir = path.join(cwd, configFor("knowledge").dir);
  const resolved = resolveDocumentReference(cwd, reference, knowledgeDir);
  if (!resolved) {
    throw new Error(`Knowledge ${role} does not resolve to a document: ${reference}`);
  }
  if (!isInsideCheckout(cwd, resolved)) {
    throw new Error(`Knowledge ${role} escapes the checkout: ${reference}`);
  }
  const relative = path.relative(cwd, resolved).replace(/\\/g, "/");
  const parsed = parseDoc(fs.readFileSync(resolved, "utf8"));
  if (parsed.error) {
    throw new Error(`Knowledge ${role} has unparseable front matter: ${relative}`);
  }
  const data = parsed.data;
  if (data.type !== "knowledge") {
    const owner = typeof data.type === "string" ? ROUTE_SKILLS[data.type] ?? "its owning skill" : "its owning skill";
    throw new Error(
      `Knowledge ${role} is not a knowledge document: ${relative} (type: ${data.type ?? "unknown"} — route through ${owner})`,
    );
  }
  return { relative, resolved, data, body: parsed.body };
}

type IntegrateResult = {
  file: string;
  status: string;
  updated: string;
  sources: string[];
};

function integrateKnowledge(
  cwd: string,
  input: {
    into: string;
    from: string[];
    basis: string;
    note?: string;
    status?: string;
    informs?: string[];
    explains?: string[];
    date?: string;
  },
): IntegrateResult {
  const config = configFor("knowledge");
  const knowledgeDir = path.join(cwd, config.dir);
  const target = resolveKnowledgeTarget(cwd, input.into, "integration target");
  const { relative, resolved, data, body: targetBody } = target;
  const status = typeof data.status === "string" ? data.status : null;
  const lifecycle = typeof data.lifecycle === "string" ? data.lifecycle : null;
  if (isSettledDoc("knowledge", status, lifecycle)) {
    throw new Error(
      `Integration target is settled (status: ${status ?? "—"}, lifecycle: ${lifecycle ?? "—"}): ${relative} — supersede it with a new knowledge document instead`,
    );
  }
  if (input.from.length === 0) {
    throw new Error("Missing required --from: integration must record the extraction source (原典)");
  }
  if (!input.basis.trim()) {
    throw new Error("Missing required --basis: integration must record the evidence basis (根拠)");
  }

  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
  }
  if (input.status !== undefined && !config.statusValues.includes(input.status)) {
    throw new Error(`Invalid knowledge status: ${input.status} (expected one of: ${config.statusValues.join(", ")})`);
  }

  const relations = (data.relations && typeof data.relations === "object" && !Array.isArray(data.relations)
    ? { ...(data.relations as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  const mergeTargets = (field: "informs" | "explains", values: string[] | undefined): void => {
    if (!values || values.length === 0) return;
    const declared = config.allowedRelations.find((relation) => relation.field === field);
    const existing = Array.isArray(relations[field]) ? (relations[field] as unknown[]).filter((v): v is string => typeof v === "string") : [];
    for (const value of values) {
      const target = resolveDocumentReference(cwd, value, knowledgeDir);
      if (!target) {
        throw new Error(`Relation ${field} target does not resolve to a document: ${value}`);
      }
      if (!isInsideCheckout(cwd, target)) {
        throw new Error(`Relation ${field} target escapes the checkout: ${value}`);
      }
      const targetData = parseDoc(fs.readFileSync(target, "utf8"));
      const targetType = !targetData.error && typeof targetData.data.type === "string" ? targetData.data.type : null;
      if (!targetType || !declared?.targetTypes.includes(targetType)) {
        throw new Error(`Relation ${field} target resolves to type "${targetType ?? "unknown"}", expected one of: ${declared?.targetTypes.join(", ")}: ${value}`);
      }
      if (!existing.includes(value)) existing.push(value);
    }
    relations[field] = existing;
  };

  const existingSources = Array.isArray(relations.source)
    ? (relations.source as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  relations.source = [...existingSources, ...input.from.filter((source) => !existingSources.includes(source))];
  mergeTargets("informs", input.informs);
  mergeTargets("explains", input.explains);

  data.relations = relations;
  data.updated = date;
  if (input.status !== undefined) data.status = input.status;

  const body = appendProvenanceEntry(
    targetBody,
    provenanceEntry(date, input.basis, input.from, input.note),
  );
  fs.writeFileSync(resolved, `${matter.stringify(body.trimEnd() + "\n", data)}`, "utf8");

  return {
    file: relative,
    status: String(data.status),
    updated: date,
    sources: relations.source as string[],
  };
}

export {
  appendProvenanceEntry,
  assessConsolidation,
  integrateKnowledge,
  provenanceEntry,
  resolveKnowledgeTarget,
  tokenizeQuery,
  ROUTE_SKILLS,
};

export type {
  ConsolidationAssessment,
  ConsolidationCandidate,
  IntegrateResult,
};
