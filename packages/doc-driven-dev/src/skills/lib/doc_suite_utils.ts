"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");
const { z } = require("zod");
const {
  detectNaming,
  findDocumentDir,
  listMarkdownFiles,
  nextNumber,
  normalizeDir,
  slugify,
} = require("./document_utils.ts");

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
] as const;

const changeFields = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "moved",
  "generated",
] as const;

const docTypes = ["idea", "brainstorm", "spec", "plan", "task", "design"] as const;

type DocType = typeof docTypes[number];
type RelationField = typeof relationFields[number];
type ChangeField = typeof changeFields[number];
type Severity = "error" | "warning" | "info";

type Finding = {
  code: string;
  file: string | null;
  message: string;
  severity: Severity;
};

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

type CreateDocumentOptions = {
  cwd: string;
  date?: string;
  dir?: string;
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

const configs: Record<DocType, DocConfig> = {
  idea: {
    defaultStatus: "exploring",
    dir: "docs/ideas",
    dirs: ["docs/ideas"],
    idPrefix: "IDEA",
    statusValues: ["exploring", "refined", "parked", "rejected", "superseded"],
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
  design: {
    defaultStatus: "draft",
    dir: "docs/designs",
    dirs: ["docs/designs", "docs/design", "designs", "design"],
    idPrefix: "DESIGN",
    statusValues: ["draft", "approved", "superseded", "rejected"],
    type: "design",
  },
};

const changeEntrySchema = z.object({
  type: z.string().min(1),
}).passthrough();

const changesSchema = z.object(Object.fromEntries(
  changeFields.map((field) => [field, z.array(changeEntrySchema).default([])]),
)).default({});

const relationSchema = z.object({
  ...Object.fromEntries(relationFields.map((field) => [field, z.array(z.string()).default([])])),
  changes: changesSchema,
}).default({});

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

function docDir(cwd: string, type: string, explicitDir?: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, explicitDir, config.dirs, config.dir);
}

function docFiles(dir: string): string[] {
  return listMarkdownFiles(dir);
}

function isExternalLink(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

function matterData(content: string): Record<string, unknown> {
  return matter(content).data || {};
}

function formatIssuePath(pathParts: Array<string | number>): string {
  return pathParts.length === 0 ? "$" : pathParts.map((part) => String(part)).join(".");
}

function validateFrontMatter(content: string): { message: string; path: string }[] {
  const result = frontMatterSchema.safeParse(matterData(content));
  if (result.success) return [];
  return result.error.issues.map((issue: { message: string; path: Array<string | number> }) => ({
    message: issue.message,
    path: formatIssuePath(issue.path),
  }));
}

function relationMap(content: string): Record<RelationField, string[]> {
  const data = matterData(content);
  const rawRelations = data.relations;
  const result = Object.fromEntries(relationFields.map((field) => [field, []])) as Record<RelationField, string[]>;
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

function relationLinks(content: string): { field: RelationField; target: string }[] {
  const relations = relationMap(content);
  return relationFields.flatMap((field) => relations[field].map((target) => ({ field, target })));
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
        ...entries.flatMap((entry) => [
          "      - " + formatChangeEntry(entry)[0],
          ...formatChangeEntry(entry).slice(1).map((line) => `        ${line}`),
        ]),
      ];
    }),
  ];
}

function completeRelations(input?: RelationInput): Record<RelationField, string[]> {
  return Object.fromEntries(relationFields.map((field) => [field, input?.[field] || []])) as Record<RelationField, string[]>;
}

function frontMatter(config: DocConfig, number: number, title: string, status: string, date: string, relations?: RelationInput): string {
  const complete = completeRelations(relations);
  const changes = completeChanges(relations?.changes);
  return [
    "---",
    `id: "${config.idPrefix}-${String(number).padStart(4, "0")}"`,
    `type: "${config.type}"`,
    `status: "${status}"`,
    `title: ${quote(title)}`,
    `created: "${date}"`,
    `updated: "${date}"`,
    "owners: []",
    "relations:",
    formatRelationBlock("source", complete.source),
    ...formatChangesBlock(changes),
    ...relationFields.filter((field) => field !== "source").map((field) => formatRelationBlock(field, complete[field])),
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
      "## Raw Idea",
      "",
      "<!-- Capture the initial idea without over-polishing it. -->",
      "",
      "## Problem Signals",
      "",
      "- <!-- observed pain, opportunity, or trigger -->",
      "",
      "## Refined Options",
      "",
      "- <!-- option and trade-off -->",
      "",
      "## Assumptions",
      "",
      "- <!-- assumption to validate -->",
      "",
      "## Next Questions",
      "",
      "- <!-- question for brainstorming, ADR, spec, or planning route -->",
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
    "- <!-- link detailed docs under docs/designs/0001-*.md -->",
    "",
  ].join("\n");
}

function ensureDesignOverview(fullDir: string, date: string): void {
  const overviewPath = path.join(fullDir, "overview.md");
  if (fs.existsSync(overviewPath)) return;
  fs.writeFileSync(overviewPath, overviewDocument(date), "utf8");
}

async function titleFromDocument(content: string, fallback: string): Promise<string> {
  const data = matterData(content);
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(matter(content).content);
  return match?.[1]?.trim() || fallback;
}

async function docEntries(cwd: string, type: string, explicitDir?: string): Promise<DocEntry[]> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const dir = path.join(cwd, relativeDir);
  return Promise.all(docFiles(dir).map(async (file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = matterData(content);
    return {
      file,
      id: typeof data.id === "string" ? data.id : null,
      path: `${relativeDir}/${file}`.replace(/\\/g, "/"),
      status: typeof data.status === "string" ? data.status : null,
      title: await titleFromDocument(content, path.basename(file, ".md")),
      type: typeof data.type === "string" ? data.type : null,
    };
  }));
}

async function buildIndex(cwd: string, type: string, explicitDir?: string): Promise<string> {
  const relativeDir = docDir(cwd, type, explicitDir);
  const entries = await docEntries(cwd, type, explicitDir);
  const title = `${configFor(type).idPrefix} Documents`;
  const rows = entries.map((entry) => `- [${entry.id || entry.file}: ${entry.title}](./${entry.file})${entry.status ? ` [${entry.status}]` : ""}`);
  return `# ${title}\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${rows.join("\n")}\n`;
}

async function createDocument(type: DocType, options: CreateDocumentOptions): Promise<{ file: string; index: string; relativeDir: string }> {
  const config = configFor(type);
  const cwd = path.resolve(options.cwd);
  const relativeDir = docDir(cwd, type, options.dir);
  const fullDir = path.join(cwd, relativeDir);
  fs.mkdirSync(fullDir, { recursive: true });

  const files = fs.readdirSync(fullDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => !isReservedDocFile(type, file));
  const number = nextNumber(files);
  const naming = detectNaming(files);
  const filename = naming === "slug" ? `${slugify(options.title, type)}.md` : `${String(number).padStart(4, "0")}-${slugify(options.title, type)}.md`;
  const outputPath = path.join(fullDir, filename);
  if (fs.existsSync(outputPath)) throw new Error(`Document already exists: ${path.relative(cwd, outputPath)}`);

  const date = options.date || new Date().toISOString().slice(0, 10);
  const status = options.status || config.defaultStatus;
  const content = `${frontMatter(config, number, options.title, status, date, options.relations)}\n\n${bodyFor(type, options.title)}\n`;
  fs.writeFileSync(outputPath, content, "utf8");
  if (type === "design") ensureDesignOverview(fullDir, date);
  const index = await buildIndex(cwd, type, relativeDir);
  fs.writeFileSync(path.join(fullDir, "README.md"), index, "utf8");

  return {
    file: path.relative(cwd, outputPath).replace(/\\/g, "/"),
    index: path.relative(cwd, path.join(fullDir, "README.md")).replace(/\\/g, "/"),
    relativeDir,
  };
}

function resolvesLocalTarget(cwd: string, fromFile: string, target: string): boolean {
  const candidates = [
    path.resolve(cwd, target),
    path.resolve(path.dirname(fromFile), target),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

async function auditDocuments(cwd: string, type: string, explicitDir?: string): Promise<{ directory: string; files: number; findings: Finding[] }> {
  const config = configFor(type);
  const relativeDir = docDir(cwd, type, explicitDir);
  const dir = path.join(cwd, relativeDir);
  const files = docFiles(dir);
  const findings: Finding[] = [];

  if (type === "design") {
    const overviewPath = path.join(dir, "overview.md");
    if (!fs.existsSync(overviewPath)) {
      findings.push({
        severity: "error",
        file: null,
        code: "missing-overview",
        message: "Missing required docs/designs/overview.md",
      });
    }
  }

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = matterData(content);
    for (const issue of validateFrontMatter(content)) {
      findings.push({ severity: "error", file, code: "invalid-front-matter", message: `Invalid front matter ${issue.path}: ${issue.message}` });
    }
    if (data.type !== type) {
      findings.push({ severity: "error", file, code: "invalid-type", message: `Expected type ${type}` });
    }
    if (typeof data.status === "string" && !config.statusValues.includes(data.status)) {
      findings.push({ severity: "error", file, code: "invalid-status", message: `Invalid ${type} status: ${data.status}` });
    }
    for (const relation of relationLinks(content)) {
      if (isExternalLink(relation.target)) continue;
      if (!resolvesLocalTarget(cwd, fullPath, relation.target)) {
        findings.push({
          severity: "warning",
          file,
          code: "broken-relation-link",
          message: `Relation ${relation.field} points to missing target: ${relation.target}`,
        });
      }
    }
  }

  const indexPath = ["README.md", "index.md"].map((name) => path.join(dir, name)).find((candidate) => fs.existsSync(candidate));
  if (!indexPath) {
    findings.push({ severity: "warning", file: null, code: "missing-index", message: `Missing ${type} index README.md or index.md` });
  } else {
    const index = fs.readFileSync(indexPath, "utf8");
    for (const file of files) {
      if (!index.includes(file)) findings.push({ severity: "warning", file, code: "index-missing-entry", message: `Index does not link ${file}` });
    }
    if (type === "design" && !index.includes("overview.md")) {
      findings.push({
        severity: "warning",
        file: "overview.md",
        code: "index-missing-overview",
        message: "Index does not link overview.md",
      });
    }
  }

  return { directory: relativeDir, files: files.length, findings };
}

module.exports = {
  auditDocuments,
  buildIndex,
  configFor,
  createDocument,
  docEntries,
  docFiles,
  docTypes,
  relationFields,
  changeFields,
  changesSchema,
  frontMatterSchema,
  relationSchema,
  validateFrontMatter,
};
