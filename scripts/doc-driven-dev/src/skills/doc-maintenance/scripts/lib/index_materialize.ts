"use strict";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildIndex as buildAdrIndex, writeIndexFile } from "../../../adr-doc/scripts/lib/adr_utils";
import { parseManagedIndexLayout } from "../../../lib/doc_index_tiers";
import type { ManagedIndexLayout } from "../../../lib/doc_index_tiers";
import { DIRECTORY_CONTRACTS, ownershipForDir, sharedTypesResidentIn } from "../../../lib/doc_ownership";
import type { DocOwner } from "../../../lib/doc_ownership";
import {
  docDir,
  docFiles,
  isGeneratedIndex,
  mergeManagedIndex,
  parseDoc,
  primaryIndexTypeForDir,
  renderManagedIndex,
} from "../../../lib/doc_suite_utils";
import { docTypes } from "../../../lib/doc_types";
import {
  isIndexFileName,
  normalizeDir,
  repoPathKey,
  resolveContainedDir,
} from "../../../lib/document_utils";

// ---------------------------------------------------------------------------
// Index materialization planner (Issue #197, Task 1)
//
// Enumerates the managed index dirs — the shared-4col dirs resolved from the
// nine shared doc types, the ADR dir, and (for Task 2 dispatch) the impl-doc
// leaf dirs — and produces a normalized per-target plan: verdict, change
// summary, SHA-256 pins, planHash, and the merged content. Apply re-plans,
// re-validates pins against the live filesystem (TOCTOU), and writes
// atomically. impl-dir kinds are a Task 2 seam: the internal dispatch switch
// throws for them and the exported planner filters them out of `targets`.
// ---------------------------------------------------------------------------

type IndexTargetKind = "shared" | "adr" | "ir" | "exp";

type IndexMaterializeVerdict =
  | "in-sync" // index already matches source truth — no-op
  | "sync" // drift detected; plan describes the reconcile
  | "create" // index missing; plan describes a fresh managed index
  | "rejected"; // fail-closed: non-regular / hand-curated / unreadable

type IndexMaterializeChangeKind = "add" | "remove" | "update-status" | "move-tier" | "reorder";

type IndexMaterializeChange = {
  file: string; // source-relative filename (a.md)
  kind: IndexMaterializeChangeKind;
  before?: string; // row summary before (cells or tier)
  after?: string; // row summary after
};

type IndexMaterializePins = {
  // sha256 over the sorted dir-relative source paths followed by each file's
  // content sha256 — one deterministic digest of the whole source set.
  sources: string;
  // sha256 of the sorted source basenames.
  fileList: string;
  // sha256 of the current index bytes; null when no index exists.
  index: string | null;
};

type IndexMaterializeTarget = {
  kind: IndexTargetKind;
  owner: DocOwner | null; // null for unclaimed custom dirs
  directory: string; // repo-relative dir
  indexPath: string; // repo-relative index path
  verdict: IndexMaterializeVerdict;
  reason?: string; // rejection/detail text
  changes: IndexMaterializeChange[];
  pins: IndexMaterializePins;
  sourceCount: number; // non-index source docs feeding the index
  planHash: string; // sha256 of the canonical per-target payload
  plannedFiles: string[]; // [indexPath] when a write is planned
  content?: string; // merged index content — present for sync/create only
};

type IndexMaterializePlan = {
  targets: IndexMaterializeTarget[];
  planHash: string; // sha256 of the sorted per-target planHashes
};

type IndexMaterializePlanOptions = {
  dir?: string; // --dir scope: one directory instead of every managed dir
};

type IndexMaterializeApplyOptions = IndexMaterializePlanOptions & {
  expectPlanHash?: string; // --expect: refuse to write when the re-plan drifted
};

type IndexMaterializeBlocked = {
  target: IndexMaterializeTarget;
  reason: string;
};

type IndexMaterializeApplyReport = {
  plan: IndexMaterializePlan;
  written: string[]; // repo-relative index paths actually written
  blocked: IndexMaterializeBlocked[];
};

// Internal per-target state the apply path needs but the plan contract does
// not expose: the freshly rendered generated region (ADR writes merge through
// the owner writer, which expects the un-merged render).
type TargetInternals = {
  generated: string;
};

function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function cellsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function sameFileSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((file) => set.has(file));
}

// --- target enumeration ------------------------------------------------------

// The kind of managed index a directory hosts, from the ownership contract.
// Unclaimed dirs are shared-4col territory (the established custom-dir
// contract); `none`-format owned dirs (the docs/impl container) host no
// managed index at all and yield null.
function kindForDir(directory: string): IndexTargetKind | null {
  const contract = ownershipForDir(directory);
  if (!contract) return "shared";
  if (contract.indexFormat === "impl-4col") return "ir";
  if (contract.indexFormat === "exp-1col") return "exp";
  if (contract.indexFormat === "none") return null;
  return contract.owner === "adr-doc" ? "adr" : "shared";
}

// Every managed index dir in scope. Without --dir that is each shared type's
// resolved dir (canonical or first existing alias, deduped — brainstorm and
// discovery share docs/discovery) plus the impl leaf dirs, which Task 2 will
// dispatch. With --dir the selector resolves through the shared containment
// boundary exactly like the other doc ops.
function managedDirs(cwd: string, explicitDir?: string): string[] {
  if (explicitDir !== undefined) {
    return [normalizeDir(resolveContainedDir(cwd, explicitDir))];
  }
  const dirs = new Map<string, string>();
  for (const type of docTypes) {
    const dir = normalizeDir(docDir(cwd, type));
    dirs.set(repoPathKey(dir), dir);
  }
  for (const contract of DIRECTORY_CONTRACTS) {
    if (contract.indexFormat === "impl-4col" || contract.indexFormat === "exp-1col") {
      dirs.set(repoPathKey(contract.dir), contract.dir);
    }
  }
  return [...dirs.values()].sort((a, b) => a.localeCompare(b));
}

// --- source scan -------------------------------------------------------------

// The source docs the index can list: recursive markdown minus index-named
// files, symlink-free — identical to the set renderManagedIndex/buildIndex
// consume, for shared and ADR dirs alike.
function sourcePaths(cwd: string, directory: string): string[] {
  return docFiles(path.join(cwd, directory)).sort();
}

function computeSourcePins(dirAbs: string, files: string[]): { sources: string; fileList: string } {
  const hashes = files.map((file) => sha256File(path.join(dirAbs, file)));
  return {
    sources: sha256Text([...files, ...hashes].join("\n")),
    fileList: sha256Text(files.map((file) => path.basename(file)).sort().join("\n")),
  };
}

// The index file a shared dir carries: an existing README.md wins, then any
// other index-named markdown, else README.md — the same preference
// doc_maintenance's scopeIndexPath applies. The ADR owner writer is pinned to
// README.md.
function indexFileNameForDir(dirAbs: string): string {
  if (!fs.existsSync(dirAbs)) return "README.md";
  const candidates = fs.readdirSync(dirAbs).filter((file) => isIndexFileName(file));
  const readme = candidates.find((file) => /^readme\.md$/i.test(file));
  return readme ?? candidates.sort()[0] ?? "README.md";
}

// Doc types actually resident in a directory by front matter. Owned dirs use
// their contract residents instead; this scan exists so an unclaimed custom
// dir titles its index after the docs it really hosts.
function detectedDocTypes(dirAbs: string, files: string[]): string[] {
  const found = new Set<string>();
  for (const file of files) {
    try {
      const typeValue = parseDoc(fs.readFileSync(path.join(dirAbs, file), "utf8")).data.type;
      if (typeof typeValue === "string" && (docTypes as readonly string[]).includes(typeValue)) {
        found.add(typeValue);
      }
    } catch {
      // an unreadable source only loses its vote for the title seed
    }
  }
  return [...found].sort();
}

// --- index state -------------------------------------------------------------

type IndexState = {
  status: "missing" | "symlink" | "not-file" | "unreadable" | "file";
  existing: string | null;
  pin: string | null;
};

// lstat-based classification: never read index content through a symlink.
// Pins are informational on rejected targets — a symlink's target is hashed
// when readable, matching the impl_index_sync convention.
function inspectIndex(indexAbs: string): IndexState {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(indexAbs);
  } catch {
    return { status: "missing", existing: null, pin: null };
  }
  if (stats.isSymbolicLink()) {
    let pin: string | null = null;
    try {
      pin = sha256File(indexAbs);
    } catch {
      pin = null;
    }
    return { status: "symlink", existing: null, pin };
  }
  if (!stats.isFile()) return { status: "not-file", existing: null, pin: null };
  try {
    const existing = fs.readFileSync(indexAbs, "utf8");
    return { status: "file", existing, pin: sha256Text(existing) };
  } catch {
    return { status: "unreadable", existing: null, pin: null };
  }
}

// --- change summary ----------------------------------------------------------

type LayoutRow = {
  file: string;
  tier: string;
  cells: string[];
};

// Rows of a shared-4col managed index, keyed by their normalized link target
// (`[a.md](./a.md)` -> `a.md`) so a cell-spelling difference reports as a row
// change, not an add/remove pair.
function layoutRows(layout: ManagedIndexLayout): LayoutRow[] {
  return layout.rows.map((entry) => {
    const file = entry.row.file.replace(/^\.\//, "");
    return { file, tier: entry.tier, cells: [entry.row.id, entry.row.title, entry.row.status, entry.row.file] };
  });
}

function summarizeRow(row: LayoutRow): string {
  return row.cells.join(" | ");
}

// Minimal per-file diff between two parsed index layouts. Mirrors
// impl_index_sync's computeDrift minus its order-conflict guard:
// materialization exists to regenerate, so a reordered stable row is a
// "reorder" change, not a rejection.
function computeChanges(currentRows: LayoutRow[], expectedRows: LayoutRow[]): IndexMaterializeChange[] {
  const currentByFile = new Map(currentRows.map((row) => [row.file, row]));
  const expectedByFile = new Map(expectedRows.map((row) => [row.file, row]));

  const stable = new Set<string>();
  for (const [file, expected] of expectedByFile) {
    const current = currentByFile.get(file);
    if (current && current.tier === expected.tier && cellsEqual(current.cells, expected.cells)) {
      stable.add(file);
    }
  }

  const changes: IndexMaterializeChange[] = [];
  for (const expected of expectedRows) {
    const current = currentByFile.get(expected.file);
    if (!current) {
      changes.push({ file: expected.file, kind: "add", after: summarizeRow(expected) });
      continue;
    }
    if (current.tier !== expected.tier) {
      changes.push({ file: expected.file, kind: "move-tier", before: current.tier, after: expected.tier });
      continue;
    }
    if (!cellsEqual(current.cells, expected.cells)) {
      changes.push({ file: expected.file, kind: "update-status", before: summarizeRow(current), after: summarizeRow(expected) });
    }
  }
  for (const current of currentRows) {
    if (!expectedByFile.has(current.file)) {
      changes.push({ file: current.file, kind: "remove", before: summarizeRow(current) });
    }
  }

  // Reorder: a stable row whose position inside an unchanged tier drifted —
  // genuine order drift, not a side effect of add/remove/move-tier.
  const changed = new Set(changes.map((change) => change.file));
  for (const tier of ["active", "settled"] as const) {
    const currentTier = currentRows.filter((row) => row.tier === tier);
    const expectedTier = expectedRows.filter((row) => row.tier === tier);
    if (!sameFileSet(currentTier.map((row) => row.file), expectedTier.map((row) => row.file))) continue;
    for (const expected of expectedTier) {
      if (changed.has(expected.file) || !stable.has(expected.file)) continue;
      const positionCurrent = currentTier.findIndex((row) => row.file === expected.file);
      const positionExpected = expectedTier.findIndex((row) => row.file === expected.file);
      if (positionCurrent !== positionExpected) {
        changes.push({
          file: expected.file,
          kind: "reorder",
          before: `${tier} position ${positionCurrent + 1}`,
          after: `${tier} position ${positionExpected + 1}`,
        });
      }
    }
  }

  changes.sort((left, right) => left.file.localeCompare(right.file));
  return changes;
}

// --- per-target plan ---------------------------------------------------------

// The expected generated body: the shared pipeline for shared dirs, the ADR
// owner renderer for the adr kind. The seed type mirrors what the writers
// use — contract residents for owned dirs; for an unclaimed dir the types
// actually resident there (falling back to the whole shared scope, the same
// default the maintenance union scan applies).
async function renderExpected(cwd: string, kind: "shared" | "adr", directory: string, files: string[]): Promise<string> {
  if (kind === "adr") return buildAdrIndex(cwd, directory);
  const scopeTypes = sharedTypesResidentIn(directory);
  let seedPool = scopeTypes;
  if (!ownershipForDir(directory)) {
    const detected = detectedDocTypes(path.join(cwd, directory), files);
    if (detected.length > 0) seedPool = detected;
  }
  return renderManagedIndex(cwd, directory, primaryIndexTypeForDir(directory, seedPool), scopeTypes);
}

function sameDocument(left: string, right: string): boolean {
  return left.replace(/\s+$/, "") === right.replace(/\s+$/, "");
}

async function planManagedTarget(
  cwd: string,
  kind: "shared" | "adr",
  directory: string,
): Promise<{ target: IndexMaterializeTarget; internals: TargetInternals }> {
  const dirAbs = path.join(cwd, directory);
  const files = sourcePaths(cwd, directory);
  const contract = ownershipForDir(directory);
  const generated = await renderExpected(cwd, kind, directory, files);

  const indexFile = kind === "adr" ? "README.md" : indexFileNameForDir(dirAbs);
  const indexPath = `${directory}/${indexFile}`;
  const state = inspectIndex(path.join(cwd, indexPath));
  const pins: IndexMaterializePins = { ...computeSourcePins(dirAbs, files), index: state.pin };

  let verdict: IndexMaterializeVerdict;
  let reason: string | undefined;
  let changes: IndexMaterializeChange[] = [];
  let content: string | undefined;

  if (state.status === "symlink" || state.status === "not-file") {
    verdict = "rejected";
    reason = "index-not-regular-file";
  } else if (state.status === "unreadable") {
    verdict = "rejected";
    reason = "index-unreadable";
  } else if (state.status === "file" && !isGeneratedIndex(state.existing ?? "")) {
    verdict = "rejected";
    reason = "hand-curated-index";
  } else if (state.status === "missing") {
    verdict = "create";
    content = generated;
    changes = computeChanges([], layoutRows(parseManagedIndexLayout(generated)));
  } else {
    const existing = state.existing ?? "";
    const merged = mergeManagedIndex(existing, generated);
    if (sameDocument(merged, existing)) {
      verdict = "in-sync";
    } else {
      verdict = "sync";
      content = merged;
      changes = computeChanges(layoutRows(parseManagedIndexLayout(existing)), layoutRows(parseManagedIndexLayout(merged)));
    }
  }

  const plannedFiles = verdict === "sync" || verdict === "create" ? [indexPath] : [];
  // Canonical per-target payload: directory + verdict + content pins (+ the
  // derived change summary). Source or index drift re-pins the target.
  const planHash = sha256Text(JSON.stringify({ changes, directory, pins, verdict }));

  const target: IndexMaterializeTarget = {
    kind,
    owner: contract?.owner ?? null,
    directory,
    indexPath,
    verdict,
    ...(reason ? { reason } : {}),
    changes,
    pins,
    sourceCount: files.length,
    planHash,
    plannedFiles,
    ...(content !== undefined ? { content } : {}),
  };
  return { target, internals: { generated } };
}

// Kind dispatch — the Task 2 seam. impl-doc kinds are enumerated but the
// exported planner filters them out of `targets` until their branches land.
async function planTarget(
  cwd: string,
  kind: IndexTargetKind,
  directory: string,
): Promise<{ target: IndexMaterializeTarget; internals: TargetInternals }> {
  switch (kind) {
    case "shared":
    case "adr":
      return planManagedTarget(cwd, kind, directory);
    case "ir":
    case "exp":
      throw new Error("ir/exp dispatch implemented in Task 2");
  }
}

async function computeIndexMaterialization(
  cwd: string,
  explicitDir?: string,
): Promise<{ plan: IndexMaterializePlan; internals: Map<string, TargetInternals> }> {
  const targets: IndexMaterializeTarget[] = [];
  const internals = new Map<string, TargetInternals>();
  for (const directory of managedDirs(cwd, explicitDir)) {
    const kind = kindForDir(directory);
    // impl-doc territory (ir/exp, and the index-less docs/impl container) is
    // filtered out of targets until Task 2 wires the owner dispatch.
    if (kind === null || kind === "ir" || kind === "exp") continue;
    // A selector that lands on a file hosts no managed index — skip it.
    const dirAbs = path.join(cwd, directory);
    if (fs.existsSync(dirAbs) && !fs.statSync(dirAbs).isDirectory()) continue;
    // Only unclaimed dirs *with* resident docs materialize a shared index.
    if (!ownershipForDir(directory) && sourcePaths(cwd, directory).length === 0) continue;
    const planned = await planTarget(cwd, kind, directory);
    targets.push(planned.target);
    internals.set(planned.target.indexPath, planned.internals);
  }
  targets.sort((a, b) => a.directory.localeCompare(b.directory));
  const planHash = sha256Text(targets.map((target) => target.planHash).sort().join("\n"));
  return { plan: { targets, planHash }, internals };
}

async function planIndexMaterialization(cwd: string, options?: IndexMaterializePlanOptions): Promise<IndexMaterializePlan> {
  const resolvedCwd = path.resolve(cwd);
  const { plan } = await computeIndexMaterialization(resolvedCwd, options?.dir);
  return plan;
}

// --- apply -------------------------------------------------------------------

// Re-verify a target's pins against the live filesystem so a source, index,
// or listing change between the re-plan and the write fails closed.
function verifyTargetPins(cwd: string, target: IndexMaterializeTarget): boolean {
  try {
    const dirAbs = path.join(cwd, target.directory);
    const files = sourcePaths(cwd, target.directory);
    const live = computeSourcePins(dirAbs, files);
    if (live.sources !== target.pins.sources || live.fileList !== target.pins.fileList) return false;
    return inspectIndex(path.join(cwd, target.indexPath)).pin === target.pins.index;
  } catch {
    return false;
  }
}

function isSymlink(indexAbs: string): boolean {
  try {
    return fs.lstatSync(indexAbs).isSymbolicLink();
  } catch {
    return false;
  }
}

// Atomic same-dir tmp+rename for the shared kind — content is already merged.
function writeSharedIndex(cwd: string, target: IndexMaterializeTarget): string | null {
  const indexAbs = path.join(cwd, target.indexPath);
  fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
  const tmpPath = path.join(path.dirname(indexAbs), `.${path.basename(indexAbs)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, target.content ?? "", "utf8");
    fs.renameSync(tmpPath, indexAbs);
    return null;
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    return error instanceof Error ? error.message : String(error);
  }
}

async function applyIndexMaterialization(
  cwd: string,
  options?: IndexMaterializeApplyOptions,
): Promise<IndexMaterializeApplyReport> {
  const resolvedCwd = path.resolve(cwd);
  const { plan, internals } = await computeIndexMaterialization(resolvedCwd, options?.dir);
  const written: string[] = [];
  const blocked: IndexMaterializeBlocked[] = [];

  if (options?.expectPlanHash !== undefined && options.expectPlanHash !== plan.planHash) {
    const drift = `plan drift: expected planHash ${options.expectPlanHash}, recomputed ${plan.planHash}`;
    for (const target of plan.targets) {
      if (target.verdict === "in-sync") continue;
      blocked.push({ target, reason: target.reason ? `${target.reason}; ${drift}` : drift });
    }
    return { plan, written, blocked };
  }

  for (const target of plan.targets) {
    if (target.verdict === "in-sync") continue;
    if (target.verdict === "rejected") {
      blocked.push({ target, reason: target.reason ?? "rejected" });
      continue;
    }
    if (!verifyTargetPins(resolvedCwd, target)) {
      blocked.push({ target, reason: "index sources changed since the plan was computed" });
      continue;
    }
    const indexAbs = path.join(resolvedCwd, target.indexPath);
    if (isSymlink(indexAbs)) {
      blocked.push({ target, reason: "index became a symbolic link; refusing to write through it" });
      continue;
    }
    const internal = internals.get(target.indexPath);
    if (target.kind === "adr") {
      // The ADR owner writer merges against the live file itself, so it gets
      // the freshly rendered (un-merged) body; the pin check above guarantees
      // the merge input still matches the plan.
      fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
      const result = writeIndexFile(path.dirname(indexAbs), internal?.generated ?? target.content ?? "");
      if (result.written) {
        written.push(target.indexPath);
      } else {
        blocked.push({ target, reason: result.reason ?? "owner writer refused" });
      }
      continue;
    }
    const failure = writeSharedIndex(resolvedCwd, target);
    if (failure === null) {
      written.push(target.indexPath);
    } else {
      blocked.push({ target, reason: `write failed: ${failure}` });
    }
  }
  return { plan, written, blocked };
}

export {
  applyIndexMaterialization,
  planIndexMaterialization,
};

export type {
  IndexMaterializeApplyOptions,
  IndexMaterializeApplyReport,
  IndexMaterializeBlocked,
  IndexMaterializeChange,
  IndexMaterializeChangeKind,
  IndexMaterializePins,
  IndexMaterializePlan,
  IndexMaterializePlanOptions,
  IndexMaterializeTarget,
  IndexMaterializeVerdict,
  IndexTargetKind,
};
