"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { generateArtifactId, isLegacyArtifactId, isNewArtifactId } from "../../../lib/artifact_id";
import { auditDocuments } from "../../../lib/doc_audit";
import { configFor, docFiles, docTypes, GENERATED_INDEX_MARKER, parseDoc, residentTypesForDir, writeGeneratedIndex } from "../../../lib/doc_suite_utils";
import { isIndexFileName, normalizeDir } from "../../../lib/document_utils";
import { auditExperimentLogs, auditImplementationRecords, updateIndexForExperimentDir, updateIndexForMarkdownDir } from "../../../impl-doc/scripts/lib/impl_doc_utils";

const IMPL_IR_DIR = "docs/impl/ir";
const IMPL_EXP_DIR = "docs/impl/exp";
const EXPERIMENT_ID_PREFIX = "EXP";
const LOCALE_SUFFIX = /\.[a-z]{2}(-[a-z0-9]+)?$/i;
const NUMBERED_FILE = /^(\d{4,})-(.*)$/;
const LEGACY_ID_TOKEN = /(?<![0-9A-Za-z])[A-Z][A-Z0-9]*-\d+(?![0-9A-Za-z])/g;
const MIGRATE_TMP_SUFFIX = ".migrate-tmp";

type Blocker = {
  code: string;
  file: string | null;
  message: string;
};

type DiscoveredFile = {
  dir: string;
  dirType: string | null;
  id: string | null;
  numberedName: string | null;
  path: string;
  stemKey: string;
  synthesizedId: string | null;
  type: string | null;
};

type IdMapping = {
  files: string[];
  legacyId: string;
  newId: string;
};

type PlannedRename = {
  from: string;
  to: string;
};

type RewriteEntry = {
  file: string;
  replacements: number;
};

type IndexEntry = {
  action: "regenerated" | "hand-curated-rewritten" | "skipped";
  path: string;
};

type IdMigrationReport = {
  applied: boolean;
  ok: boolean;
  blockers: Blocker[];
  indexes: IndexEntry[];
  mappings: IdMapping[];
  renames: PlannedRename[];
  rewrites: RewriteEntry[];
  validation: {
    auditErrors: { code: string; file: string | null; message: string }[];
    duplicateIds: string[];
    remainingLegacyIds: string[];
    unresolvedLegacyRefs: string[];
  };
};

type MigrationOptions = {
  allowDirty?: boolean;
  apply?: boolean;
  cwd: string;
  extraRoots?: string[];
  keepFilenames?: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idTokenPattern(id: string): RegExp {
  return new RegExp(`(?<![0-9A-Za-z])${escapeRegExp(id)}(?![0-9A-Za-z])`, "g");
}

function stemKeyOf(fileName: string): string {
  return fileName.replace(/\.(md|jsonl)$/i, "").replace(LOCALE_SUFFIX, "");
}

function numberedTargetName(fileName: string): string | null {
  const match = NUMBERED_FILE.exec(fileName);
  return match ? match[2] : null;
}

const SKIPPED_DIRS = new Set([".git", "node_modules", ".pnpm-store"]);

function walkFiles(baseDir: string, extensions: string[]): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : walkFiles(fullPath, extensions);
    }
    return extensions.some((ext) => entry.name.toLowerCase().endsWith(ext)) ? [fullPath] : [];
  }).sort();
}

function canonicalDirs(cwd: string): { dir: string; type: string | null }[] {
  const seen = new Set<string>();
  const dirs: { dir: string; type: string | null }[] = [];
  for (const type of docTypes) {
    const config = configFor(type);
    for (const candidate of config.dirs) {
      if (!fs.existsSync(path.join(cwd, candidate))) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      dirs.push({ dir: candidate, type });
    }
  }
  if (fs.existsSync(path.join(cwd, IMPL_IR_DIR))) dirs.push({ dir: IMPL_IR_DIR, type: "impl" });
  if (fs.existsSync(path.join(cwd, IMPL_EXP_DIR))) dirs.push({ dir: IMPL_EXP_DIR, type: "impl-exp" });
  return dirs;
}

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

// Scan roots must not escape the repository through symlinks: a lexical
// containment check is not enough because statSync follows links. Compare
// canonical real paths instead so `guides -> /outside` is refused.
function realpathInside(realCwd: string, absolute: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    return false;
  }
  const rel = path.relative(realCwd, real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathOf(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

// Agent-facing documents shipped outside docs/ (root AGENTS.md / README.md and
// distributed .apm skill documents) carry the same canonical artifact
// references, so they join the rewrite and unresolved-reference scan scope.
function distributionDocRoots(cwd: string): string[] {
  const realCwd = realpathOf(cwd);
  const candidates = [".apm"];
  const packagesDir = path.join(cwd, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`packages/${entry.name}/.apm`);
    }
  }
  return candidates.filter((candidate) => {
    const full = path.join(cwd, candidate);
    return fs.existsSync(full)
      && fs.statSync(full).isDirectory()
      && realpathInside(realCwd, full);
  });
}

function resolveExtraRoots(cwd: string, extraRoots: string[], blockers: Blocker[]): string[] {
  const realCwd = realpathOf(cwd);
  const resolved: string[] = [];
  for (const extra of extraRoots) {
    const absolute = path.resolve(cwd, extra);
    const rel = normalizeDir(path.relative(cwd, absolute));
    if (rel === "" || rel === ".") {
      resolved.push(".");
      continue;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      blockers.push({
        code: "invalid-extra-root",
        file: null,
        message: `Extra content root is not a directory: ${extra}`,
      });
      continue;
    }
    if (!realpathInside(realCwd, absolute)) {
      blockers.push({
        code: "invalid-extra-root",
        file: null,
        message: `Extra content root escapes the repository: ${extra}`,
      });
      continue;
    }
    resolved.push(rel);
  }
  return resolved;
}

function contentRoots(cwd: string, dirs: { dir: string }[], extraRoots: string[] = []): string[] {
  const roots: string[] = [];
  if (fs.existsSync(path.join(cwd, "docs"))) roots.push("docs");
  for (const { dir } of dirs) {
    if (!isUnderDir(dir, "docs")) roots.push(dir);
  }
  for (const root of [...distributionDocRoots(cwd), ...extraRoots]) {
    if (!roots.some((existing) => isUnderDir(root, existing))) roots.push(root);
  }
  return roots;
}

function rootContentFiles(cwd: string): string[] {
  return fs.readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|jsonl)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function contentFilesUnder(cwd: string, roots: string[], extraFiles: string[] = []): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const root of roots) {
    for (const fullPath of walkFiles(path.join(cwd, root), [".md", ".jsonl"])) {
      const relPath = path.relative(cwd, fullPath).replace(/\\/g, "/");
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      files.push(relPath);
    }
  }
  for (const relPath of extraFiles) {
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    files.push(relPath);
  }
  return files.sort();
}

function prefixForFile(file: DiscoveredFile): string {
  if (file.type && (docTypes as readonly string[]).includes(file.type)) {
    return configFor(file.type).idPrefix;
  }
  if (file.dirType && (docTypes as readonly string[]).includes(file.dirType)) {
    return configFor(file.dirType).idPrefix;
  }
  return "IMPL";
}

function discover(cwd: string, dirs: { dir: string; type: string | null }[], blockers: Blocker[]): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  for (const { dir, type: dirType } of dirs) {
    const fullDir = path.join(cwd, dir);
    const names = dir === IMPL_EXP_DIR
      ? fs.readdirSync(fullDir)
        .filter((name) => name.toLowerCase().endsWith(".jsonl") || (name.toLowerCase().endsWith(".md") && !isIndexFileName(name)))
        .sort()
      : docFiles(fullDir);
    for (const name of names) {
      const relPath = `${dir}/${name}`;
      const fullPath = path.join(cwd, relPath);
      const baseName = path.basename(name);
      const isMarkdown = baseName.toLowerCase().endsWith(".md");
      const numbered = NUMBERED_FILE.exec(baseName)?.[1] || null;
      const base: DiscoveredFile = {
        dir,
        dirType,
        id: null,
        numberedName: numbered,
        path: relPath,
        stemKey: stemKeyOf(baseName),
        synthesizedId: null,
        type: null,
      };
      if (!isMarkdown) {
        files.push(base);
        continue;
      }
      const parsed = parseDoc(fs.readFileSync(fullPath, "utf8"));
      if (parsed.error) {
        blockers.push({
          code: "unparseable-front-matter",
          file: relPath,
          message: `Front matter is not valid YAML: ${parsed.error}`,
        });
        files.push(base);
        continue;
      }
      const data = parsed.data;
      if (Object.keys(data).length === 0) {
        if (numbered) {
          blockers.push({
            code: "missing-front-matter",
            file: relPath,
            message: `Numbered document ${relPath} has no front matter, so its ${prefixForFile(base)}-${numbered} identity would be lost on rename. Add front matter (at minimum an id) or move it out of the canonical docs dir before migrating.`,
          });
        }
        files.push(base);
        continue;
      }
      const typeValue = typeof data.type === "string" ? data.type : null;
      if (typeValue && !(docTypes as readonly string[]).includes(typeValue) && typeValue !== "impl") {
        blockers.push({
          code: "unknown-type",
          file: relPath,
          message: `Unrecognized document type: ${typeValue}`,
        });
      }
      base.type = typeValue;
      if (typeof data.id === "string" && data.id.trim()) {
        base.id = data.id.trim();
      } else if (numbered) {
        base.synthesizedId = `${prefixForFile(base)}-${numbered}`;
      }
      files.push(base);
    }
  }
  return files;
}

function knownPrefixes(mappings: Map<string, string>): Set<string> {
  const prefixes = new Set<string>(docTypes.map((type) => configFor(type).idPrefix));
  prefixes.add("IMPL");
  prefixes.add(EXPERIMENT_ID_PREFIX);
  for (const legacyId of mappings.keys()) {
    prefixes.add(legacyId.slice(0, legacyId.lastIndexOf("-")));
  }
  return prefixes;
}

function legacyTokens(content: string, prefixes: Set<string>): string[] {
  const tokens = content.match(LEGACY_ID_TOKEN) || [];
  return tokens.filter((token) => prefixes.has(token.slice(0, token.lastIndexOf("-"))));
}

function worktreeDirty(cwd: string): boolean | null {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (probe.status !== 0) return null;
  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (status.status !== 0) return null;
  return status.stdout.trim().length > 0;
}

function planRenames(cwd: string, files: DiscoveredFile[], blockers: Blocker[]): PlannedRename[] {
  const renames: PlannedRename[] = [];
  const renameSources = new Set(
    files.filter((file) => numberedTargetName(path.basename(file.path)) !== null).map((file) => file.path),
  );
  const targetOwners = new Map<string, string>();
  for (const file of files) {
    const targetName = numberedTargetName(path.basename(file.path));
    if (!targetName) continue;
    const to = `${normalizeDir(path.dirname(file.path))}/${targetName}`;
    const owner = targetOwners.get(to);
    if (owner && owner !== file.path) {
      blockers.push({
        code: "rename-collision",
        file: file.path,
        message: `Rename target ${to} is claimed by both ${owner} and ${file.path}`,
      });
      continue;
    }
    targetOwners.set(to, file.path);
    const targetFull = path.join(cwd, to);
    if (fs.existsSync(targetFull) && !renameSources.has(to)) {
      blockers.push({
        code: "rename-collision",
        file: file.path,
        message: `Rename target already exists: ${to}`,
      });
      continue;
    }
    renames.push({ from: file.path, to });
  }
  for (const rename of renames) {
    const tmpPath = `${rename.from}${MIGRATE_TMP_SUFFIX}`;
    if (fs.existsSync(path.join(cwd, tmpPath))) {
      blockers.push({
        code: "rename-temp-collision",
        file: rename.from,
        message: `Temporary rename path already exists: ${tmpPath}. Remove it or pass --keep-filenames.`,
      });
    }
  }
  return renames;
}

// Experiment logs carry no artifact id; their canonical reference is the
// `.jsonl` path. Map each `EXP-NNNN` token to the path the numbered experiment
// file occupies after renames (or its current path under --keep-filenames).
// Only `.jsonl` files count: a same-numbered Markdown document in the exp dir
// is not an experiment log and must not absorb or confuse the reference.
function experimentTokenTargets(
  files: DiscoveredFile[],
  renames: PlannedRename[],
): { targets: Map<string, string>; ambiguous: Set<string> } {
  const byNumber = new Map<string, DiscoveredFile[]>();
  for (const file of files) {
    if (file.dir !== IMPL_EXP_DIR || !file.numberedName) continue;
    if (!file.path.toLowerCase().endsWith(".jsonl")) continue;
    const group = byNumber.get(file.numberedName) || [];
    group.push(file);
    byNumber.set(file.numberedName, group);
  }
  const renameTargets = new Map(renames.map((rename) => [rename.from, rename.to]));
  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [numbered, group] of byNumber) {
    if (group.length > 1) {
      ambiguous.add(numbered);
      continue;
    }
    targets.set(`${EXPERIMENT_ID_PREFIX}-${numbered}`, renameTargets.get(group[0].path) ?? group[0].path);
  }
  return { targets, ambiguous };
}

function rewriteContent(
  content: string,
  mappings: Map<string, string>,
  renames: PlannedRename[],
  experimentTargets: Map<string, string>,
): { content: string; replacements: number } {
  let replacements = 0;
  let next = content;
  for (const [legacyId, newId] of mappings) {
    const pattern = idTokenPattern(legacyId);
    next = next.replace(pattern, () => {
      replacements += 1;
      return newId;
    });
  }
  for (const [token, target] of experimentTargets) {
    const pattern = idTokenPattern(token);
    next = next.replace(pattern, () => {
      replacements += 1;
      return target;
    });
  }
  if (renames.length > 0) {
    const targets = new Map(
      renames.map((rename) => [path.basename(rename.from), path.basename(rename.to)]),
    );
    const pattern = new RegExp(
      `(?<![0-9A-Za-z-])(?:${[...targets.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?![0-9A-Za-z])`,
      "g",
    );
    next = next.replace(pattern, (match) => {
      replacements += 1;
      return targets.get(match) as string;
    });
  }
  return { content: next, replacements };
}

function injectMissingId(content: string, newId: string): string {
  return content.replace(/^(---\r?\n)/, `$1id: "${newId}"\n`);
}

async function regenerateIndexes(
  cwd: string,
  dirs: { dir: string; type: string | null }[],
  touchedDirs: Set<string>,
): Promise<IndexEntry[]> {
  const results: IndexEntry[] = [];
  for (const dir of [...touchedDirs].sort()) {
    const dirType = dirs.find((candidate) => candidate.dir === dir)?.type || null;
    const readmePath = path.join(cwd, dir, "README.md");
    const relReadme = `${dir}/README.md`;
    if (dirType === "impl") {
      const result = updateIndexForMarkdownDir(cwd, dir);
      results.push({ action: result.written ? "regenerated" : "hand-curated-rewritten", path: relReadme });
      continue;
    }
    if (dirType === "impl-exp") {
      const result = updateIndexForExperimentDir(cwd, dir);
      results.push({ action: result.written ? "regenerated" : "hand-curated-rewritten", path: relReadme });
      continue;
    }
    if (!fs.existsSync(readmePath)) {
      results.push({ action: "skipped", path: relReadme });
      continue;
    }
    const existing = fs.readFileSync(readmePath, "utf8");
    if (!existing.includes(GENERATED_INDEX_MARKER)) {
      results.push({ action: "hand-curated-rewritten", path: relReadme });
      continue;
    }
    const seedType = dirType && (docTypes as readonly string[]).includes(dirType) ? dirType : "discovery";
    await writeGeneratedIndex(cwd, seedType, dir, { forceIndex: true });
    results.push({ action: "regenerated", path: relReadme });
  }
  return results;
}

async function validate(
  cwd: string,
  dirs: { dir: string; type: string | null }[],
  prefixes: Set<string>,
  extraRoots: string[],
): Promise<IdMigrationReport["validation"]> {
  const remainingLegacyIds = new Set<string>();
  const idFiles = new Map<string, string[]>();
  for (const { dir } of dirs) {
    const fullDir = path.join(cwd, dir);
    for (const name of docFiles(fullDir)) {
      const relPath = `${dir}/${name}`;
      const parsed = parseDoc(fs.readFileSync(path.join(fullDir, name), "utf8"));
      const id = typeof parsed.data.id === "string" ? parsed.data.id.trim() : null;
      if (!id) continue;
      if (isLegacyArtifactId(id)) remainingLegacyIds.add(id);
      const owners = idFiles.get(id) || [];
      owners.push(relPath);
      idFiles.set(id, owners);
    }
  }
  const siblingKeys = new Map<string, Set<string>>();
  for (const { dir } of dirs) {
    for (const name of docFiles(path.join(cwd, dir))) {
      const key = `${dir}::${stemKeyOf(path.basename(name))}`;
      const parsed = parseDoc(fs.readFileSync(path.join(cwd, dir, name), "utf8"));
      const id = typeof parsed.data.id === "string" ? parsed.data.id.trim() : null;
      if (!id) continue;
      const set = siblingKeys.get(id) || new Set<string>();
      set.add(key);
      siblingKeys.set(id, set);
    }
  }
  const duplicateIds = [...idFiles.entries()]
    .filter(([id, files]) => files.length > 1 && (siblingKeys.get(id)?.size || 0) > 1)
    .map(([id]) => id);

  const unresolved = new Set<string>();
  for (const relPath of contentFilesUnder(cwd, contentRoots(cwd, dirs, extraRoots), rootContentFiles(cwd))) {
    const content = fs.readFileSync(path.join(cwd, relPath), "utf8");
    for (const token of legacyTokens(content, prefixes)) {
      unresolved.add(token);
    }
  }
  const auditErrors: { code: string; file: string | null; message: string }[] = [];
  const auditedScopes = new Set<string>();
  for (const { dir, type } of dirs) {
    if (type === "impl" || type === "impl-exp") {
      const findings = type === "impl"
        ? auditImplementationRecords(cwd, dir).findings
        : auditExperimentLogs(cwd, dir).findings;
      for (const finding of findings) {
        if (finding.severity !== "error") continue;
        auditErrors.push({ code: finding.code, file: finding.file, message: finding.message });
      }
      continue;
    }
    // A shared directory hosts multiple document types (for example
    // `brainstorm` and `discovery` both live in `docs/discovery`), so audit
    // every resident type rather than only the canonical one that claimed
    // the directory.
    const resident = residentTypesForDir(dir);
    const targets = resident.length > 0 ? resident : type ? [type] : [];
    for (const scopeType of targets) {
      const scopeKey = `${scopeType}::${normalizeDir(dir)}`;
      if (auditedScopes.has(scopeKey)) continue;
      auditedScopes.add(scopeKey);
      const { findings } = await auditDocuments(cwd, scopeType, dir);
      for (const finding of findings) {
        if (!finding.blocking) continue;
        auditErrors.push({ code: finding.code, file: finding.file, message: finding.message });
      }
    }
  }
  return {
    auditErrors,
    duplicateIds: [...new Set(duplicateIds)].sort(),
    remainingLegacyIds: [...remainingLegacyIds].sort(),
    unresolvedLegacyRefs: [...unresolved].sort(),
  };
}

async function migrateArtifactIds(options: MigrationOptions): Promise<IdMigrationReport> {
  const cwd = path.resolve(options.cwd);
  const blockers: Blocker[] = [];
  const dirs = canonicalDirs(cwd);
  const files = discover(cwd, dirs, blockers);

  const existingNewIds = new Set(
    files.map((file) => file.id).filter((id): id is string => Boolean(id && isNewArtifactId(id))),
  );

  const legacyGroups = new Map<string, DiscoveredFile[]>();
  for (const file of files) {
    const legacyId = file.id && isLegacyArtifactId(file.id) ? file.id : file.synthesizedId;
    if (!legacyId) continue;
    const group = legacyGroups.get(legacyId) || [];
    group.push(file);
    legacyGroups.set(legacyId, group);
  }

  for (const [legacyId, group] of legacyGroups) {
    const keys = new Set(group.map((file) => `${file.dir}::${file.stemKey}`));
    if (keys.size > 1) {
      blockers.push({
        code: "duplicate-legacy-id",
        file: group.map((file) => file.path).sort()[0],
        message: `Legacy id ${legacyId} appears in ${group.length} non-sibling files: ${group.map((file) => file.path).join(", ")}`,
      });
    }
  }

  const mappings = new Map<string, string>();
  for (const [legacyId, group] of [...legacyGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = new Set(group.map((file) => `${file.dir}::${file.stemKey}`));
    if (keys.size > 1) continue;
    const prefix = legacyId.slice(0, legacyId.lastIndexOf("-"));
    let newId = generateArtifactId(prefix);
    while (existingNewIds.has(newId)) newId = generateArtifactId(prefix);
    existingNewIds.add(newId);
    mappings.set(legacyId, newId);
  }

  const renames = options.keepFilenames ? [] : planRenames(cwd, files, blockers);
  const experimentRefs = experimentTokenTargets(files, renames);

  const extraRoots = resolveExtraRoots(cwd, options.extraRoots ?? [], blockers);
  const prefixes = knownPrefixes(mappings);
  const contentFiles = contentFilesUnder(
    cwd,
    contentRoots(cwd, dirs, extraRoots),
    rootContentFiles(cwd),
  );
  const mappedIds = new Set(mappings.keys());
  for (const relPath of contentFiles) {
    const content = fs.readFileSync(path.join(cwd, relPath), "utf8");
    for (const token of new Set(legacyTokens(content, prefixes))) {
      if (mappedIds.has(token) || experimentRefs.targets.has(token)) continue;
      const expNumber = token.startsWith(`${EXPERIMENT_ID_PREFIX}-`)
        ? token.slice(EXPERIMENT_ID_PREFIX.length + 1)
        : null;
      if (expNumber && experimentRefs.ambiguous.has(expNumber)) {
        blockers.push({
          code: "ambiguous-experiment-reference",
          file: relPath,
          message: `Experiment reference ${token} matches multiple experiment logs; rewrite it to a .jsonl path manually`,
        });
        continue;
      }
      blockers.push({
        code: "unresolved-legacy-reference",
        file: relPath,
        message: `Legacy id ${token} has no matching artifact to remap`,
      });
    }
  }

  if (options.apply && !options.allowDirty) {
    const dirty = worktreeDirty(cwd);
    if (dirty === true) {
      blockers.push({
        code: "dirty-worktree",
        file: null,
        message: "Worktree has uncommitted changes; commit or stash first, or pass --allow-dirty",
      });
    }
  }

  const mappingReports: IdMapping[] = [...mappings.entries()].map(([legacyId, newId]) => ({
    files: (legacyGroups.get(legacyId) || []).map((file) => file.path).sort(),
    legacyId,
    newId,
  }));

  const emptyValidation = { auditErrors: [], duplicateIds: [], remainingLegacyIds: [], unresolvedLegacyRefs: [] };
  if (blockers.length > 0) {
    return {
      applied: false,
      ok: false,
      blockers,
      indexes: [],
      mappings: mappingReports,
      renames,
      rewrites: [],
      validation: emptyValidation,
    };
  }

  const injectedIds = new Map<string, string>();
  for (const file of files) {
    if (!file.synthesizedId) continue;
    const newId = mappings.get(file.synthesizedId);
    if (newId) injectedIds.set(file.path, newId);
  }

  const rewrites: RewriteEntry[] = [];
  for (const relPath of contentFiles) {
    const fullPath = path.join(cwd, relPath);
    const original = fs.readFileSync(fullPath, "utf8");
    let { content, replacements } = rewriteContent(original, mappings, renames, experimentRefs.targets);
    const injected = injectedIds.get(relPath);
    if (injected && !original.includes(`id: "${injected}"`)) {
      const before = content;
      content = injectMissingId(content, injected);
      if (content !== before) replacements += 1;
    }
    if (replacements === 0) continue;
    rewrites.push({ file: relPath, replacements });
    if (options.apply) fs.writeFileSync(fullPath, content, "utf8");
  }

  const indexes: IndexEntry[] = [];
  if (options.apply) {
    for (const rename of renames) {
      fs.renameSync(path.join(cwd, rename.from), path.join(cwd, `${rename.from}${MIGRATE_TMP_SUFFIX}`));
    }
    for (const rename of renames) {
      fs.renameSync(path.join(cwd, `${rename.from}${MIGRATE_TMP_SUFFIX}`), path.join(cwd, rename.to));
    }
    const touchedDirs = new Set<string>([
      ...files.filter((file) => file.synthesizedId || (file.id && isLegacyArtifactId(file.id))).map((file) => file.dir),
      ...renames.map((rename) => normalizeDir(path.dirname(rename.from))),
    ]);
    indexes.push(...await regenerateIndexes(cwd, dirs, touchedDirs));
  }

  const validation = options.apply
    ? await validate(cwd, dirs, prefixes, extraRoots)
    : emptyValidation;

  const validationFailed = validation.remainingLegacyIds.length > 0
    || validation.duplicateIds.length > 0
    || validation.unresolvedLegacyRefs.length > 0
    || validation.auditErrors.length > 0;

  return {
    applied: Boolean(options.apply),
    ok: blockers.length === 0 && !validationFailed,
    blockers,
    indexes,
    mappings: mappingReports,
    renames,
    rewrites,
    validation,
  };
}

export {
  migrateArtifactIds,
};

export type {
  Blocker,
  IdMapping,
  IdMigrationReport,
  IndexEntry,
  MigrationOptions,
  PlannedRename,
  RewriteEntry,
};
