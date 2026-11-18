"use strict";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import * as yaml from "js-yaml";
import { z } from "zod";
import { generateArtifactId } from "./artifact_id";
import { parseClaimReference } from "./claim_ids";
import { isSettledEntry } from "./doc_lifecycle";
import {
  CANONICAL_DOC_DIRS,
  findDocumentDir,
  isIndexFileName,
  isInsideRealpath,
  listMarkdownFiles,
  normalizeDir,
  resolveContainedDir,
  slugify,
} from "./document_utils";
import { assertTypeScope, ownershipForDir } from "./doc_ownership";
import { configFor, configs, DEFAULT_LIFECYCLE, docTypes, knowledgeRelationFields, LIFECYCLE_VALUES, resolveDocType } from "./doc_types";
import type { DocConfig, DocType, LifecycleValue } from "./doc_types";

// The stored relation vocabulary the front-matter writer knows (Knowledge
// Relations v1, Issue #235): the provenance `source` field plus the
// registry's union forward set (`knowledgeRelationFields` — motivates /
// decides-for / realizes / informs / explains / supersedes). Each durable
// document emits `source`, `changes`, and only its own declared
// `allowedRelations` fields; inverse and legacy keys are never written —
// they are migration-domain input, flagged by schema preflight under a
// declared manifest and by lint's `legacy-relation-field` rule.
const relationFields = ["source", ...knowledgeRelationFields()] as const;

const changeFields = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "moved",
  "generated",
] as const;

type RelationField = typeof relationFields[number];
type ChangeField = typeof changeFields[number];

type ChangeEntry = {
  type: string;
  [key: string]: unknown;
};

type ChangeSet = Record<ChangeField, ChangeEntry[]>;

// Caller-supplied relations are intentionally loosely keyed: legacy and
// execution-bound creator scripts still pass pre-v3 field names, which
// `configFor` rejects before `frontMatter` runs — and `frontMatter` itself
// throws on any key outside the durable type's declared v1 vocabulary, so
// no writer silently drops or emits non-canonical fields.
type RelationInput = { changes?: Partial<ChangeSet> } & Record<string, unknown>;

function relationTargets(input: RelationInput | undefined, field: string): string[] {
  const value = input?.[field];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

type MetadataInput = Record<string, unknown>;

type CreateDocumentOptions = {
  cwd: string;
  date?: string;
  dir?: string;
  // Type-specific top-level front-matter fields (registry `requiredFields`
  // such as `knowledge_kind`); scalars only.
  fields?: MetadataInput;
  forceIndex?: boolean;
  lifecycle?: string;
  metadata?: MetadataInput;
  name?: string;
  noIndex?: boolean;
  relations?: RelationInput;
  status?: string;
  title: string;
};

type DocEntry = {
  created: string | null;
  file: string;
  id: string | null;
  lifecycle: string | null;
  path: string;
  status: string | null;
  title: string;
  type: string | null;
};

type ScaffoldTarget = {
  dir: string;
  title: string;
  type?: DocType;
};

type MigrationDocType = DocType | null;

type MigrationInput = {
  body: string;
  source: string;
  title: string;
};

type MigrationPlan = {
  content: string;
  source: string;
  target: string;
  targetDir: string;
  title: string;
  type: MigrationDocType;
};

// A planned migration is either a write plan or a skip entry. Pattern-routed
// owner dirs (docs/adr, docs/impl/ir, docs/impl/exp) carry no document type,
// so a content guess can only become a skip — never a plan (Issue #188).
type PlannedMigration =
  | { plan: MigrationPlan }
  | { skipped: { file: string; reason: string } };

type MigrationOptions = {
  apply?: boolean;
  cwd: string;
  from?: string[];
  includeCanonical?: boolean;
  splitH1?: boolean;
};

type MigrationResult = {
  applied: boolean;
  created: string[];
  migrations: MigrationPlan[];
  skipped: { file: string; reason: string }[];
};

type MigrationRoute = {
  patterns: RegExp[];
  targetDir: string;
  type: MigrationDocType;
};

type TargetAllocation = {
  existing: Set<string>;
};

// Scaffold targets are the durable registry's canonical dirs — the v3
// managed doc tree only (execution-bound and legacy dirs are never
// scaffolded). `indexPrimary` picks which resident type seeds a shared
// dir's index (discovery owns docs/discovery's index even though
// brainstorm is co-resident there).
const scaffoldTargets: ScaffoldTarget[] = (() => {
  const byDir = new Map<string, ScaffoldTarget>();
  for (const type of docTypes) {
    const config = configFor(type);
    const existing = byDir.get(config.dir);
    const target: ScaffoldTarget = {
      dir: config.dir,
      title: config.scaffoldIndexTitle ?? `${config.idPrefix} Documents`,
      type,
    };
    if (!existing || config.indexPrimary) byDir.set(config.dir, target);
  }
  return [...byDir.values()];
})();

// When several document types share one canonical directory, the scaffold
// target's type owns the index title; otherwise the first candidate is used.
function primaryIndexTypeForDir(dir: string, candidates: string[]): string {
  const normalized = normalizeDir(dir);
  const scaffoldType = scaffoldTargets.find(
    (target) => target.type && normalizeDir(target.dir) === normalized,
  )?.type;
  if (scaffoldType && candidates.includes(scaffoldType)) return scaffoldType;
  return [...candidates].sort()[0] ?? "";
}

// A generated index documents every artifact the directory hosts, not only
// the type a single writer created. Writers therefore union the requesting
// types with all types canonically resident in the directory, so writing an
// index never drops rows owned by a sibling type (for example `brainstorm`
// and `discovery` both live in `docs/discovery`).
function residentTypesForDir(dir: string): string[] {
  const normalized = normalizeDir(dir);
  return docTypes.filter((type) => {
    const config = configFor(type);
    return [...config.dirs, config.dir].map(normalizeDir).includes(normalized);
  });
}

// The generated region of a managed index begins at the marker line and runs
// through the `Directory:` line, the index table, and the optional
// `## Settled` tier below it (its marker claims the block as generated too).
// Text before the marker and after the generated region is hand-written
// content and must be preserved.
function mergeManagedIndex(existing: string, generated: string): string {
  const sectionStart = generated.indexOf(GENERATED_INDEX_MARKER);
  const section = (sectionStart >= 0 ? generated.slice(sectionStart) : generated).replace(/\s+$/, "");
  const lines = existing.split("\n");
  const markerIndex = lines.findIndex((line) => line.includes(GENERATED_INDEX_MARKER));
  if (markerIndex < 0) return `${section}\n`;
  const preamble = lines.slice(0, markerIndex);
  const rest = lines.slice(markerIndex + 1);

  let directoryLine = -1;
  let regionEnd = -1;
  for (let i = 0; i < rest.length; i += 1) {
    const trimmed = rest[i].trim();
    if (directoryLine < 0 && trimmed.startsWith("Directory:")) {
      directoryLine = i;
      continue;
    }
    if (trimmed.startsWith("|")) {
      regionEnd = i;
      while (regionEnd + 1 < rest.length && rest[regionEnd + 1].trim().startsWith("|")) regionEnd += 1;
      break;
    }
  }
  if (regionEnd < 0) regionEnd = directoryLine;

  // A `## Settled <!-- doc-suite:settled-index -->` block below the first
  // table belongs to the generated region (including any table under it);
  // fold it into the replaced span so regeneration never leaves a stale copy.
  const settledMarkerIndex = rest.findIndex(
    (line, offset) => offset > regionEnd && line.includes(GENERATED_SETTLED_MARKER),
  );
  if (settledMarkerIndex >= 0) {
    regionEnd = settledMarkerIndex;
    // Blank lines separate the heading from its table — skip them before the
    // table run so the whole block is replaced.
    while (regionEnd + 1 < rest.length && rest[regionEnd + 1].trim() === "") regionEnd += 1;
    while (regionEnd + 1 < rest.length && rest[regionEnd + 1].trim().startsWith("|")) regionEnd += 1;
  }

  const preservedInside = rest.slice(0, regionEnd + 1).filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("Directory:") && !trimmed.startsWith("|")
      && !line.includes(GENERATED_INDEX_MARKER) && !line.includes(GENERATED_SETTLED_MARKER);
  });
  const trailing = rest.slice(regionEnd + 1);
  const head = preamble.join("\n").replace(/\n+$/, "");
  const tail = [...preservedInside, ...trailing].join("\n").replace(/^\n+|\n+$/g, "");
  const parts = [head, section, tail].filter((part) => part !== "");
  return `${parts.join("\n\n")}\n`;
}

// Renders the managed index for a directory using every type that can own
// rows there: the requesting type, explicit extra types, and all types
// canonically resident in the directory.
async function renderManagedIndex(cwd: string, dir: string, seedType: string, extraTypes?: string[]): Promise<string> {
  const types = [...new Set([seedType, ...(extraTypes ?? []), ...residentTypesForDir(dir)])].sort();
  const primary = primaryIndexTypeForDir(dir, types);
  return buildIndex(cwd, primary, dir, { types });
}

// Content-guess routes into the durable doc tree. Execution-bound
// (plan/task) and legacy (test-spec/impl/exp) types have no durable route:
// their old dirs are migration-owned, so a content guess never mints files
// there — and a declared non-durable `type:` is skipped outright in
// `plannedMigration` (Issue #234).
const migrationRoutes: MigrationRoute[] = [
  { targetDir: "docs/ideas", type: "idea", patterns: [/idea/i, /proposal/i] },
  { targetDir: "docs/discovery", type: "discovery", patterns: [/discovery/i, /brainstorm/i, /research/i, /brief/i] },
  { targetDir: "docs/knowledge", type: "knowledge", patterns: [/knowledge/i, /lesson/i, /runbook/i] },
  { targetDir: "docs/verification", type: "verification", patterns: [/verification/i, /verifies/i, /test[-\s]?spec/i, /testspec/i] },
  { targetDir: "docs/specs", type: "spec", patterns: [/spec/i, /requirement/i, /acceptance/i] },
  { targetDir: "docs/designs", type: "design", patterns: [/design/i, /architecture/i] },
  { targetDir: "docs/adr", type: null, patterns: [/adr/i, /decision/i, /architecture decision/i] },
  { targetDir: "docs/impl/ir", type: null, patterns: [/implementation record/i, /impl record/i, /\bir\b/i] },
  { targetDir: "docs/impl/exp", type: null, patterns: [/experiment/i, /\bexp\b/i, /spike/i] },
];

const changeEntrySchema = z.object({
  type: z.string().min(1),
}).passthrough();

const changesSchema = z.object(Object.fromEntries(
  changeFields.map((field) => [field, z.array(changeEntrySchema).default([])]),
)).prefault({});

const relationSchema = z.object({
  ...Object.fromEntries(relationFields.map((field) => [field, z.array(z.string()).default([])])),
  changes: changesSchema,
  // A non-empty reason string, not a relation target (Issue #165).
  "test-spec-skip": z.string().min(1).optional(),
}).prefault({});

const frontMatterSchema = z.object({
  id: z.string().min(1),
  type: z.enum(docTypes),
  status: z.string().min(1),
  // `lifecycle` stays optional at the schema boundary so pre-Registry-3
  // documents still parse — lint flags the missing field as
  // `missing-lifecycle`; a populated non-axis value is invalid here
  // (unknown lifecycle is never coerced to `current`).
  lifecycle: z.enum(LIFECYCLE_VALUES).optional(),
  title: z.string().min(1),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  owners: z.array(z.string()),
  relations: relationSchema,
}).passthrough();

const GENERATED_INDEX_MARKER = "<!-- doc-suite:generated-index -->";
// Marks the `## Settled` tier of a status-aware generated index; the heading
// carries the marker so `mergeManagedIndex` treats the block as generated
// region rather than hand-written prose (Issue #162/#163).
const GENERATED_SETTLED_MARKER = "<!-- doc-suite:settled-index -->";

// Index table headers shared by every managed index format so the scaffold's
// contract index and the owner writers emit byte-identical bodies.
const INDEX_TABLE_HEADER_4COL = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
const INDEX_TABLE_HEADER_1COL = "| File |\n| --- |";

function canonicalRootDir(cwd: string, type: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, undefined, config.dirs, config.dir);
}

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

// Real-path containment for a write-target dir whose leaf may not exist yet:
// the nearest existing ancestor is what a recursive mkdir or file write would
// actually follow, so a linked component resolving outside the checkout fails
// closed even when the target dir itself is absent (Issue #188).
function dirContainedForWrite(cwd: string, fullDir: string): boolean {
  let probe = fullDir;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  return isInsideRealpath(cwd, probe);
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name.trim());
  const stem = base.replace(/\.md$/i, "");
  if (!stem) throw new Error("Invalid filename: empty after removing .md extension");
  return `${stem}.md`;
}

// Single resolution boundary for shared-suite types: containment first
// (findDocumentDir -> resolveContainedDir), then ownership. Any type that
// is not resident in the resolved dir fails closed here, before callers
// can mkdir, write, or index (Issue #183).
function docDir(cwd: string, type: string, explicitDir?: string): string {
  const config = configFor(type);
  const resolved = findDocumentDir(cwd, explicitDir, config.dirs, config.dir);
  assertTypeScope(type, resolved);
  return resolved;
}

function docFiles(dir: string): string[] {
  return walkMarkdownFiles(dir).map((f) => path.relative(dir, f).replace(/\\/g, "/"));
}

function isExternalLink(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

function matterData(content: string): Record<string, unknown> {
  return matter(content).data || {};
}

function parseDoc(content: string): { data: Record<string, unknown>; body: string; error: string | null } {
  try {
    const parsed = matter(content);
    return { data: parsed.data || {}, body: parsed.content, error: null };
  } catch (error: unknown) {
    return { data: {}, body: content, error: error instanceof Error ? error.message : String(error) };
  }
}

function sanitizeTitle(title: string): string {
  const cleaned = String(title).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Invalid title: empty after removing control characters");
  return cleaned;
}

// New documents must declare a lifecycle on the Registry-3 axis. The CLI
// accepts the flag as an arbitrary string; only the four declared values pass
// — anything else fails here rather than being coerced or silently defaulting
// (Issue #234).
function parseLifecycleOption(raw: string | undefined): LifecycleValue {
  if (raw === undefined || raw === "") return DEFAULT_LIFECYCLE;
  if ((LIFECYCLE_VALUES as readonly string[]).includes(raw)) return raw as LifecycleValue;
  throw new Error(`Invalid lifecycle: ${raw} (expected one of: ${LIFECYCLE_VALUES.join(", ")})`);
}

function indexCell(value: string): string {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isGeneratedIndex(content: string, legacyTitle?: string): boolean {
  if (content.includes(GENERATED_INDEX_MARKER)) return true;
  return Boolean(legacyTitle)
    && content.startsWith(`# ${legacyTitle}`)
    && /Directory: `/.test(content);
}

// A declared `type:` the scope can never own. The scope's own resident
// type — canonical name or a declared registry alias (`implementation-record`
// inside `docs/impl/ir` is the impl scope's own document, not drift) — is
// never foreign. Two kinds are foreign wherever they land (Issue #246):
// execution-bound spellings (plan/task — their state lives in the
// Execution Store) and legacy migration-only spellings (test-spec/exp
// and impl aliases — migration tooling owns their interpretation).
// Neither can be a scope document or an index row under a durable
// directory. A DURABLE type is foreign only when it is canonically
// resident in a different directory — then the wrong-scope file belongs
// to its own suite, not this one. Unknown spellings stay in-scope so
// `invalid-type`/`invalid-front-matter` can name them.
function isForeignDocType(typeValue: unknown, expected: string, relativeDir: string): boolean {
  if (typeof typeValue !== "string") return false;
  const actual = resolveDocType(typeValue);
  const resident = resolveDocType(expected);
  if (resident.entry !== null && resident.entry === actual.entry) return false;
  if (actual.kind === "legacy" || actual.kind === "ephemeral") return true;
  if (actual.kind !== "durable") return false;
  const normalized = normalizeDir(relativeDir);
  return actual.entry.dirs.map((dir) => normalizeDir(dir)).includes(normalized);
}

function formatIssuePath(pathParts: PropertyKey[]): string {
  return pathParts.length === 0 ? "$" : pathParts.map((part) => String(part)).join(".");
}

function validateFrontMatter(content: string): { message: string; path: string }[] {
  const parsed = parseDoc(content);
  if (parsed.error) {
    return [{ message: `Front matter is not valid YAML: ${parsed.error}`, path: "$" }];
  }
  const result = frontMatterSchema.safeParse(parsed.data);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    message: issue.message,
    path: formatIssuePath(issue.path),
  }));
}

function relationMap(content: string): Record<RelationField, string[]> {
  const data = parseDoc(content).data;
  const rawRelations = data.relations;
  const result = Object.fromEntries(relationFields.map((field) => [field, [] as string[]])) as Record<RelationField, string[]>;
  if (!rawRelations || typeof rawRelations !== "object" || Array.isArray(rawRelations)) return result;
  const raw = rawRelations as Record<string, unknown>;
  for (const field of relationFields) {
    const value = raw[field];
    if (Array.isArray(value)) result[field] = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
    else if (typeof value === "string" && value.trim()) result[field] = [value.trim()];
  }
  return result;
}

function completeChanges(input?: Partial<ChangeSet>): ChangeSet {
  return Object.fromEntries(changeFields.map((field) => [field, input?.[field] || []])) as ChangeSet;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatRelation(field: RelationField, values: string): string {
  return `  ${field}: ${values}`;
}

function formatRelationBlock(field: RelationField, values: string[]): string {
  if (values.length === 0) return formatRelation(field, "[]");
  return [`  ${field}:`, ...values.map((value) => `    - ${quote(value)}`)].join("\n");
}

function formatChangeScalar(key: string, value: string): string {
  return `${key}: ${quote(value)}`;
}

function formatChangeValue(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [
      `${key}:`,
      ...value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => `  - ${quote(item.trim())}`),
    ];
  }
  if (typeof value === "string") return [formatChangeScalar(key, value)];
  if (typeof value === "number" || typeof value === "boolean") return [`${key}: ${String(value)}`];
  return [`${key}: ${quote(JSON.stringify(value))}`];
}

function formatChangeEntry(entry: ChangeEntry): string[] {
  const ordered = [
    "type",
    "path",
    "from",
    "to",
    "source",
    ...Object.keys(entry).filter((key) => !["type", "path", "from", "to", "source"].includes(key)).sort(),
  ].filter((key, index, array) => key in entry && array.indexOf(key) === index);
  const lines: string[] = [];
  for (const key of ordered) {
    lines.push(...formatChangeValue(key, entry[key]));
  }
  return lines;
}

function formatChangesBlock(changes: ChangeSet): string[] {
  return [
    "  changes:",
    ...changeFields.flatMap((field) => {
      const entries = changes[field];
      if (entries.length === 0) return [`    ${field}: []`];
      return [
        `    ${field}:`,
        ...entries.flatMap((entry) => {
          const lines = formatChangeEntry(entry);
          return lines.length === 0
            ? ["      - {}"]
            : [`      - ${lines[0]}`, ...lines.slice(1).map((line) => `        ${line}`)];
        }),
      ];
    }),
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMetadataScalar(value: string | number | boolean): string {
  return typeof value === "string" ? quote(value) : String(value);
}

function formatMetadataNode(key: string, value: unknown, indent: number): string[] {
  if (value === null || value === undefined) return [];
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}${key}: []`];
    const items = value.flatMap((item) => {
      if (item === null || item === undefined) return [];
      if (isPlainObject(item)) {
        const childLines = Object.entries(item).flatMap(([itemKey, itemValue]) => formatMetadataNode(itemKey, itemValue, indent + 3));
        return childLines.length > 0 ? [`${prefix} -`, ...childLines] : [`${prefix} - {}`];
      }
      if (Array.isArray(item)) return [`${prefix} - ${quote(JSON.stringify(item))}`];
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return [`${prefix} - ${formatMetadataScalar(item)}`];
      return [`${prefix} - ${quote(JSON.stringify(item))}`];
    });
    return items.length > 0 ? [`${prefix}${key}:`, ...items] : [`${prefix}${key}: []`];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).flatMap(([childKey, childValue]) => formatMetadataNode(childKey, childValue, indent + 2));
    return entries.length > 0 ? [`${prefix}${key}:`, ...entries] : [`${prefix}${key}: {}`];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${prefix}${key}: ${formatMetadataScalar(value)}`];
  }
  return [`${prefix}${key}: ${quote(JSON.stringify(value))}`];
}

function formatMetadataBlock(metadata?: MetadataInput): string[] {
  if (!metadata) return [];
  const entries = Object.entries(metadata).flatMap(([key, value]) => formatMetadataNode(key, value, 2));
  return entries.length > 0 ? ["metadata:", ...entries] : ["metadata: {}"];
}

// Type-specific top-level front-matter fields the registry declares beyond
// the shared base set (e.g. `knowledge_kind` on knowledge docs, `checks` on
// verification docs). Scalars emit inline; arrays and objects serialize as
// an indented YAML block — the writer emits them next to the axis block;
// lint validates them through `requiredFields`/`fieldVocabularies` on the
// contract or the owning type's parser (Verification Design checks).
function formatExtraFieldsBlock(fields?: MetadataInput): string[] {
  if (!fields) return [];
  return Object.entries(fields).flatMap(([key, value]) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [`${key}: ${formatMetadataScalar(value)}`];
    }
    if (value === undefined || value === null) return [];
    const dumped = yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd();
    return [`${key}:`, ...dumped.split("\n").map((line) => `  ${line}`)];
  });
}

// The relation fields a durable type stores: `source` (provenance, shared)
// plus the type's own declared `allowedRelations` fields — the per-type
// projection of the Knowledge Relations v1 stored vocabulary.
function storedRelationFields(config: DocConfig): string[] {
  return config.allowedRelations.map((relation) => relation.field);
}

// Reject caller-supplied relation keys outside the durable type's declared
// vocabulary — silently dropping a populated relation would lose caller
// intent, and emitting a non-declared field would write non-canonical data.
function assertRelationInput(config: DocConfig, input?: RelationInput): void {
  const allowed = new Set(["source", "changes", ...storedRelationFields(config)]);
  for (const key of Object.keys(input ?? {})) {
    if (!allowed.has(key)) {
      throw new Error(
        `Invalid ${config.type} relation field: ${key} (stored fields for ${config.type}: ${[...allowed].sort().join(", ")})`,
      );
    }
  }
}

function completeRelations(config: DocConfig, input?: RelationInput): Record<string, string[]> {
  return Object.fromEntries(storedRelationFields(config).map((field) => [field, relationTargets(input, field)]));
}

function frontMatter(config: DocConfig, id: string, title: string, status: string, date: string, relations?: RelationInput, metadata?: MetadataInput, lifecycle: LifecycleValue = DEFAULT_LIFECYCLE, extraFields?: MetadataInput): string {
  if (!config.statusValues.includes(status)) {
    throw new Error(`Invalid ${config.type} status: ${status} (expected one of: ${config.statusValues.join(", ")})`);
  }
  if (!LIFECYCLE_VALUES.includes(lifecycle)) {
    throw new Error(`Invalid ${config.type} lifecycle: ${lifecycle} (expected one of: ${LIFECYCLE_VALUES.join(", ")})`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
  }
  assertRelationInput(config, relations);
  const complete = completeRelations(config, relations);
  const changes = completeChanges(relations?.changes);
  return [
    "---",
    `id: ${quote(id)}`,
    `type: ${quote(config.type)}`,
    `status: ${quote(status)}`,
    `lifecycle: ${quote(lifecycle)}`,
    `title: ${quote(sanitizeTitle(title))}`,
    `created: ${quote(date)}`,
    `updated: ${quote(date)}`,
    ...formatExtraFieldsBlock(extraFields),
    "owners: []",
    "relations:",
    formatRelationBlock("source", relationTargets(relations, "source")),
    ...formatChangesBlock(changes),
    ...storedRelationFields(config).map((field) => formatRelationBlock(field, complete[field])),
    ...formatMetadataBlock(metadata),
    "---",
  ].join("\n");
}

function renderBodyTemplate(type: DocType, title: string): string | null {
  const templatePath = path.join(__dirname, "../assets/templates", `${type}.md`);
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, "utf8")
    .replaceAll("{{title}}", title)
    .trimEnd();
}

function bodyFor(type: DocType, title: string): string {
  const template = renderBodyTemplate(type, title);
  if (template) return template;

  if (type === "idea") {
    return [
      `# ${title}`,
      "",
      "## Summary",
      "",
      "<!-- One or two sentences capturing the core idea. -->",
      "",
      "## Problem and Motivation",
      "",
      "- <!-- observed pain, opportunity, or trigger -->",
      "",
      "## Expected Value",
      "",
      "- <!-- who benefits and how -->",
      "",
      "## Open Questions",
      "",
      "- <!-- question that must be answered before this can be formalized -->",
      "",
      "## Next Action",
      "",
      "- [ ] Promote to discovery-doc for deeper exploration",
      "- [ ] Promote directly to spec-doc if requirements are clear",
      "- [ ] Park for later reconsideration",
      "- [ ] Discard — reason: <!-- why -->",
    ].join("\n");
  }
  if (type === "brainstorm") {
    return [
      `# ${title}`,
      "",
      "## Intent",
      "",
      "<!-- Confirm the goal, audience, and reason this matters now. -->",
      "",
      "## Constraints",
      "",
      "- <!-- technical, product, operational, timeline, or policy constraint -->",
      "",
      "## Options",
      "",
      "- <!-- option, trade-off, and current lean -->",
      "",
      "## Open Questions",
      "",
      "- <!-- question that must be resolved before routing -->",
      "",
      "## Document Routing",
      "",
      "- [ ] ADR needed",
      "- [ ] Spec needed",
      "",
      "## Confirmed Summary",
      "",
      "<!-- Write the agreed intent before creating downstream documents. -->",
    ].join("\n");
  }
  if (type === "discovery") {
    return [
      `# ${title}`,
      "",
      "## Summary",
      "",
      "<!-- Two or three sentences: the goal, the current best conclusion or hypothesis, and its confidence. Keep this section small — the bounded head every reader sees. -->",
      "",
      "## Exploration Goal",
      "",
      "<!-- What question does this discovery attempt to answer? State the trigger and desired outcome. -->",
      "",
      "## Key Issues and Assumptions",
      "",
      "- <!-- issue or assumption that must be validated before committing to a direction -->",
      "",
      "## Alternatives and Comparison",
      "",
      "| Option | Pros | Cons | Lean |",
      "| --- | --- | --- | --- |",
      "| <!-- option --> | <!-- pro --> | <!-- con --> | <!-- yes/no/maybe --> |",
      "",
      "## Tentative Conclusions and Hypotheses",
      "",
      "<!-- Current best guess before committing to a spec or ADR. Mark each as hypothesis or confirmed. -->",
      "",
      "## Open Questions",
      "",
      "- <!-- question blocking resolution -->",
      "",
      "## Promotion Candidates",
      "",
      "- [ ] spec-doc needed",
      "- [ ] adr-doc needed",
      "",
      "## Evidence",
      "",
      "<!-- Append-only evidence tail: dated raw-research entries go here, never in the sections above. Do not edit or reorder existing entries; readers needing only the conclusions may stop at this heading. -->",
    ].join("\n");
  }
  if (type === "spec") {
    return [
      `# ${title}`,
      "",
      "## Intent",
      "",
      "<!-- Describe the user need, problem, and desired outcome. -->",
      "",
      "## Scope",
      "",
      "### In Scope",
      "",
      "- <!-- behavior, workflow, or interface -->",
      "",
      "### Out of Scope",
      "",
      "- <!-- explicit non-goal -->",
      "",
      "## Requirements",
      "",
      "- <!-- requirement -->",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] <!-- observable behavior or verification -->",
      "",
      "## Deferred Design Concerns",
      "",
      "<!-- Intentionally deferred future work. Link the deferred draft doc in prose — Knowledge Relations v1 has no defers field. -->",
      "",
      "- <!-- concern | reason | re-engagement trigger | risk if ignored -->",
    ].join("\n");
  }
  if (type === "knowledge") {
    return [
      `# ${title}`,
      "",
      "## Summary",
      "",
      "<!-- One or two sentences: the durable knowledge this record carries. -->",
      "",
      "## Details",
      "",
      "<!-- The confirmed knowledge: what holds, where it applies, and why. -->",
      "",
      "## Scope and Applicability",
      "",
      "- <!-- where this knowledge applies — and where it does not -->",
      "",
      "## Provenance",
      "",
      "- <!-- where this was learned: implementation, discovery, incident, or review -->",
      "",
      "## Related Documents",
      "",
      "- <!-- link informed or explained documents via relations.informs / relations.explains -->",
    ].join("\n");
  }
  if (type === "verification") {
    return [
      `# ${title}`,
      "",
      "## Purpose",
      "",
      "<!-- The verification intent this design preserves: which claims it checks and when the design may be retired. -->",
      "",
      "## Scope",
      "",
      "<!-- The claims, contracts, or behaviors this design verifies — and the boundaries it stays inside. -->",
      "",
      "## Checks",
      "",
      "<!-- The authoritative check list is the front-matter `checks:` array — the sole Check→Claim authority. Each entry is a VerificationCheckV1 { id, target, method, implementation, preconditions, passCriteria, limitations, required }. Describe each check's intent in prose here and bind it to its front-matter id with a body anchor of the form check:CHK-NN inside an HTML comment. -->",
      "",
      "## Non-goals",
      "",
      "<!-- What this design deliberately does not verify. -->",
    ].join("\n");
  }
  if (type === "design") {
    return [
      `# ${title}`,
      "",
      "## Context",
      "",
      "<!-- Describe the problem context and boundaries for this design. -->",
      "",
      "## Scope",
      "",
      "- <!-- in-scope -->",
      "- <!-- out-of-scope -->",
      "",
      "## Components and Boundaries",
      "",
      "- <!-- component and responsibility -->",
      "",
      "## Data and Control Flow",
      "",
      "- <!-- key flow and decision points -->",
      "",
      "## Risks and Trade-offs",
      "",
      "- <!-- risk and mitigation -->",
      "",
      "## Deferred Design Concerns",
      "",
      "<!-- Intentionally deferred future work. Link the deferred draft doc in prose — Knowledge Relations v1 has no defers field. -->",
      "",
      "- <!-- concern | reason | re-engagement trigger | risk if ignored -->",
      "",
      "## References",
      "",
      "- <!-- linked spec, ADR, and related docs -->",
    ].join("\n");
  }
  return [
    `# ${title}`,
    "",
    "## Work",
    "",
    "<!-- Describe the implementation slice. -->",
    "",
    "## Done When",
    "",
    "- [ ] <!-- completion criterion -->",
  ].join("\n");
}

function isReservedDocFile(type: DocType, file: string): boolean {
  if (type === "design") {
    return /^overview\.md$/i.test(file);
  }
  return false;
}

function overviewDocument(date: string): string {
  const design = configFor("design");
  return [
    "---",
    'id: "DESIGN-OVERVIEW"',
    'type: "design"',
    'status: "draft"',
    'lifecycle: "draft"',
    'title: "System Design Overview"',
    `created: "${date}"`,
    `updated: "${date}"`,
    "owners: []",
    "relations:",
    formatRelationBlock("source", []),
    ...formatChangesBlock(completeChanges()),
    ...storedRelationFields(design).map((field) => formatRelationBlock(field, [])),
    "---",
    "",
    "# System Design Overview",
    "",
    "## System Boundaries",
    "",
    "- <!-- major subsystems and their boundaries -->",
    "",
    "## Core Components",
    "",
    "- <!-- component and responsibility -->",
    "",
    "## Data Flow",
    "",
    "- <!-- high-level data and control flow -->",
    "",
    "## Non-Functional Constraints",
    "",
    "- <!-- reliability, security, performance, operations -->",
    "",
    "## Detailed Design Documents",
    "",
    "- <!-- link detailed docs under docs/designs/<slug>.md -->",
    "",
  ].join("\n");
}

function ensureDesignOverview(fullDir: string, date: string): void {
  const overviewPath = path.join(fullDir, "overview.md");
  if (fs.existsSync(overviewPath)) return;
  fs.writeFileSync(overviewPath, overviewDocument(date), "utf8");
}

async function titleFromDocument(
  content: string,
  fallback: string,
  headingToTitle?: (heading: string) => string,
): Promise<string> {
  const parsed = parseDoc(content);
  const data = parsed.data;
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(parsed.body);
  const heading = match?.[1]?.trim();
  if (!heading) return fallback;
  const normalized = headingToTitle ? headingToTitle(heading).trim() : heading;
  return normalized || fallback;
}

async function docEntries(cwd: string, type: string, explicitDir?: string): Promise<DocEntry[]> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const dir = path.join(cwd, relativeDir);
  const indexRow = configFor(type).indexRow;
  const entries = await Promise.all(docFiles(dir).map(async (file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = parseDoc(content).data;
    const entryType = typeof data.type === "string" ? data.type : null;
    // Type-keyed row hooks describe the scan type's own filename/heading
    // conventions; a foreign-typed file (e.g. an `idea` doc misplaced into
    // docs/adr) must not inherit them (Issue #185 review).
    const hooks = entryType === null || entryType === type ? indexRow : undefined;
    return {
      created: typeof data.created === "string" ? data.created : null,
      file,
      id: (typeof data.id === "string" && data.id.trim())
        ? data.id.trim()
        : hooks?.idFromFile?.(path.basename(file)) ?? null,
      lifecycle: typeof data.lifecycle === "string" ? data.lifecycle : null,
      path: `${relativeDir}/${file}`.replace(/\\/g, "/"),
      status: typeof data.status === "string" ? data.status : null,
      title: await titleFromDocument(content, path.basename(file, ".md"), hooks?.titleFromHeading),
      type: entryType,
    };
  }));
  return entries.filter((entry) => !isForeignDocType(entry.type, type, relativeDir));
}

type IndexRowEntry = {
  file: string;
  id: string | null;
  lifecycle?: string | null;
  status: string | null;
  title: string;
  type?: string | null;
};

/**
 * Status-aware index body (Issue #162/#163): in-flight rows keep the original
 * table; settled rows move to a `## Settled` tier below it so historical
 * evidence stays one link away but visually de-emphasized. The settled axis
 * comes from `doc_lifecycle` (`isSettledEntry`) — a declared `lifecycle`
 * value wins over the status axis, absent/unknown values fall back to the
 * per-type settled-status set — the same authority lint and lifecycle-stats
 * use. Ordering is deterministic: `overview.md` first within its tier
 * (design indexes), then file-lexical inside each tier.
 *
 * `settledType` is the fallback lifecycle bucket for rows whose front matter
 * lacks `type:` — pass the index's primary resident type.
 */
function renderIndexBody(entries: IndexRowEntry[], options: { overviewFirst?: boolean; settledType?: string } = {}): string {
  const header = INDEX_TABLE_HEADER_4COL;
  const compare = (left: IndexRowEntry, right: IndexRowEntry): number => {
    if (options.overviewFirst) {
      if (left.file === "overview.md") return -1;
      if (right.file === "overview.md") return 1;
    }
    return left.file.localeCompare(right.file);
  };
  const row = (entry: IndexRowEntry): string =>
    `| ${indexCell(entry.id || "—")} | ${indexCell(entry.title)} | ${indexCell(entry.status || "—")} | [${indexCell(entry.file)}](./${indexCell(entry.file)}) |`;
  const settled = (entry: IndexRowEntry): boolean =>
    isSettledEntry(entry.type ?? options.settledType ?? null, entry.status, entry.lifecycle);
  const active = entries.filter((entry) => !settled(entry)).sort(compare);
  const settledEntries = entries.filter(settled).sort(compare);
  const body = [header, ...active.map(row)].join("\n");
  return settledEntries.length > 0
    ? `${body}\n\n## Settled ${GENERATED_SETTLED_MARKER}\n\n${[header, ...settledEntries.map(row)].join("\n")}`
    : body;
}

async function buildIndex(cwd: string, type: string, explicitDir?: string, options?: { types?: string[] }): Promise<string> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const unionTypes = options?.types ?? [];
  const entries = unionTypes.length > 1
    ? [...new Map(
        (await Promise.all(unionTypes.map((unionType) => docEntries(cwd, unionType, explicitDir))))
          .flat()
          .map((entry) => [entry.file, entry] as const),
      ).values()].sort((a, b) => a.file.localeCompare(b.file))
    : await docEntries(cwd, type, explicitDir);
  const contractTitle = ownershipForDir(normalizeDir(relativeDir))?.indexTitle
    ?? ownershipForDir(normalizeDir(configFor(type).dir))?.indexTitle;
  const title = contractTitle ?? `${configFor(type).idPrefix} Documents`;
  const body = renderIndexBody(entries, {
    overviewFirst: type === "design" || unionTypes.includes("design"),
    settledType: type,
  });
  return `# ${title}\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${body}\n`;
}

function buildGenericIndex(relativeDir: string, title: string): string {
  const dir = relativeDir.replace(/\\/g, "/");
  return `# ${title}\n\nDirectory: \`${dir}\`\n`;
}

// The empty managed index a directory's ownership contract prescribes.
// Only contract rows carrying an indexTitle produce one; shared-suite typed
// dirs render through renderManagedIndex instead (union types, id-prefix
// titles), and unclaimed or index-less dirs return null (Issue #184).
function emptyIndexForDir(dir: string): string | null {
  const normalized = normalizeDir(dir);
  const contract = ownershipForDir(normalized);
  if (!contract || !contract.canonical || !contract.indexTitle) return null;
  const header = contract.indexFormat === "exp-1col" ? INDEX_TABLE_HEADER_1COL : INDEX_TABLE_HEADER_4COL;
  return `# ${contract.indexTitle}\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${normalized}\`\n\n${header}\n`;
}

// Byte template of the generic README pre-#184 scaffolds wrote for owner
// dirs (no marker, `# <X Documents>` title). The promotion tool compares
// candidate files against this exact output — never title similarity —
// before an owner writer may adopt them.
const LEGACY_SCAFFOLD_INDEX_TITLES: Record<string, string> = {
  "docs/adr": "ADR Documents",
  "docs/impl/ir": "Implementation Record Documents",
  "docs/impl/exp": "Experiment Log Documents",
};

function legacyScaffoldIndex(dir: string): string | null {
  const normalized = normalizeDir(dir);
  const title = LEGACY_SCAFFOLD_INDEX_TITLES[normalized];
  return title ? buildGenericIndex(normalized, title) : null;
}

function isMarkdownSource(file: string): boolean {
  return file.endsWith(".md") && !isIndexFileName(path.basename(file));
}

function isUnderCanonicalDir(relativeFile: string): boolean {
  const normalized = normalizeDir(relativeFile);
  return CANONICAL_DOC_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function walkMarkdownFiles(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    // Never adopt symlinked entries: reads and writes would follow them and
    // could reach files outside the repository.
    if (entry.isSymbolicLink()) return [];
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
    return isMarkdownSource(fullPath) ? [fullPath] : [];
  }).sort();
}

function defaultMigrationSources(cwd: string): string[] {
  return ["docs", "doc", "architecture", "design", "specs", "plans", "tasks"]
    .filter((dir) => fs.existsSync(path.join(cwd, dir)));
}

function headingTitle(content: string, fallback: string): string {
  const parsed = parseDoc(content);
  const data = parsed.data;
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(parsed.body);
  return match?.[1]?.trim() || fallback;
}

function splitByH1(source: string, content: string): MigrationInput[] {
  const parsed = parseDoc(content);
  const body = parsed.body.trim();
  const matches = [...body.matchAll(/^#\s+(.+)$/gm)];
  if (matches.length <= 1) {
    return [{
      source,
      title: headingTitle(content, path.basename(source, ".md")),
      body,
    }];
  }

  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || body.length : body.length;
    const chunk = body.slice(start, end).trim();
    return {
      source,
      title: match[1].trim(),
      body: chunk,
    };
  });
}

// Sentinel route for source documents whose declared `type:` has no durable
// form under Registry 3 (plan/task/test-spec/impl/exp): they are migration
// artifacts, never re-routed into the durable tree.
const LEGACY_DOC_ROUTE: MigrationRoute = { targetDir: "", type: null, patterns: [] };

function routeFor(input: MigrationInput, sourceData: Record<string, unknown>): MigrationRoute {
  if (typeof sourceData.type === "string") {
    const resolved = resolveDocType(sourceData.type);
    if (resolved.kind === "durable") {
      return { targetDir: resolved.entry.dir, type: resolved.entry.type as DocType, patterns: [] };
    }
    if (resolved.kind !== "unknown") return LEGACY_DOC_ROUTE;
  }

  const haystack = `${input.source}\n${input.title}\n${input.body.slice(0, 2000)}`;
  return migrationRoutes.find((route) => route.patterns.some((pattern) => pattern.test(haystack)))
    || { targetDir: "docs/discovery", type: "discovery", patterns: [] };
}

function targetAllocation(cwd: string, targetDir: string): TargetAllocation {
  const fullTargetDir = path.join(cwd, targetDir);
  const existingFiles = fs.existsSync(fullTargetDir)
    ? fs.readdirSync(fullTargetDir).filter((file) => file.endsWith(".md"))
    : [];
  return {
    existing: new Set(existingFiles),
  };
}

function allocateTargetPath(cwd: string, targetDir: string, title: string, fallback: string, allocations: Map<string, TargetAllocation>): { target: string } {
  if (!allocations.has(targetDir)) allocations.set(targetDir, targetAllocation(cwd, targetDir));
  const allocation = allocations.get(targetDir) as TargetAllocation;
  let baseName = `${slugify(title, fallback)}.md`;
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let suffix = 2;
  while (allocation.existing.has(baseName)) {
    baseName = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  allocation.existing.add(baseName);
  return {
    target: path.join(targetDir, baseName).replace(/\\/g, "/"),
  };
}

function migratedFrontMatter(type: DocType, title: string, date: string, source: string): string {
  const config = configFor(type);
  return frontMatter(config, generateArtifactId(config.idPrefix), title, config.defaultStatus, date, {
    source: [source],
    changes: {
      generated: [{ type: "migration", source }],
    },
  });
}

function migratedContent(input: MigrationInput, route: MigrationRoute, sourceContent: string, source: string, date: string): string {
  if (route.type) {
    return `${migratedFrontMatter(route.type, input.title, date, source)}\n\n${input.body.trim()}\n`;
  }

  const parsed = parseDoc(sourceContent);
  const data = parsed.data;
  if (Object.keys(data).length > 0) return `${matter.stringify(input.body.trim(), data).trimEnd()}\n`;
  return `---\ntitle: ${quote(input.title)}\nsource: ${quote(source)}\n---\n\n${input.body.trim()}\n`;
}

function plannedMigration(cwd: string, source: string, input: MigrationInput, sourceContent: string, date: string, allocations: Map<string, TargetAllocation>): PlannedMigration {
  const sourceData = matterData(sourceContent);
  const route = routeFor(input, sourceData);
  // A declared non-durable `type:` (plan/task/test-spec/impl/exp) marks the
  // file as a Registry-2 artifact: migration tooling owns its
  // interpretation — the docs migrator never rewrites it into a durable
  // document of another type.
  if (route === LEGACY_DOC_ROUTE) {
    return { skipped: { file: source, reason: "legacy-doc-type" } };
  }
  // Owner-dir routes (docs/adr, docs/impl/ir, docs/impl/exp) are the only
  // type:null routes: a content guess must never mint files in a foreign
  // owner's directory. Skipped identically in plan and apply — typed routes
  // (`type: adr` front matter, a declared mutator with a valid schema) keep
  // routing and writing (Issue #188).
  if (route.type === null) {
    return { skipped: { file: source, reason: "unsupported-owner-route" } };
  }
  const targetDir = route.targetDir;
  const { target } = allocateTargetPath(cwd, targetDir, input.title, route.type, allocations);
  return {
    plan: {
      content: migratedContent(input, route, sourceContent, source, date),
      source,
      target,
      targetDir,
      title: input.title,
      type: route.type,
    },
  };
}

async function migrateDocs(options: MigrationOptions): Promise<MigrationResult> {
  const cwd = path.resolve(options.cwd);
  // Each --from is a scan root: it must stay inside the checkout, enforced by
  // the same shared rule as --dir/--task-dir. An escaping value is rejected,
  // never walked (Issue #156).
  const fromDirs = (options.from && options.from.length > 0)
    ? options.from.map((dir) => resolveContainedDir(cwd, dir, "--from"))
    : defaultMigrationSources(cwd);
  const skipped: MigrationResult["skipped"] = [];
  const migrations: MigrationPlan[] = [];
  const allocations = new Map<string, TargetAllocation>();
  const date = new Date().toISOString().slice(0, 10);

  for (const fromDir of fromDirs) {
    const fullFrom = path.resolve(cwd, fromDir);
    const files = walkMarkdownFiles(fullFrom);
    for (const fullFile of files) {
      const relativeFile = path.relative(cwd, fullFile).replace(/\\/g, "/");
      if (!options.includeCanonical && isUnderCanonicalDir(relativeFile)) {
        skipped.push({ file: relativeFile, reason: "canonical-doc" });
        continue;
      }

      const sourceContent = fs.readFileSync(fullFile, "utf8");
      const sourceParsed = parseDoc(sourceContent);
      if (sourceParsed.error) {
        skipped.push({ file: relativeFile, reason: "unparseable-front-matter" });
        continue;
      }
      const inputs = options.splitH1
        ? splitByH1(relativeFile, sourceContent)
        : [{
          source: relativeFile,
          title: headingTitle(sourceContent, path.basename(relativeFile, ".md")),
          body: sourceParsed.body.trim(),
        }];
      for (const input of inputs) {
        const planned = plannedMigration(cwd, relativeFile, input, sourceContent, date, allocations);
        if ("skipped" in planned) {
          skipped.push(planned.skipped);
        } else {
          migrations.push(planned.plan);
        }
      }
    }
  }

  const created: string[] = [];
  if (options.apply) {
    await scaffoldDocsTree(cwd);
    for (const migration of migrations) {
      // A canonical target dir that resolves outside the checkout — its own
      // link or a linked ancestor a recursive mkdir would follow — is a hard
      // failure: nothing may be written through the link (Issue #188).
      const targetDir = resolveContainedDir(cwd, migration.targetDir, "migrate target");
      if (!dirContainedForWrite(cwd, path.join(cwd, targetDir))) {
        throw new Error(`migrate target escapes the checkout through a link: ${migration.targetDir}`);
      }
      const targetPath = path.join(cwd, migration.target);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, migration.content, "utf8");
      created.push(migration.target);
    }
    for (const target of scaffoldTargets.filter((item) => item.type)) {
      // Index regeneration writes into the same canonical dirs the scaffold
      // gates — an excluded (escaping) dir is never written through a link.
      if (!dirContainedForWrite(cwd, path.join(cwd, target.dir))) continue;
      await writeGeneratedIndex(cwd, target.type as DocType, target.dir, {});
    }
  }

  return { applied: Boolean(options.apply), created, migrations, skipped };
}

async function scaffoldDocsTree(cwd: string): Promise<{ created: string[]; updated: string[] }> {
  const resolvedCwd = path.resolve(cwd);
  const created: string[] = [];
  const updated: string[] = [];

  for (const target of scaffoldTargets) {
    const fullDir = path.join(resolvedCwd, target.dir);
    // A scaffold dir that would resolve outside the checkout — its own link
    // or a linked ancestor a recursive mkdir would follow — is excluded:
    // creating or writing through it escapes the checkout. Mirrors the
    // canonicalDirs realpath gating in id_migration (Issue #188).
    if (!dirContainedForWrite(resolvedCwd, fullDir)) continue;
    fs.mkdirSync(fullDir, { recursive: true });

    const readmePath = path.join(fullDir, "README.md");
    if (fs.existsSync(readmePath)) continue;

    const content = target.type
      ? await renderManagedIndex(resolvedCwd, target.dir, target.type)
      : emptyIndexForDir(target.dir) ?? (() => { throw new Error(`No index contract for scaffold dir ${target.dir}`); })();
    fs.writeFileSync(readmePath, content, "utf8");
    created.push(path.relative(resolvedCwd, readmePath).replace(/\\/g, "/"));
  }

  return { created, updated };
}

type IndexWriteResult = { path: string; written: boolean; reason: "hand-curated" | "disabled" | null };

async function writeGeneratedIndex(cwd: string, type: DocType | string, relativeDir: string, options: Pick<CreateDocumentOptions, "forceIndex" | "noIndex"> & { types?: string[]; indexFile?: string }): Promise<IndexWriteResult> {
  const indexPath = path.join(cwd, relativeDir, options.indexFile ?? "README.md");
  const relIndex = path.relative(cwd, indexPath).replace(/\\/g, "/");
  if (options.noIndex) return { path: relIndex, written: false, reason: "disabled" };

  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : null;
  const isGenerated = existing === null || existing.includes(GENERATED_INDEX_MARKER);
  if (!isGenerated && !options.forceIndex) {
    return { path: relIndex, written: false, reason: "hand-curated" };
  }

  const generated = await renderManagedIndex(cwd, relativeDir, type, options.types);
  const content = existing !== null && existing.includes(GENERATED_INDEX_MARKER)
    ? mergeManagedIndex(existing, generated)
    : generated;
  fs.writeFileSync(indexPath, content, "utf8");
  return { path: relIndex, written: true, reason: null };
}

async function createDocument(type: DocType | string, options: CreateDocumentOptions): Promise<{ file: string; index: string; indexWritten: boolean; indexSkippedReason: "hand-curated" | "disabled" | "deferred" | null; relativeDir: string }> {
  // `configFor` is the registry gate: durable types get their entry;
  // execution-bound (plan/task) and legacy (test-spec/impl/exp) names fail
  // here with the dedicated message — nothing can be minted as a durable
  // document of a non-durable type (Issue #234).
  const config = configFor(type);
  const lifecycle = parseLifecycleOption(options.lifecycle);
  const cwd = path.resolve(options.cwd);
  const relativeDir = docDir(cwd, type, options.dir);
  const fullDir = path.join(cwd, relativeDir);
  fs.mkdirSync(fullDir, { recursive: true });

  const rootDir = canonicalRootDir(cwd, type);
  const underRoot = isUnderDir(relativeDir, rootDir);

  const title = sanitizeTitle(options.title);
  const filename = options.name
    ? sanitizeFileName(options.name)
    : `${slugify(title, type)}.md`;
  if (isReservedDocFile(config.type as DocType, filename)) throw new Error(`Cannot create document with reserved filename: ${filename}`);
  const outputPath = path.join(fullDir, filename);
  if (fs.existsSync(outputPath)) throw new Error(`Document already exists: ${path.relative(cwd, outputPath)}`);

  const date = options.date || new Date().toISOString().slice(0, 10);
  const status = options.status || config.defaultStatus;
  const content = `${frontMatter(config, generateArtifactId(config.idPrefix), title, status, date, options.relations, options.metadata, lifecycle, options.fields)}\n\n${bodyFor(config.type as DocType, title)}\n`;
  fs.writeFileSync(outputPath, content, "utf8");

  if (type === "design") ensureDesignOverview(path.join(cwd, rootDir), date);

  // Index materialization is never implicit on document creation (#196):
  // doc_maintenance index plan|apply is the single explicit entrypoint.
  const indexRelativeDir = underRoot ? rootDir : relativeDir;
  const indexPath = path.join(cwd, indexRelativeDir, "README.md");

  return {
    file: path.relative(cwd, outputPath).replace(/\\/g, "/"),
    index: path.relative(cwd, indexPath).replace(/\\/g, "/"),
    indexWritten: false,
    indexSkippedReason: "deferred",
    relativeDir,
  };
}

function logIndexResult(result: { index: string; indexWritten: boolean; indexSkippedReason: "hand-curated" | "disabled" | "deferred" | null }): void {
  if (result.indexWritten) {
    console.log(`Updated ${result.index}`);
  } else if (result.indexSkippedReason === "deferred") {
    console.log(`Index deferred: ${result.index} — materialize explicitly via doc_maintenance.js index apply --dir ${path.posix.dirname(result.index)}`);
  } else if (result.indexSkippedReason === "hand-curated") {
    console.warn(`Skipped index update: ${result.index} appears hand-curated (no generated marker). Update it manually or pass --force-index.`);
  } else if (result.indexSkippedReason === "disabled") {
    console.log(`Skipped index update (--no-index): ${result.index}`);
  }
}

function relationValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) return [value];
  return [];
}

// Every file a document reference resolves to — the multi-match form of
// resolveDocumentReference. A path ref still yields at most one file; an
// id may name several files (locale siblings, or a duplicated id across
// distinct artifacts). Callers that must refuse ambiguity or prefer the
// artifact's primary file consume this; resolveDocumentReference keeps the
// historical first-match contract.
function resolveDocumentReferenceAll(cwd: string, target: string, fromDir?: string): string[] {
  const trimmed = target.trim();
  // Claim-qualified references (`DOC-ID::KEY`) address documents by id only —
  // never by path — the same contract the repository/graph boundary uses.
  const claimRef = parseClaimReference(trimmed);
  const idLookup = claimRef?.docId ?? trimmed;
  if (!claimRef) {
    for (const base of fromDir ? [fromDir, cwd] : [cwd]) {
      const candidate = path.resolve(base, trimmed);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return [candidate];
    }
  }
  const matches = new Set<string>();
  for (const type of docTypes) {
    for (const dirName of configs[type].dirs) {
      const dir = path.join(cwd, dirName);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const file of docFiles(dir)) {
        const fullPath = path.join(dir, file);
        const parsed = parseDoc(fs.readFileSync(fullPath, "utf8"));
        if (!parsed.error && parsed.data.id === idLookup) matches.add(fullPath);
      }
    }
  }
  return [...matches];
}

function resolveDocumentReference(cwd: string, target: string, fromDir?: string): string | null {
  return resolveDocumentReferenceAll(cwd, target, fromDir)[0] ?? null;
}

export {
  buildIndex,
  buildGenericIndex,
  configFor,
  createDocument,
  docDir,
  docEntries,
  docFiles,
  docTypes,
  emptyIndexForDir,
  GENERATED_INDEX_MARKER,
  GENERATED_SETTLED_MARKER,
  INDEX_TABLE_HEADER_1COL,
  INDEX_TABLE_HEADER_4COL,
  indexCell,
  isForeignDocType,
  isGeneratedIndex,
  legacyScaffoldIndex,
  mergeManagedIndex,
  parseDoc,
  primaryIndexTypeForDir,
  relationValues,
  renderIndexBody,
  renderManagedIndex,
  resolveDocumentReference,
  resolveDocumentReferenceAll,
  sanitizeTitle,
  logIndexResult,
  migrateDocs,
  relationFields,
  changeFields,
  changesSchema,
  frontMatterSchema,
  frontMatter,
  relationSchema,
  residentTypesForDir,
  scaffoldDocsTree,
  validateFrontMatter,
  writeGeneratedIndex,
};

export type { DocType, IndexRowEntry, MetadataInput };
