"use strict";

import fs from "node:fs";
import path from "node:path";

function normalizeDir(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function isIndexFileName(file: string): boolean {
  return /^(readme|index)(\.[a-z0-9_-]+)?\.md$/i.test(file);
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !isIndexFileName(file))
    .sort();
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

export {
  findDocumentDir,
  isIndexFileName,
  listMarkdownFiles,
  normalizeDir,
  slugify,
};