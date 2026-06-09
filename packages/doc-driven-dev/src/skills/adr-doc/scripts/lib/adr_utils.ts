"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");
const { z } = require("zod");
const {
  detectNaming: sharedDetectNaming,
  findDocumentDir,
  listMarkdownFiles,
  nextNumber: sharedNextNumber,
  slugify: sharedSlugify,
} = require("../../../lib/document_utils.ts");

const candidateDirs = ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"] as const;
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

type RelationField = typeof relationFields[number];
type NamingMode = "numbered" | "slug";

type AdrEntry = {
  file: string;
  path: string;
  title: string;
  status: string | null;
  date: string | null;
  relations: Record<RelationField, string[]>;
};

type FrontMatterIssue = {
  message: string;
  path: string;
};

type MarkdownNode = {
  checked?: boolean | null;
  children?: MarkdownNode[];
  depth?: number;
  position?: {
    end?: { line?: number };
    start?: { line?: number };
  };
  type?: string;
  url?: string;
  value?: string;
};

type MarkdownLink = {
  url: string;
};

const relationSchema = z.object(Object.fromEntries(
  relationFields.map((field) => [field, z.array(z.string()).default([])]),
)).default({});

const adrFrontMatterSchema = z.object({
  status: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  "decision-makers": z.array(z.string()),
  consulted: z.array(z.string()),
  informed: z.array(z.string()),
  relations: relationSchema,
}).passthrough();

function findAdrDir(cwd: string, explicitDir?: string): string {
  return findDocumentDir(cwd, explicitDir, candidateDirs, "docs/adr");
}

function adrFiles(dir: string): string[] {
  return listMarkdownFiles(dir);
}

function detectNaming(files: string[]): NamingMode {
  return sharedDetectNaming(files);
}

function nextNumber(files: string[]): number {
  return sharedNextNumber(files);
}

function slugify(title: string): string {
  return sharedSlugify(title, "decision");
}

let markdownModules: Promise<{ unified: Function; remarkParse: unknown; visit: Function }> | null = null;

async function loadMarkdownModules(): Promise<{ unified: Function; remarkParse: unknown; visit: Function }> {
  if (!markdownModules) {
    markdownModules = Promise.all([
      import("unified"),
      import("remark-parse"),
      import("unist-util-visit"),
    ]).then(([unifiedModule, remarkParseModule, visitModule]) => ({
      unified: unifiedModule.unified,
      remarkParse: (remarkParseModule as { default?: unknown }).default || remarkParseModule,
      visit: visitModule.visit,
    }));
  }
  return markdownModules;
}

async function markdownAst(content: string): Promise<MarkdownNode> {
  const { unified, remarkParse } = await loadMarkdownModules();
  return unified().use(remarkParse).parse(matter(content).content) as MarkdownNode;
}

function textFromNode(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children || []).map(textFromNode).join("");
}

function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function headingNodes(content: string): Promise<MarkdownNode[]> {
  const tree = await markdownAst(content);
  const { visit } = await loadMarkdownModules();
  const headings: MarkdownNode[] = [];
  visit(tree, "heading", (node: MarkdownNode) => {
    headings.push(node);
  });
  return headings;
}

async function hasSection(content: string, section: string): Promise<boolean> {
  const target = normalizeHeading(section);
  return (await headingNodes(content)).some((heading) => normalizeHeading(textFromNode(heading)) === target);
}

async function sectionBody(content: string, section: string): Promise<string> {
  const parsed = matter(content).content;
  const lines = parsed.split(/\r?\n/);
  const target = normalizeHeading(section);
  const headings = await headingNodes(content);
  const start = headings.find((heading) => normalizeHeading(textFromNode(heading)) === target);
  if (!start || typeof start.depth !== "number" || !start.position?.end?.line) return "";

  const next = headings.find((heading) => {
    const startLine = heading.position?.start?.line;
    return Boolean(
      startLine &&
      start.position?.start?.line &&
      startLine > start.position.start.line &&
      typeof heading.depth === "number" &&
      heading.depth <= start.depth!,
    );
  });
  const startIndex = start.position.end.line;
  const endIndex = next?.position?.start?.line ? next.position.start.line - 1 : lines.length;
  return lines.slice(startIndex, endIndex).join("\n").trim();
}

async function titleFromAdr(content: string, fallback: string): Promise<string> {
  const firstHeading = (await headingNodes(content)).find((heading) => heading.depth === 1);
  if (!firstHeading) return fallback;
  return textFromNode(firstHeading).replace(/^\d+\.\s*/, "").trim() || fallback;
}

function isLocalLink(url: string): boolean {
  return url.startsWith("./") || url.startsWith("../") || url.startsWith("/");
}

function stripAnchor(url: string): string {
  return url.split("#")[0];
}

async function markdownLinks(content: string): Promise<MarkdownLink[]> {
  const tree = await markdownAst(content);
  const { visit } = await loadMarkdownModules();
  const links: MarkdownLink[] = [];
  visit(tree, ["link", "definition"], (node: MarkdownNode) => {
    if (node.url && isLocalLink(node.url)) links.push({ url: stripAnchor(node.url) });
  });
  return links;
}

async function referencedPaths(content: string): Promise<string[]> {
  const tree = await markdownAst(content);
  const { visit } = await loadMarkdownModules();
  const paths = new Set<string>();
  visit(tree, ["inlineCode", "link", "definition"], (node: MarkdownNode) => {
    const candidates = [node.value, node.url].filter((value): value is string => typeof value === "string");
    for (const candidate of candidates) {
      const value = stripAnchor(candidate.trim());
      if (!/^https?:\/\//i.test(value) && (/\.[A-Za-z0-9]+$/.test(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith("/"))) {
        paths.add(value);
      }
    }
  });
  return [...paths];
}

function matterData(content: string): Record<string, unknown> {
  return matter(content).data || {};
}

function formatIssuePath(pathParts: Array<string | number>): string {
  return pathParts.length === 0 ? "$" : pathParts.map((part) => String(part)).join(".");
}

function validateFrontMatterWithZod(data: Record<string, unknown>): FrontMatterIssue[] {
  const result = adrFrontMatterSchema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue: { message: string; path: Array<string | number> }) => ({
    message: issue.message,
    path: formatIssuePath(issue.path),
  }));
}

function validateFrontMatter(content: string): FrontMatterIssue[] {
  const data = matterData(content);
  return validateFrontMatterWithZod(data);
}

function relationMap(content: string): Record<RelationField, string[]> {
  const data = matterData(content);
  const relations = data.relations;
  const result = Object.fromEntries(relationFields.map((field) => [field, []])) as Record<RelationField, string[]>;
  if (!relations || typeof relations !== "object" || Array.isArray(relations)) return result;
  const raw = relations as Record<string, unknown>;
  for (const field of relationFields) {
    const value = raw[field];
    if (Array.isArray(value)) result[field] = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
    else if (typeof value === "string" && value.trim()) result[field] = [value.trim()];
  }
  return result;
}

function relationLinks(content: string): { field: RelationField; target: string }[] {
  return relationFields.flatMap((field) => relationMap(content)[field].map((target) => ({ field, target })));
}

async function adrEntries(cwd: string, relativeDir: string): Promise<AdrEntry[]> {
  const dir = path.join(cwd, relativeDir);
  return Promise.all(adrFiles(dir).map(async (file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = matterData(content);
    return {
      file,
      path: `${relativeDir}/${file}`.replace(/\\/g, "/"),
      title: await titleFromAdr(content, path.basename(file, ".md")),
      status: typeof data.status === "string" ? data.status : null,
      date: typeof data.date === "string" ? data.date : null,
      relations: relationMap(content),
    };
  }));
}

async function buildIndex(dir: string, relativeDir: string): Promise<string> {
  const entries = await Promise.all(adrFiles(dir).map(async (file) => {
    const title = await titleFromAdr(fs.readFileSync(path.join(dir, file), "utf8"), path.basename(file, ".md"));
    return `- [${title}](./${file})`;
  }));
  return `# Architecture Decision Records\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${entries.join("\n")}\n`;
}

function parseCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

module.exports = {
  adrEntries,
  adrFiles,
  buildIndex,
  candidateDirs,
  detectNaming,
  findAdrDir,
  hasSection,
  markdownLinks,
  matterData,
  nextNumber,
  parseCsv,
  referencedPaths,
  relationFields,
  relationLinks,
  relationMap,
  sectionBody,
  slugify,
  titleFromAdr,
  validateFrontMatter,
  validateFrontMatterWithZod,
};
