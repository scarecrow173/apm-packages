"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const matter = require("gray-matter");
const { z } = require("zod");

const candidateDirs = ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"] as const;
const relationFields = ["supersedes", "superseded-by", "related", "refines"] as const;

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

const relationSchema = z.object({
  supersedes: z.array(z.string()).default([]),
  "superseded-by": z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  refines: z.array(z.string()).default([]),
}).default({});

const adrFrontMatterSchema = z.object({
  status: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  "decision-makers": z.array(z.string()),
  consulted: z.array(z.string()),
  informed: z.array(z.string()),
  relations: relationSchema,
}).passthrough();

const adrFrontMatterJsonSchema = {
  type: "object",
  required: ["status", "date", "decision-makers", "consulted", "informed"],
  properties: {
    status: { type: "string", minLength: 1 },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    "decision-makers": { type: "array", items: { type: "string" } },
    consulted: { type: "array", items: { type: "string" } },
    informed: { type: "array", items: { type: "string" } },
    relations: {
      type: "object",
      properties: {
        supersedes: { type: "array", items: { type: "string" } },
        "superseded-by": { type: "array", items: { type: "string" } },
        related: { type: "array", items: { type: "string" } },
        refines: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: true,
} as const;

const ajv = new Ajv({ allErrors: true });
const validateFrontMatterAjv = ajv.compile(adrFrontMatterJsonSchema);

function normalizeDir(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function findAdrDir(cwd: string, explicitDir?: string): string {
  if (explicitDir) return normalizeDir(explicitDir);
  const existing = candidateDirs.filter((candidate) => fs.existsSync(path.join(cwd, candidate)));
  if (existing.length === 0) return "docs/adr";
  return existing
    .map((candidate, index) => ({ candidate, index, score: scoreDir(path.join(cwd, candidate)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].candidate;
}

function scoreDir(dir: string): number {
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  let score = 1;
  if (files.some((file) => /^\d{4}-.+\.md$/.test(file))) score += 4;
  if (files.includes("README.md") || files.includes("index.md")) score += 3;
  return score;
}

function adrFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))
    .sort();
}

function detectNaming(files: string[]): NamingMode {
  if (files.some((file) => /^\d{4}-.+\.md$/.test(file))) return "numbered";
  if (files.some((file) => /^[a-z0-9][a-z0-9-]+\.md$/.test(file) && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))) {
    return "slug";
  }
  return "numbered";
}

function nextNumber(files: string[]): number {
  const numbers = files
    .map((file) => /^(\d{4})-.+\.md$/.exec(file))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "decision";
}

function hasSection(content: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3}\\s+${escaped}\\s*$`, "mi").test(content);
}

function titleFromAdr(content: string, fallback: string): string {
  const firstHeading = /^#\s+(?:\d+\.\s*)?(.+)$/m.exec(content);
  return firstHeading ? firstHeading[1].trim() : fallback;
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

function validateFrontMatterWithAjv(data: Record<string, unknown>): FrontMatterIssue[] {
  const valid = validateFrontMatterAjv(data);
  if (valid) return [];
  return (validateFrontMatterAjv.errors || []).map((error: { instancePath?: string; message?: string; params?: Record<string, unknown> }) => {
    const missing = typeof error.params?.missingProperty === "string" ? `.${error.params.missingProperty}` : "";
    return {
      message: error.message || "Invalid front matter",
      path: `${error.instancePath || "$"}${missing}`.replace(/^\//, "").replace(/\//g, "."),
    };
  });
}

function validateFrontMatter(content: string): FrontMatterIssue[] {
  const data = matterData(content);
  const byPath = new Map<string, FrontMatterIssue>();
  for (const issue of validateFrontMatterWithZod(data).concat(validateFrontMatterWithAjv(data))) {
    byPath.set(`${issue.path}:${issue.message}`, issue);
  }
  return [...byPath.values()];
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

function adrEntries(cwd: string, relativeDir: string): AdrEntry[] {
  const dir = path.join(cwd, relativeDir);
  return adrFiles(dir).map((file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const data = matterData(content);
    return {
      file,
      path: `${relativeDir}/${file}`.replace(/\\/g, "/"),
      title: titleFromAdr(content, path.basename(file, ".md")),
      status: typeof data.status === "string" ? data.status : null,
      date: typeof data.date === "string" ? data.date : null,
      relations: relationMap(content),
    };
  });
}

function buildIndex(dir: string, relativeDir: string): string {
  const entries = adrFiles(dir).map((file) => {
    const title = titleFromAdr(fs.readFileSync(path.join(dir, file), "utf8"), path.basename(file, ".md"));
    return `- [${title}](./${file})`;
  });
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
  matterData,
  nextNumber,
  parseCsv,
  relationFields,
  relationLinks,
  relationMap,
  slugify,
  titleFromAdr,
  validateFrontMatter,
  validateFrontMatterWithAjv,
  validateFrontMatterWithZod,
};
