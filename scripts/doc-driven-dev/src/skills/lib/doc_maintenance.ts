"use strict";

import fs from "node:fs";
import path from "node:path";

import { collectFindings, docDir } from "./doc_report";
import type { DocStatusQuery } from "./doc_report";
import { lintScope } from "./doc_lint";
import type { DocumentRepository, Finding } from "./doc_repository";
import { buildIndex, isGeneratedIndex } from "./doc_suite_utils";
import { isIndexFileName, normalizeDir } from "./document_utils";

// ---------------------------------------------------------------------------
// Safe repair whitelist
// ---------------------------------------------------------------------------

// Rule IDs resolved by deterministic index regeneration.
const INDEX_REBUILD_RULES = new Set([
  "missing-index",
  "index-missing-entry",
  "index-missing-overview",
  "index-stale-entry",
  "index-duplicate-entry",
  "index-metadata-mismatch",
  "index-ordering",
  "index-unparseable",
  "index-escapes-root",
  "orphan-index",
]);

// Rule IDs resolved by unambiguous path normalization.
const LINK_CASE_RULES = new Set(["link-case-mismatch"]);

type RepairKind = "rebuild-index" | "fix-link-case";

type PlannedAction = {
  kind: RepairKind;
  path: string;
  ruleIds: string[];
  detail: string;
  scopeType?: string;
  scopeDir?: string;
  linkTarget?: string;
  linkLine?: number;
};

type SkippedFinding = {
  ruleId: string;
  category: string;
  path: string | null;
  reason: "manual" | "migration" | "hand-curated-index";
  message: string;
};

type MaintenancePlan = {
  types: string[];
  directories: string[];
  actions: PlannedAction[];
  skipped: SkippedFinding[];
};

type ApplyOptions = {
  forceIndex?: boolean;
};

type ApplyReport = {
  applied: PlannedAction[];
  skipped: SkippedFinding[];
  blocked: { action: PlannedAction; reason: string }[];
  findingsBefore: number;
  findingsAfter: number;
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function scopeIndexPath(model: DocumentRepository, directory: string): string | null {
  const candidates = model.files
    .filter((file) => normalizeDir(path.posix.dirname(file.path)) === directory)
    .map((file) => path.posix.basename(file.path))
    .filter((base) => isIndexFileName(base));
  const readme = candidates.find((base) => /^readme\.md$/i.test(base));
  const chosen = readme ?? candidates.sort()[0];
  return chosen ? `${directory}/${chosen}` : null;
}

async function planMaintenance(cwd: string, query: DocStatusQuery, options?: ApplyOptions): Promise<{ plan: MaintenancePlan; findings: Finding[]; model: DocumentRepository }> {
  const resolvedCwd = path.resolve(cwd);
  const collected = await collectFindings(resolvedCwd, query);
  const actions: PlannedAction[] = [];
  const skipped: SkippedFinding[] = [];
  const consumed = new Set<Finding>();
  const directories: string[] = [];

  for (const type of collected.types) {
    const directory = docDir(resolvedCwd, type, query.dir);
    directories.push(directory);
    const scopeFindings = lintScope(collected.model, type, directory);
    const indexPath = scopeIndexPath(collected.model, directory) ?? `${directory}/README.md`;
    const indexAbsolute = path.join(resolvedCwd, indexPath);
    const indexExists = fs.existsSync(indexAbsolute);
    const indexGenerated = !indexExists || isGeneratedIndex(fs.readFileSync(indexAbsolute, "utf8"));

    const indexFindings = scopeFindings.filter((finding) => INDEX_REBUILD_RULES.has(finding.ruleId));
    if (indexFindings.length > 0) {
      if (indexGenerated || options?.forceIndex) {
        actions.push({
          kind: "rebuild-index",
          path: indexPath,
          scopeType: type,
          scopeDir: directory,
          ruleIds: [...new Set(indexFindings.map((finding) => finding.ruleId))].sort(),
          detail: indexExists
            ? `Regenerate managed index ${indexPath} for type ${type}`
            : `Create generated index ${indexPath} for type ${type}`,
        });
        for (const finding of indexFindings) consumed.add(finding);
      } else {
        for (const finding of indexFindings) {
          consumed.add(finding);
          skipped.push({
            ruleId: finding.ruleId,
            category: finding.category,
            path: finding.path ?? indexPath,
            reason: "hand-curated-index",
            message: `${finding.message} (index ${indexPath} is hand-curated; rerun with --force-index to regenerate)`,
          });
        }
      }
    }

    for (const finding of scopeFindings) {
      if (consumed.has(finding)) continue;
      if (LINK_CASE_RULES.has(finding.ruleId) && finding.path && finding.target) {
        actions.push({
          kind: "fix-link-case",
          path: finding.path,
          linkTarget: finding.target,
          linkLine: finding.line ?? undefined,
          ruleIds: [finding.ruleId],
          detail: `Normalize link target case in ${finding.path}: ${finding.target}`,
        });
        consumed.add(finding);
        continue;
      }
      skipped.push({
        ruleId: finding.ruleId,
        category: finding.category,
        path: finding.path,
        reason: finding.repair === "migration" ? "migration" : "manual",
        message: finding.message,
      });
    }
  }

  return { plan: { types: collected.types, directories, actions, skipped }, findings: collected.findings, model: collected.model };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function actualEntryName(absolute: string): string | null {
  const dir = path.dirname(absolute);
  const base = path.basename(absolute).toLowerCase();
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).find((entry) => entry.toLowerCase() === base) ?? null;
}

function applyLinkCaseFix(cwd: string, action: PlannedAction, model: DocumentRepository): boolean {
  if (!action.linkTarget) return false;
  const document = model.byPath.get(action.path);
  if (!document) return false;

  const resolved = model.resolvePath(document, action.linkTarget);
  if (resolved.status !== "resolved" || !resolved.path) return false;
  const actual = actualEntryName(path.resolve(cwd, resolved.path));
  if (!actual) return false;

  const pathname = action.linkTarget.split("#")[0].split("?")[0];
  const suffix = action.linkTarget.slice(pathname.length);
  const dirPart = pathname.includes("/") ? pathname.slice(0, pathname.lastIndexOf("/") + 1) : "";
  const fixed = `${dirPart}${actual}${suffix}`;
  if (fixed === action.linkTarget) return false;

  const full = path.join(cwd, action.path);
  const lines = fs.readFileSync(full, "utf8").split("\n");
  let lineIndex = (action.linkLine ?? 0) - 1;
  if (lineIndex < 0 || lineIndex >= lines.length || !lines[lineIndex].includes(`(${action.linkTarget})`)) {
    lineIndex = lines.findIndex((line) => line.includes(`(${action.linkTarget})`));
  }
  if (lineIndex < 0) return false;
  const updated = lines[lineIndex].replace(`(${action.linkTarget})`, `(${fixed})`);
  if (updated === lines[lineIndex]) return false;
  lines[lineIndex] = updated;
  fs.writeFileSync(full, lines.join("\n"), "utf8");
  return true;
}

async function applyMaintenance(cwd: string, query: DocStatusQuery, options?: ApplyOptions): Promise<ApplyReport> {
  const resolvedCwd = path.resolve(cwd);
  const { plan, findings, model } = await planMaintenance(resolvedCwd, query, options);
  const applied: PlannedAction[] = [];
  const blocked: { action: PlannedAction; reason: string }[] = [];

  for (const action of plan.actions) {
    if (action.kind === "rebuild-index") {
      if (!action.scopeType || !action.scopeDir) {
        blocked.push({ action, reason: "unresolvable index scope" });
        continue;
      }
      const absolute = path.join(resolvedCwd, action.path);
      if (fs.existsSync(absolute) && !options?.forceIndex && !isGeneratedIndex(fs.readFileSync(absolute, "utf8"))) {
        blocked.push({ action, reason: "hand-curated index" });
        continue;
      }
      const content = await buildIndex(resolvedCwd, action.scopeType, action.scopeDir);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
      applied.push(action);
      continue;
    }
    if (action.kind === "fix-link-case") {
      if (applyLinkCaseFix(resolvedCwd, action, model)) {
        applied.push(action);
      } else {
        blocked.push({ action, reason: "link target no longer resolvable for normalization" });
      }
      continue;
    }
    blocked.push({ action, reason: `unsupported repair kind ${action.kind}` });
  }

  const after = await collectFindings(resolvedCwd, query);
  return {
    applied,
    skipped: plan.skipped,
    blocked,
    findingsBefore: findings.length,
    findingsAfter: after.findings.length,
  };
}

export { applyMaintenance, planMaintenance, INDEX_REBUILD_RULES, LINK_CASE_RULES };
export type { ApplyOptions, ApplyReport, MaintenancePlan, PlannedAction, SkippedFinding };
