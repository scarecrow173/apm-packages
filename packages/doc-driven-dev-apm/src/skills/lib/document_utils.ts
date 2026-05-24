"use strict";

const fs = require("node:fs");
const path = require("node:path");

type NamingMode = "numbered" | "slug";

function normalizeDir(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))
    .sort();
}

function detectNaming(files: string[]): NamingMode {
  if (files.some((file) => /^\d{4}-.+\.md$/.test(file))) return "numbered";
  if (files.some((file) => /^[a-z0-9][a-z0-9-]+\.md$/.test(file))) return "slug";
  return "numbered";
}

function nextNumber(files: string[]): number {
  const numbers = files
    .map((file) => /^(\d{4})-.+\.md$/.exec(file))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

function slugify(title: string, fallback: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function findDocumentDir(cwd: string, explicitDir: string | undefined, candidateDirs: readonly string[], defaultDir: string): string {
  if (explicitDir) return normalizeDir(explicitDir);
  const existing = candidateDirs.filter((candidate) => fs.existsSync(path.join(cwd, candidate)));
  return existing.length === 0 ? defaultDir : existing[0];
}

module.exports = {
  detectNaming,
  findDocumentDir,
  listMarkdownFiles,
  nextNumber,
  normalizeDir,
  slugify,
};