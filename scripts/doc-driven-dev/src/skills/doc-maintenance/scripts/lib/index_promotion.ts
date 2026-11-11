"use strict";

import fs from "node:fs";
import path from "node:path";

import { DIRECTORY_CONTRACTS } from "../../../lib/doc_ownership";
import { GENERATED_INDEX_MARKER, legacyScaffoldIndex } from "../../../lib/doc_suite_utils";
import { normalizeDir, resolveContainedDir } from "../../../lib/document_utils";
import { buildIndex as buildAdrIndex, writeIndexFile } from "../../../adr-doc/scripts/lib/adr_utils";
import { updateIndexForExperimentDir, updateIndexForMarkdownDir } from "../../../impl-doc/scripts/lib/impl_doc_utils";

type PromotionVerdict = "promote" | "rejected" | "noop-managed" | "noop-missing";

type IndexPromotion = {
  dir: string;
  path: string;
  verdict: PromotionVerdict;
  detail: string;
};

// Only canonical dirs with a contract index title can host a scaffold-era
// generic README (scaffold never writes aliases). The owner writer decides
// what "managed" means; this module only decides what legacy scaffold output
// looked like and delegates regeneration to the owner.
const PROMOTABLE_DIRS = DIRECTORY_CONTRACTS
  .filter((row) => row.canonical && row.indexTitle)
  .map((row) => row.dir)
  .sort();

function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function classify(cwd: string, dir: string): IndexPromotion {
  const relativeIndex = `${dir}/README.md`;
  const absoluteIndex = path.join(cwd, relativeIndex);
  if (!fs.existsSync(absoluteIndex)) {
    return { dir, path: relativeIndex, verdict: "noop-missing", detail: "no index file present" };
  }
  // A symlinked index is never written through — the same boundary
  // id_migration enforces — even if its target byte-matches the template.
  if (fs.lstatSync(absoluteIndex).isSymbolicLink()) {
    return { dir, path: relativeIndex, verdict: "rejected", detail: "index file is a symbolic link; refusing to write through it" };
  }
  const content = fs.readFileSync(absoluteIndex, "utf8");
  if (content.includes(GENERATED_INDEX_MARKER)) {
    return { dir, path: relativeIndex, verdict: "noop-managed", detail: "already a managed index" };
  }
  const legacy = legacyScaffoldIndex(dir);
  if (legacy !== null && normalizeEol(content) === normalizeEol(legacy)) {
    return { dir, path: relativeIndex, verdict: "promote", detail: "byte-identical to the legacy scaffold index" };
  }
  return {
    dir,
    path: relativeIndex,
    verdict: "rejected",
    detail: "hand-curated or modified; not byte-identical to the legacy scaffold index",
  };
}

function resolveDirs(cwd: string, onlyDir?: string): string[] {
  if (!onlyDir) return PROMOTABLE_DIRS;
  const normalized = normalizeDir(resolveContainedDir(cwd, onlyDir));
  if (!PROMOTABLE_DIRS.includes(normalized)) {
    throw new Error(`Index promotion is only defined for scaffolded owner indexes: ${PROMOTABLE_DIRS.join(", ")}`);
  }
  return [normalized];
}

async function planIndexPromotions(cwd: string, onlyDir?: string): Promise<IndexPromotion[]> {
  const resolvedCwd = path.resolve(cwd);
  return resolveDirs(resolvedCwd, onlyDir).map((dir) => classify(resolvedCwd, dir));
}

// Regenerate through the owning writer. Each call re-classifies first, so
// force is only ever exercised on content that byte-matched the legacy
// scaffold output moments earlier (Issue #184).
async function applyIndexPromotions(cwd: string, onlyDir?: string): Promise<IndexPromotion[]> {
  const resolvedCwd = path.resolve(cwd);
  const results: IndexPromotion[] = [];
  for (const dir of resolveDirs(resolvedCwd, onlyDir)) {
    const verdict = classify(resolvedCwd, dir);
    if (verdict.verdict !== "promote") {
      results.push(verdict);
      continue;
    }
    let written: boolean;
    if (dir === "docs/adr") {
      const absoluteDir = path.join(resolvedCwd, dir);
      written = writeIndexFile(absoluteDir, await buildAdrIndex(resolvedCwd, dir), true).written;
    } else if (dir === "docs/impl/ir") {
      written = updateIndexForMarkdownDir(resolvedCwd, dir, { force: true }).written;
    } else if (dir === "docs/impl/exp") {
      written = updateIndexForExperimentDir(resolvedCwd, dir, { force: true }).written;
    } else {
      throw new Error(`No owner writer registered for promoted dir ${dir}`);
    }
    if (!written) throw new Error(`Owner writer refused the promoted index for ${dir}`);
    results.push({ ...verdict, detail: "promoted to the owner-managed index" });
  }
  return results;
}

export { applyIndexPromotions, planIndexPromotions, PROMOTABLE_DIRS };
export type { IndexPromotion, PromotionVerdict };
