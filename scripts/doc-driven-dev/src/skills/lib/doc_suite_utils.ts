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
  naming: "numbered" | "slug";
  next: number;
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

const scaffoldTargets: ScaffoldTarget[] = [
  { dir: "docs/ideas", title: "IDEA Documents", type: "idea" },
  { dir: "docs/discovery", title: "BRAINSTORM Documents", type: "brainstorm" },
  { dir: "docs/specs", title: "SPEC Documents", type: "spec" },
  { dir: "docs/designs", title: "DESIGN Documents", type: "design" },
  { dir: "docs/plans", title: "PLAN Documents", type: "plan" },
  { dir: "docs/tasks", title: "TASK Documents", type: "task" },
  { dir: "docs/adr", title: "ADR Documents" },
  { dir: "docs/impl/ir", title: "Implementation Record Documents" },
  { dir: "docs/impl/exp", title: "Experiment Log Documents" },
];

const canonicalDocDirs = scaffoldTargets.map((target) => target.dir);

const migrationRoutes: MigrationRoute[] = [
  { targetDir: "docs/ideas", type: "idea", patterns: [/idea/i, /proposal/i] },
  { targetDir: "docs/discovery", type: "brainstorm", patterns: [/discovery/i, /brainstorm/i, /research/i, /brief/i] },
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

function buildGenericIndex(relativeDir: string, title: string): string {
  const dir = relativeDir.replace(/\\/g, "/");
  return `# ${title}\n\nDirectory: \`${dir}\`\n`;
}

function isMarkdownSource(file: string): boolean {
  return file.endsWith(".md") && !/^readme\.md$/i.test(path.basename(file)) && !/^index\.md$/i.test(path.basename(file));
}

function isUnderCanonicalDir(relativeFile: string): boolean {
  const normalized = normalizeDir(relativeFile);
  return canonicalDocDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function walkMarkdownFiles(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
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
  const parsed = matter(content);
  const data = parsed.data || {};
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(parsed.content);
  return match?.[1]?.trim() || fallback;
}

function splitByH1(source: string, content: string): MigrationInput[] {
  const parsed = matter(content);
  const body = parsed.content.trim();
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
    || { targetDir: "docs/discovery", type: "brainstorm", patterns: [] };
}

function targetAllocation(cwd: string, targetDir: string): TargetAllocation {
  const fullTargetDir = path.join(cwd, targetDir);
  const existingFiles = fs.existsSync(fullTargetDir)
    ? fs.readdirSync(fullTargetDir).filter((file) => file.endsWith(".md"))
    : [];
  return {
    existing: new Set(existingFiles),
    naming: detectNaming(existingFiles),
    next: nextNumber(existingFiles),
  };
}

function allocateTargetPath(cwd: string, targetDir: string, title: string, fallback: string, allocations: Map<string, TargetAllocation>): { number: number; target: string } {
  if (!allocations.has(targetDir)) allocations.set(targetDir, targetAllocation(cwd, targetDir));
  const allocation = allocations.get(targetDir) as TargetAllocation;
  const number = allocation.next;
  let baseName = allocation.naming === "slug"
    ? `${slugify(title, fallback)}.md`
    : `${String(number).padStart(4, "0")}-${slugify(title, fallback)}.md`;
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let suffix = 2;
  while (allocation.existing.has(baseName)) {
    baseName = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  allocation.existing.add(baseName);
  if (allocation.naming === "numbered") allocation.next += 1;
  return {
    number,
    target: path.join(targetDir, baseName).replace(/\\/g, "/"),
  };
}

function migratedFrontMatter(type: DocType, number: number, title: string, date: string, source: string): string {
  const config = configFor(type);
  return frontMatter(config, number, title, config.defaultStatus, date, {
    source: [source],
    changes: {
      generated: [{ type: "migration", source }],
    },
  });
}

function migratedContent(input: MigrationInput, route: MigrationRoute, sourceContent: string, source: string, number: number, date: string): string {
  if (route.type) {
    return `${migratedFrontMatter(route.type, number, input.title, date, source)}\n\n${input.body.trim()}\n`;
  }

  const parsed = matter(sourceContent);
  const data = parsed.data || {};
  if (Object.keys(data).length > 0) return `${matter.stringify(input.body.trim(), data).trimEnd()}\n`;
  return `---\ntitle: ${quote(input.title)}\nsource: ${quote(source)}\n---\n\n${input.body.trim()}\n`;
}

function plannedMigration(cwd: string, source: string, input: MigrationInput, sourceContent: string, date: string, allocations: Map<string, TargetAllocation>): MigrationPlan {
  const sourceData = matterData(sourceContent);
  const route = routeFor(input, sourceData);
  const targetDir = route.targetDir;
  const { number, target } = allocateTargetPath(cwd, targetDir, input.title, route.type || "doc", allocations);
  return {
    content: migratedContent(input, route, sourceContent, source, number, date),
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
      const inputs = options.splitH1
        ? splitByH1(relativeFile, sourceContent)
        : [{
          source: relativeFile,
          title: headingTitle(sourceContent, path.basename(relativeFile, ".md")),
          body: matter(sourceContent).content.trim(),
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
      const index = await buildIndex(cwd, target.type, target.dir);
      fs.writeFileSync(path.join(cwd, target.dir, "README.md"), index, "utf8");
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
      ? await buildIndex(resolvedCwd, target.type, target.dir)
      : buildGenericIndex(target.dir, target.title);
    fs.writeFileSync(readmePath, content, "utf8");
    created.push(path.relative(resolvedCwd, readmePath).replace(/\\/g, "/"));
  }

  return { created, updated };
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
  buildGenericIndex,
  configFor,
  createDocument,
  docEntries,
  docFiles,
  docTypes,
  migrateDocs,
  relationFields,
  changeFields,
  changesSchema,
  frontMatterSchema,
  relationSchema,
  scaffoldDocsTree,
  validateFrontMatter,
};
