"use strict";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { generateArtifactId } from "./artifact_id";
import { findDocumentDir, isIndexFileName, listMarkdownFiles, normalizeDir, slugify } from "./document_utils";

const relationFields = [
  "source",
  "implements",
  "implemented-by",
  "depends-on",
  "blocks",
  "supersedes",
  "superseded-by",
  "related",
  "refines",
  "refined-by",
  "derives-from",
  "derived-by",
  "verifies",
  "verified-by",
  "references",
  "defers",
  "deferred-by",
] as const;

const changeFields = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "moved",
  "generated",
] as const;

const docTypes = ["idea", "brainstorm", "discovery", "spec", "plan", "task", "design", "adr", "test-spec"] as const;

type DocType = typeof docTypes[number];
type RelationField = typeof relationFields[number];
type ChangeField = typeof changeFields[number];
type DocConfig = {
  defaultStatus: string;
  dir: string;
  dirs: string[];
  idPrefix: string;
  statusValues: string[];
  type: DocType;
};

type ChangeEntry = {
  type: string;
  [key: string]: unknown;
};

type ChangeSet = Record<ChangeField, ChangeEntry[]>;

type RelationInput = Partial<Record<RelationField, string[]>> & {
  changes?: Partial<ChangeSet>;
};

type MetadataInput = Record<string, unknown>;

type CreateDocumentOptions = {
  cwd: string;
  date?: string;
  dir?: string;
  forceIndex?: boolean;
  name?: string;
  noIndex?: boolean;
  relations?: RelationInput;
  status?: string;
  title: string;
};

type DocEntry = {
  file: string;
  id: string | null;
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

const configs: Record<DocType, DocConfig> = {
  idea: {
    defaultStatus: "draft",
    dir: "docs/ideas",
    dirs: ["docs/ideas"],
    idPrefix: "IDEA",
    statusValues: ["draft", "exploring", "promoted", "parked", "archived", "superseded"],
    type: "idea",
  },
  brainstorm: {
    defaultStatus: "capturing",
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    idPrefix: "BRAINSTORM",
    statusValues: ["capturing", "confirmed", "routed", "superseded"],
    type: "brainstorm",
  },
  discovery: {
    defaultStatus: "draft",
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    idPrefix: "DISC",
    statusValues: ["draft", "active", "resolved", "archived", "superseded"],
    type: "discovery",
  },
  spec: {
    defaultStatus: "draft",
    dir: "docs/specs",
    dirs: ["docs/specs", "docs/spec", "specs", "spec"],
    idPrefix: "SPEC",
    statusValues: ["draft", "proposed", "approved", "implemented", "superseded", "rejected"],
    type: "spec",
  },
  plan: {
    defaultStatus: "draft",
    dir: "docs/plans",
    dirs: ["docs/plans", "docs/implementation-plans", "plans", "implementation-plans"],
    idPrefix: "PLAN",
    statusValues: ["draft", "approved", "in-progress", "blocked", "completed", "superseded"],
    type: "plan",
  },
  task: {
    defaultStatus: "todo",
    dir: "docs/tasks",
    dirs: ["docs/tasks", "docs/work-items", "tasks", "work-items"],
    idPrefix: "TASK",
    statusValues: ["todo", "in-progress", "blocked", "done", "wont-do"],
    type: "task",
  },
  "test-spec": {
    defaultStatus: "draft",
    dir: "docs/test-specs",
    dirs: ["docs/test-specs", "docs/test-spec", "test-specs", "test-spec"],
    idPrefix: "TSPEC",
    statusValues: ["draft", "proposed", "approved", "deprecated", "superseded"],
    type: "test-spec",
  },
  design: {
    defaultStatus: "draft",
    dir: "docs/designs",
    dirs: ["docs/designs", "docs/design", "designs", "design"],
    idPrefix: "DESIGN",
    statusValues: ["draft", "approved", "superseded", "rejected"],
    type: "design",
  },
  adr: {
    defaultStatus: "proposed",
    dir: "docs/adr",
    dirs: ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"],
    idPrefix: "ADR",
    statusValues: ["proposed", "accepted", "rejected", "deprecated", "superseded", "draft"],
    type: "adr",
  },
};

const scaffoldTargets: ScaffoldTarget[] = [
  { dir: "docs/ideas", title: "IDEA Documents", type: "idea" },
  { dir: "docs/discovery", title: "DISCOVERY Documents", type: "discovery" },
  { dir: "docs/specs", title: "SPEC Documents", type: "spec" },
  { dir: "docs/designs", title: "DESIGN Documents", type: "design" },
  { dir: "docs/plans", title: "PLAN Documents", type: "plan" },
  { dir: "docs/tasks", title: "TASK Documents", type: "task" },
  { dir: "docs/test-specs", title: "TEST-SPEC Documents", type: "test-spec" },
  { dir: "docs/adr", title: "ADR Documents" },
  { dir: "docs/impl/ir", title: "Implementation Record Documents" },
  { dir: "docs/impl/exp", title: "Experiment Log Documents" },
];

const canonicalDocDirs = scaffoldTargets.map((target) => target.dir);

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
// through the `Directory:` line and the index table. Text before the marker
// and after the table is hand-written content and must be preserved.
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

  const preservedInside = rest.slice(0, regionEnd + 1).filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("Directory:") && !trimmed.startsWith("|");
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

const migrationRoutes: MigrationRoute[] = [
  { targetDir: "docs/ideas", type: "idea", patterns: [/idea/i, /proposal/i] },
  { targetDir: "docs/discovery", type: "discovery", patterns: [/discovery/i, /brainstorm/i, /research/i, /brief/i] },
  { targetDir: "docs/test-specs", type: "test-spec", patterns: [/test[-\s]?spec/i, /testspec/i] },
  { targetDir: "docs/specs", type: "spec", patterns: [/spec/i, /requirement/i, /acceptance/i] },
  { targetDir: "docs/designs", type: "design", patterns: [/design/i, /architecture/i] },
  { targetDir: "docs/plans", type: "plan", patterns: [/plan/i, /roadmap/i] },
  { targetDir: "docs/tasks", type: "task", patterns: [/task/i, /todo/i, /work item/i] },
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
}).prefault({});

const frontMatterSchema = z.object({
  id: z.string().min(1),
  type: z.enum(docTypes),
  status: z.string().min(1),
  title: z.string().min(1),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  owners: z.array(z.string()),
  relations: relationSchema,
}).passthrough();

function configFor(type: string): DocConfig {
  if (!docTypes.includes(type as DocType)) throw new Error(`Unknown document type: ${type}`);
  return configs[type as DocType];
}

const GENERATED_INDEX_MARKER = "<!-- doc-suite:generated-index -->";

function canonicalRootDir(cwd: string, type: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, undefined, config.dirs, config.dir);
}

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name.trim());
  const stem = base.replace(/\.md$/i, "");
  if (!stem) throw new Error("Invalid filename: empty after removing .md extension");
  return `${stem}.md`;
}

function docDir(cwd: string, type: string, explicitDir?: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, explicitDir, config.dirs, config.dir);
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

function indexCell(value: string): string {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isGeneratedIndex(content: string, legacyTitle?: string): boolean {
  if (content.includes(GENERATED_INDEX_MARKER)) return true;
  return Boolean(legacyTitle)
    && content.startsWith(`# ${legacyTitle}`)
    && /Directory: `/.test(content);
}

function isForeignDocType(typeValue: unknown, expected: string, relativeDir: string): boolean {
  if (typeof typeValue !== "string" || typeValue === expected) return false;
  if (!(docTypes as readonly string[]).includes(typeValue)) return false;
  const normalized = normalizeDir(relativeDir);
  return configFor(typeValue).dirs.map((dir) => normalizeDir(dir)).includes(normalized);
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

function completeRelations(input?: RelationInput): Record<RelationField, string[]> {
  return Object.fromEntries(relationFields.map((field) => [field, input?.[field] || []])) as Record<RelationField, string[]>;
}

function frontMatter(config: DocConfig, id: string, title: string, status: string, date: string, relations?: RelationInput, metadata?: MetadataInput): string {
  if (!config.statusValues.includes(status)) {
    throw new Error(`Invalid ${config.type} status: ${status} (expected one of: ${config.statusValues.join(", ")})`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
  }
  const complete = completeRelations(relations);
  const changes = completeChanges(relations?.changes);
  return [
    "---",
    `id: ${quote(id)}`,
    `type: ${quote(config.type)}`,
    `status: ${quote(status)}`,
    `title: ${quote(sanitizeTitle(title))}`,
    `created: ${quote(date)}`,
    `updated: ${quote(date)}`,
    "owners: []",
    "relations:",
    formatRelationBlock("source", complete.source),
    ...formatChangesBlock(changes),
    ...relationFields.filter((field) => field !== "source").map((field) => formatRelationBlock(field, complete[field])),
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
      "<!-- Intentionally deferred future work. Link the deferred draft doc via relations.defers. -->",
      "",
      "- <!-- concern | reason | re-engagement trigger | risk if ignored -->",
    ].join("\n");
  }
  if (type === "plan") {
    return [
      `# ${title}`,
      "",
      "## Goal",
      "",
      "<!-- Describe the implementation goal. -->",
      "",
      "## Tasks",
      "",
      "- [ ] <!-- implementation slice -->",
      "",
      "## Verification",
      "",
      "- [ ] <!-- command, test, or review step -->",
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
      "<!-- Intentionally deferred future work. Link the deferred draft doc via relations.defers. -->",
      "",
      "- <!-- concern | reason | re-engagement trigger | risk if ignored -->",
      "",
      "## References",
      "",
      "- <!-- linked spec, ADR, and related docs -->",
    ].join("\n");
  }
  if (type === "test-spec") {
    return [
      `# ${title}`,
      "",
      "## Purpose",
      "",
      "<!-- Why this test spec exists: the intent it preserves and when it may be retired. -->",
      "",
      "## Feature",
      "",
      "<!-- The behavior under specification, named like a Gherkin Feature. -->",
      "",
      "## Rules",
      "",
      "- <!-- Rule: an invariant or contract the feature must satisfy -->",
      "",
      "## Examples",
      "",
      "- <!-- Example: a concrete scenario that pins a rule down, optionally in Given/When/Then form -->",
      "",
      "## Guarantees",
      "",
      "- <!-- What a correct implementation must guarantee -->",
      "",
      "## Non-goals",
      "",
      "- <!-- Behavior or coverage this spec deliberately does not verify -->",
      "",
      "## Risk",
      "",
      "- <!-- What is lost or breaks if these guarantees are dropped -->",
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
  return [
    "---",
    'id: "DESIGN-OVERVIEW"',
    'type: "design"',
    'status: "draft"',
    'title: "System Design Overview"',
    `created: "${date}"`,
    `updated: "${date}"`,
    "owners: []",
    "relations:",
    ...relationFields.map((field) => formatRelationBlock(field, [])),
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

async function titleFromDocument(content: string, fallback: string): Promise<string> {
  const parsed = parseDoc(content);
  const data = parsed.data;
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(parsed.body);
  return match?.[1]?.trim() || fallback;
}

async function docEntries(cwd: string, type: string, explicitDir?: string): Promise<DocEntry[]> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const dir = path.join(cwd, relativeDir);
  const entries = await Promise.all(docFiles(dir).map(async (file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = parseDoc(content).data;
    return {
      file,
      id: typeof data.id === "string" ? data.id : null,
      path: `${relativeDir}/${file}`.replace(/\\/g, "/"),
      status: typeof data.status === "string" ? data.status : null,
      title: await titleFromDocument(content, path.basename(file, ".md")),
      type: typeof data.type === "string" ? data.type : null,
    };
  }));
  return entries.filter((entry) => !isForeignDocType(entry.type, type, relativeDir));
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
  const title = `${configFor(type).idPrefix} Documents`;
  const sorted = type === "design" || unionTypes.includes("design")
    ? [...entries].sort((a, b) => {
        if (a.file === "overview.md") return -1;
        if (b.file === "overview.md") return 1;
        return a.file.localeCompare(b.file);
      })
    : entries;
  const header = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
  const rows = sorted.map((entry) =>
    `| ${indexCell(entry.id || "—")} | ${indexCell(entry.title)} | ${indexCell(entry.status || "—")} | [${indexCell(entry.file)}](./${indexCell(entry.file)}) |`,
  );
  const body = rows.length > 0 ? `${header}\n${rows.join("\n")}` : header;
  return `# ${title}\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${body}\n`;
}

function buildGenericIndex(relativeDir: string, title: string): string {
  const dir = relativeDir.replace(/\\/g, "/");
  return `# ${title}\n\nDirectory: \`${dir}\`\n`;
}

function isMarkdownSource(file: string): boolean {
  return file.endsWith(".md") && !isIndexFileName(path.basename(file));
}

function isUnderCanonicalDir(relativeFile: string): boolean {
  const normalized = normalizeDir(relativeFile);
  return canonicalDocDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
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

function routeFor(input: MigrationInput, sourceData: Record<string, unknown>): MigrationRoute {
  if (typeof sourceData.type === "string" && docTypes.includes(sourceData.type as DocType)) {
    const config = configFor(sourceData.type);
    return { targetDir: config.dir, type: config.type, patterns: [] };
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

function plannedMigration(cwd: string, source: string, input: MigrationInput, sourceContent: string, date: string, allocations: Map<string, TargetAllocation>): MigrationPlan {
  const sourceData = matterData(sourceContent);
  const route = routeFor(input, sourceData);
  const targetDir = route.targetDir;
  const { target } = allocateTargetPath(cwd, targetDir, input.title, route.type || "doc", allocations);
  return {
    content: migratedContent(input, route, sourceContent, source, date),
    source,
    target,
    targetDir,
    title: input.title,
    type: route.type,
  };
}

async function migrateDocs(options: MigrationOptions): Promise<MigrationResult> {
  const cwd = path.resolve(options.cwd);
  const fromDirs = (options.from && options.from.length > 0) ? options.from : defaultMigrationSources(cwd);
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
        migrations.push(plannedMigration(cwd, relativeFile, input, sourceContent, date, allocations));
      }
    }
  }

  const created: string[] = [];
  if (options.apply) {
    await scaffoldDocsTree(cwd);
    for (const migration of migrations) {
      const targetPath = path.join(cwd, migration.target);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, migration.content, "utf8");
      created.push(migration.target);
    }
    for (const target of scaffoldTargets.filter((item) => item.type)) {
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
    fs.mkdirSync(fullDir, { recursive: true });

    const readmePath = path.join(fullDir, "README.md");
    if (fs.existsSync(readmePath)) continue;

    const content = target.type
      ? await renderManagedIndex(resolvedCwd, target.dir, target.type)
      : buildGenericIndex(target.dir, target.title);
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

async function createDocument(type: DocType, options: CreateDocumentOptions): Promise<{ file: string; index: string; indexWritten: boolean; indexSkippedReason: "hand-curated" | "disabled" | null; relativeDir: string }> {
  const config = configFor(type);
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
  if (isReservedDocFile(type, filename)) throw new Error(`Cannot create document with reserved filename: ${filename}`);
  const outputPath = path.join(fullDir, filename);
  if (fs.existsSync(outputPath)) throw new Error(`Document already exists: ${path.relative(cwd, outputPath)}`);

  const date = options.date || new Date().toISOString().slice(0, 10);
  const status = options.status || config.defaultStatus;
  const content = `${frontMatter(config, generateArtifactId(config.idPrefix), title, status, date, options.relations)}\n\n${bodyFor(type, title)}\n`;
  fs.writeFileSync(outputPath, content, "utf8");

  if (type === "design") ensureDesignOverview(path.join(cwd, rootDir), date);

  const indexRelativeDir = underRoot ? rootDir : relativeDir;
  const indexResult = await writeGeneratedIndex(cwd, type, indexRelativeDir, options);

  return {
    file: path.relative(cwd, outputPath).replace(/\\/g, "/"),
    index: indexResult.path,
    indexWritten: indexResult.written,
    indexSkippedReason: indexResult.reason,
    relativeDir,
  };
}

function logIndexResult(result: { index: string; indexWritten: boolean; indexSkippedReason: "hand-curated" | "disabled" | null }): void {
  if (result.indexWritten) {
    console.log(`Updated ${result.index}`);
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

function resolveDocumentReference(cwd: string, target: string, fromDir?: string): string | null {
  for (const base of fromDir ? [fromDir, cwd] : [cwd]) {
    const candidate = path.resolve(base, target);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const type of docTypes) {
    for (const dirName of configs[type].dirs) {
      const dir = path.join(cwd, dirName);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const file of docFiles(dir)) {
        const fullPath = path.join(dir, file);
        const parsed = parseDoc(fs.readFileSync(fullPath, "utf8"));
        if (!parsed.error && parsed.data.id === target) return fullPath;
      }
    }
  }
  return null;
}

export {
  buildIndex,
  buildGenericIndex,
  configFor,
  createDocument,
  docEntries,
  docFiles,
  docTypes,
  GENERATED_INDEX_MARKER,
  indexCell,
  isForeignDocType,
  isGeneratedIndex,
  parseDoc,
  primaryIndexTypeForDir,
  relationValues,
  resolveDocumentReference,
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

export type { DocType };
