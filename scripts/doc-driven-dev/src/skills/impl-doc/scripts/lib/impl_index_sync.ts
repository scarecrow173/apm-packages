"use strict";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  GENERATED_INDEX_MARKER,
  INDEX_TABLE_HEADER_1COL,
  indexCell,
  mergeManagedIndex,
  renderIndexBody,
} from "../../../lib/doc_suite_utils";
import type { IndexRowEntry } from "../../../lib/doc_suite_utils";
import {
  auditImplementationRecords,
  implDir,
  implIndexEntries,
  listFiles,
  parseImplIndexRows,
} from "./impl_doc_utils";
import type { ImplIndexRow, ManagedIndexRows } from "./impl_doc_utils";

// ---------------------------------------------------------------------------
// impl-doc owner index-sync engine (Issues #186/#187)
//
// Reconciles the managed README index of `docs/impl/ir` (4-column, settled
// tier) and `docs/impl/exp` (1-column) to source truth. The contract is
// fail-closed: the README must carry exactly one generated-index marker and a
// recognizable generated region, source IR files must all validate, and any
// ambiguity rejects the plan instead of guessing. Apply re-plans, verifies
// SHA-256 pins against the live filesystem (TOCTOU), and writes atomically.
// ---------------------------------------------------------------------------

type ImplIndexKind = "ir" | "exp";

type IndexVerdict =
  | "in-sync" // index already matches source truth — no-op
  | "sync" // drift detected; plan describes the reconcile
  | "create" // README missing; plan describes a fresh managed index
  | "rejected"; // fail-closed: hand-curated / ambiguous / broken / conflict

type SyncChange = {
  file: string; // source-relative filename (a.md / x.jsonl)
  kind: "add" | "remove" | "update-status" | "move-tier" | "reorder";
  before?: string; // row summary before (cells or tier)
  after?: string; // row summary after
};

type SyncPlan = {
  kind: ImplIndexKind;
  directory: string; // repo-relative dir
  indexPath: string; // repo-relative README path
  verdict: IndexVerdict;
  reason?: string; // rejection/detail text
  changes: SyncChange[];
  pins: {
    sources: Record<string, string>; // file -> sha256 (source docs / jsonl)
    index: string | null; // sha256 of current README (null if missing)
    fileList: string[]; // sorted dir listing of indexable files
  };
  planHash: string; // sha256 of canonical plan payload
  plannedFiles: string[]; // ["<dir>/README.md"] when a write is planned
};

// Canonical index titles — not exported by doc_ownership, kept in sync with
// INDEX_TITLES there and with what updateIndexFor*Dir writers emit.
const INDEX_TITLES: Record<ImplIndexKind, string> = {
  ir: "Implementation Records",
  exp: "Experiment Logs",
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

function rowsMatch(left: ImplIndexRow, right: ImplIndexRow): boolean {
  return left.tier === right.tier && cellsEqual(left.cells, right.cells);
}

function sameSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameFileSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((file) => set.has(file));
}

function summarizeRow(row: ImplIndexRow): string {
  return row.cells.join(" | ");
}

// --- source scan ------------------------------------------------------------

// IR index entries mirror updateIndexForMarkdownDir exactly so the expected
// rows are byte-identical to what the owner writers produce. Files that fail
// front-matter validation are plan blockers collected via the owner audit —
// the index can never be truthfully derived from an unparseable source.
function collectIrState(
  cwd: string,
  directory: string,
  dirAbs: string,
  files: string[],
): { entries: IndexRowEntry[]; blockers: string[] } {
  const blockersByFile = new Map<string, string>();
  for (const finding of auditImplementationRecords(cwd, directory).findings) {
    if (!finding.file) continue;
    if (finding.code !== "unparseable-front-matter" && finding.code !== "invalid-front-matter") continue;
    if (!blockersByFile.has(finding.file)) blockersByFile.set(finding.file, finding.message);
  }
  const blockers = [...blockersByFile.entries()].map(([file, message]) => `${file}: ${message}`);

  const entries = implIndexEntries(dirAbs, directory, files);
  return { entries, blockers };
}

function renderGeneratedDoc(kind: ImplIndexKind, directory: string, entries: IndexRowEntry[], files: string[]): string {
  let body: string;
  if (kind === "ir") {
    body = renderIndexBody(entries, { settledType: "impl" });
  } else {
    const header = INDEX_TABLE_HEADER_1COL;
    const rows = files.map((file) => `| [${indexCell(file)}](./${indexCell(file)}) |`);
    body = rows.length > 0 ? `${header}\n${rows.join("\n")}` : header;
  }
  return `# ${INDEX_TITLES[kind]}\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${directory}\`\n\n${body}\n`;
}

// --- drift ------------------------------------------------------------------

type DriftResult = {
  changes: SyncChange[];
  orderConflict: boolean;
  reason?: string;
};

function computeDrift(kind: ImplIndexKind, currentRows: ImplIndexRow[], expectedRows: ImplIndexRow[]): DriftResult {
  const currentByFile = new Map(currentRows.map((row) => [row.file, row]));
  const expectedByFile = new Map(expectedRows.map((row) => [row.file, row]));

  // Stable rows need no change: present in both with matching cells and tier.
  const stable = new Set<string>();
  for (const [file, expected] of expectedByFile) {
    const current = currentByFile.get(file);
    if (current && rowsMatch(current, expected)) stable.add(file);
  }

  // Non-target order conflict: regeneration would reorder stable rows the
  // sync must not touch. IR rows carry status/tier semantics, so an
  // out-of-order stable index may be deliberate curation → fail closed.
  // EXP rows are pure filename links — order drift is mechanical and syncs.
  if (kind === "ir" && stable.size > 0) {
    const currentStable = currentRows.map((row) => row.file).filter((file) => stable.has(file));
    const expectedStable = expectedRows.map((row) => row.file).filter((file) => stable.has(file));
    if (!sameSequence(currentStable, expectedStable)) {
      return {
        changes: [],
        orderConflict: true,
        reason: "non-target order conflict: stable index rows are ordered differently than the deterministic index order",
      };
    }
  }

  const changes: SyncChange[] = [];
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
      changes.push({
        file: expected.file,
        kind: "update-status",
        before: current.cells.join(" | "),
        after: expected.cells.join(" | "),
      });
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

  changes.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  return { changes, orderConflict: false };
}

// --- plan -------------------------------------------------------------------

function computeImplIndexSync(
  cwd: string,
  kind: ImplIndexKind,
  explicitDir?: string,
): { plan: SyncPlan; generated: string; existing: string | null } {
  const directory = implDir(cwd, kind, explicitDir);
  const dirAbs = path.join(cwd, directory);
  const ext = kind === "ir" ? ".md" : ".jsonl";
  const files = listFiles(dirAbs, ext);

  const sources: Record<string, string> = {};
  for (const file of files) {
    sources[file] = sha256File(path.join(dirAbs, file));
  }

  const indexAbs = path.join(dirAbs, "README.md");
  let indexStats: fs.Stats | null = null;
  try {
    indexStats = fs.lstatSync(indexAbs);
  } catch {
    indexStats = null;
  }
  const indexPresent = indexStats !== null;
  const indexIsSymlink = indexStats?.isSymbolicLink() === true;
  const indexIsFile = indexStats?.isFile() === true;
  let existing: string | null = null;
  let indexPin: string | null = null;
  if (indexIsFile) {
    try {
      existing = fs.readFileSync(indexAbs, "utf8");
      indexPin = sha256Text(existing);
    } catch {
      existing = null;
    }
  } else if (indexIsSymlink) {
    // Pins are informational on a rejected plan; hash the target when readable.
    try {
      indexPin = sha256File(indexAbs);
    } catch {
      indexPin = null;
    }
  }

  const { entries, blockers } = kind === "ir"
    ? collectIrState(cwd, directory, dirAbs, files)
    : { entries: [] as IndexRowEntry[], blockers: [] as string[] };

  const generated = renderGeneratedDoc(kind, directory, entries, files);
  const expectedParsed = parseImplIndexRows(generated, kind);
  const expectedRows = expectedParsed.ok ? expectedParsed.rows : [];

  let verdict: IndexVerdict;
  let reason: string | undefined;
  let changes: SyncChange[] = [];

  if (blockers.length > 0) {
    verdict = "rejected";
    reason = `index sources failed validation: ${blockers.join("; ")}`;
  } else if (indexIsSymlink) {
    verdict = "rejected";
    reason = "index README.md is a symbolic link; refusing to classify or write through it";
  } else if (indexPresent && !indexIsFile) {
    verdict = "rejected";
    reason = "index README.md is not a regular file";
  } else if (indexPresent && existing === null) {
    verdict = "rejected";
    reason = "index README.md could not be read";
  } else if (!indexPresent) {
    verdict = "create";
    changes = computeDrift(kind, [], expectedRows).changes;
  } else {
    const parsedIndex = parseImplIndexRows(existing ?? "", kind);
    if (!parsedIndex.ok) {
      verdict = "rejected";
      reason = parsedIndex.reason;
    } else {
      const drift = computeDrift(kind, parsedIndex.rows, expectedRows);
      if (drift.orderConflict) {
        verdict = "rejected";
        reason = drift.reason;
      } else {
        changes = drift.changes;
        verdict = changes.length === 0 ? "in-sync" : "sync";
      }
    }
  }

  const plannedFiles = verdict === "sync" || verdict === "create" ? [`${directory}/README.md`] : [];
  const planHash = sha256Text(JSON.stringify({ kind, directory, verdict, changes, plannedFiles }));

  const plan: SyncPlan = {
    kind,
    directory,
    indexPath: `${directory}/README.md`,
    verdict,
    ...(reason ? { reason } : {}),
    changes,
    pins: { sources, index: indexPin, fileList: files },
    planHash,
    plannedFiles,
  };
  return { plan, generated, existing };
}

function planImplIndexSync(cwd: string, kind: ImplIndexKind, explicitDir?: string): SyncPlan {
  return computeImplIndexSync(cwd, kind, explicitDir).plan;
}

// --- apply ------------------------------------------------------------------

// Re-verify the plan pins against the live filesystem so a source, README, or
// directory change between preview and apply fails closed with zero writes.
function verifyCurrentState(cwd: string, plan: SyncPlan): boolean {
  try {
    const dirAbs = path.join(cwd, plan.directory);
    const ext = plan.kind === "ir" ? ".md" : ".jsonl";
    const files = listFiles(dirAbs, ext);
    if (!sameSequence(files, plan.pins.fileList)) return false;
    for (const file of files) {
      if (sha256File(path.join(dirAbs, file)) !== plan.pins.sources[file]) return false;
    }
    const indexAbs = path.join(dirAbs, "README.md");
    let indexStats: fs.Stats | null = null;
    try {
      indexStats = fs.lstatSync(indexAbs);
    } catch {
      indexStats = null;
    }
    if (!indexStats) return plan.pins.index === null;
    if (!indexStats.isFile()) return false;
    if (plan.pins.index === null) return false;
    return sha256File(indexAbs) === plan.pins.index;
  } catch {
    return false;
  }
}

function applyImplIndexSync(
  cwd: string,
  kind: ImplIndexKind,
  explicitDir?: string,
  options?: { expectPlanHash?: string },
): { plan: SyncPlan; written: boolean } {
  const { plan, generated, existing } = computeImplIndexSync(cwd, kind, explicitDir);

  if (options?.expectPlanHash !== undefined && options.expectPlanHash !== plan.planHash) {
    const drift = `plan drift: expected planHash ${options.expectPlanHash}, recomputed ${plan.planHash}`;
    plan.reason = plan.reason ? `${plan.reason}; ${drift}` : drift;
    return { plan, written: false };
  }
  if (plan.verdict === "in-sync" || plan.verdict === "rejected") {
    return { plan, written: false };
  }
  if (!verifyCurrentState(cwd, plan)) {
    plan.reason = plan.reason
      ? `${plan.reason}; index sources changed since the plan was computed`
      : "index sources changed since the plan was computed";
    return { plan, written: false };
  }

  const indexAbs = path.join(cwd, plan.directory, "README.md");
  try {
    if (fs.lstatSync(indexAbs).isSymbolicLink()) {
      plan.reason = "index README.md became a symbolic link; refusing to write through it";
      return { plan, written: false };
    }
  } catch {
    // missing README is the create path — nothing to guard
  }

  const merged = existing === null ? generated : mergeManagedIndex(existing, generated);
  fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
  const tmpPath = path.join(path.dirname(indexAbs), `.README.md.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, merged, "utf8");
    fs.renameSync(tmpPath, indexAbs);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    const message = error instanceof Error ? error.message : String(error);
    plan.reason = plan.reason ? `${plan.reason}; write failed: ${message}` : `write failed: ${message}`;
    return { plan, written: false };
  }
  return { plan, written: true };
}

export {
  applyImplIndexSync,
  parseImplIndexRows,
  planImplIndexSync,
};

export type {
  ImplIndexKind,
  ImplIndexRow,
  IndexVerdict,
  ManagedIndexRows,
  SyncChange,
  SyncPlan,
};
