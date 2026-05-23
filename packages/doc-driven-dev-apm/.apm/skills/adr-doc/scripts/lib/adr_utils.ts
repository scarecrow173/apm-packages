"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");

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
};
