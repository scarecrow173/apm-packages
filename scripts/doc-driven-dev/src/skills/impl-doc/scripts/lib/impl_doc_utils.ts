"use strict";

// ---------------------------------------------------------------------------
// impl/exp legacy readers — migration-dedicated only (Issue #249)
// ---------------------------------------------------------------------------
//
// `impl` and `exp` are legacy Registry-2 formats interpreted ONLY by
// migration tooling and the read-only owner audits; they have no durable
// Git form under Document Registry 3 and no creator/mutator entrypoint
// ships. This module is deliberately read-mostly: it parses the legacy
// front matter / JSONL corpus for `auditImplementationRecords` /
// `auditExperimentLogs` (doc-status owner audits + `migrate_ids`
// blockers), the strict managed-index row parser, and the impl-4col /
// exp-1col index writer the migration-owned index engine
// (`impl_index_sync.ts`, called by `migrate_ids` / `promote_index`) uses.
// The pre-v3 record/event writers are removed — nothing in the normal
// runtime mints or mutates impl/exp content.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { changeFields, GENERATED_INDEX_MARKER, GENERATED_SETTLED_MARKER, INDEX_TABLE_HEADER_1COL, INDEX_TABLE_HEADER_4COL, indexCell, isForeignDocType, isGeneratedIndex, mergeManagedIndex, parseDoc, renderIndexBody } from "../../../lib/doc_suite_utils";
import type { IndexRowEntry } from "../../../lib/doc_suite_utils";
import { resolveContainedDir } from "../../../lib/document_utils";
import { assertTypeScope } from "../../../lib/doc_ownership";
import { isSettledStatus } from "../../../lib/doc_lifecycle";
import { hasSection } from "../../../lib/markdown_sections";

const implStatuses = ["draft", "in-progress", "completed", "blocked", "abandoned", "superseded"] as const;
const experimentEventTypes = ["start", "observation", "hypothesis", "change", "validation", "error", "decision", "summary"] as const;

// Implementation records keep the pre-v3 legacy relation shape: `impl` is a
// migration-only registry type with no durable Git form, so its files carry
// the old vocabulary verbatim until the migration path consumes them. This
// local copy is intentionally NOT the Knowledge Relations v1 set — the
// shared writer's `relationFields` now stores only canonical forward
// relations (Issue #235).
const relationFields = [
  "source",
  "motivates",
  "decides-for",
  "realizes",
  "informs",
  "explains",
  "supersedes",
  "superseded-by",
  "implements",
  "implemented-by",
  "depends-on",
  "blocks",
  "related",
  "refines",
  "refined-by",
  "derives-from",
  "derived-by",
  "verifies",
  "verified-by",
  "references",
  "defers",
  "deferred-by",
] as const;
const implementationRecordSections = [
  "Summary",
  "Context",
  "Implementation",
  "Related Experiments",
  "Validation",
  "Risks",
  "Follow-ups",
] as const;

type Severity = "error" | "warning" | "info";

type Finding = {
  code: string;
  file: string | null;
  line?: number;
  message: string;
  severity: Severity;
};

type ChangeEntry = {
  type: string;
  [key: string]: unknown;
};

type ChangeField = typeof changeFields[number];
type RelationField = typeof relationFields[number];
type ExperimentEventType = typeof experimentEventTypes[number];

const changeEntrySchema = z.object({
  type: z.string().min(1),
}).passthrough();

const changesSchema = z.object(Object.fromEntries(
  changeFields.map((field) => [field, z.array(changeEntrySchema).default([])]),
)).default({});

const relationsSchema = z.object({
  ...Object.fromEntries(relationFields.map((field) => [field, z.array(z.string()).default([])])),
  changes: changesSchema,
}).prefault({});

const implementationRecordSchema = z.object({
  id: z.string().min(1),
  type: z.literal("impl"),
  status: z.enum(implStatuses),
  title: z.string().min(1),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  owners: z.array(z.string()),
  relations: relationsSchema,
  metadata: z.object({
    experiments: z.object({
      adopted: z.array(z.string()).default([]),
      rejected: z.array(z.string()).default([]),
    }),
  }),
}).passthrough();

const experimentEventBaseSchema = z.object({
  schema: z.string().min(1),
  experiment: z.string().min(1),
  seq: z.number().int().positive(),
  type: z.string().min(1),
  ts: z.string().min(1),
}).passthrough();

function posixRelative(from: string, to: string): string {
  return path.relative(from, to).replace(/\\/g, "/");
}

function normalizeFilePath(input: string): string {
  return input.replace(/\\/g, "/");
}

function isExternalLink(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

function defaultImplDir(kind: "ir" | "exp"): string {
  return kind === "ir" ? "docs/impl/ir" : "docs/impl/exp";
}

function implDir(cwd: string, kind: "ir" | "exp", explicitDir?: string): string {
  // An explicit --dir is a directory selector like --task-dir: contained by
  // the same shared rule so an escaping value is rejected, not walked or
  // written outside the checkout (Issue #156). Ownership then decides
  // whether impl/exp artifacts may live there at all (Issue #183).
  const resolved = explicitDir ? resolveContainedDir(cwd, explicitDir) : defaultImplDir(kind);
  assertTypeScope(kind === "ir" ? "impl" : "exp", resolved);
  return resolved;
}

function listFiles(dir: string, ext: ".md" | ".jsonl"): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(ext))
    .filter((file) => ext !== ".md" || (!/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file)))
    .filter((file) => !fs.lstatSync(path.join(dir, file)).isSymbolicLink())
    .sort();
}

function normalizeExperimentPath(cwd: string, filePath: string): string {
  return normalizeFilePath(posixRelative(cwd, path.resolve(filePath)));
}

type IndexUpdateResult = { written: boolean; reason: "hand-curated" | null };

function writeImplIndex(indexPath: string, content: string, legacyTitle: string, force = false): IndexUpdateResult {
  // lstat before reading: a symlink (even a broken one) must never be
  // written through to its target.
  let isSymlink = false;
  try {
    isSymlink = fs.lstatSync(indexPath).isSymbolicLink();
  } catch {
    isSymlink = false;
  }
  if (isSymlink) return { written: false, reason: "hand-curated" };
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : null;
  if (!force && existing !== null && !isGeneratedIndex(existing, legacyTitle)) {
    return { written: false, reason: "hand-curated" };
  }
  const merged = existing !== null && existing.includes(GENERATED_INDEX_MARKER)
    ? mergeManagedIndex(existing, content)
    : content;
  fs.writeFileSync(indexPath, merged, "utf8");
  return { written: true, reason: null };
}

// --- managed index rows (shared by index sync planning and owner audits) ----

type ImplIndexParseCode =
  | "missing-marker"
  | "ambiguous-marker"
  | "missing-directory"
  | "bad-table-header"
  | "bad-row"
  | "escaping-row"
  | "stray-settled-marker"
  | "stray-table-row"
  | "duplicate-row";

type ImplIndexRow = {
  file: string;
  cells: string[];
  tier: "active" | "settled";
};

type ManagedIndexRows =
  | { ok: true; rows: ImplIndexRow[] }
  | { ok: false; reason: string; code: ImplIndexParseCode };

const SETTLED_HEADING = `## Settled ${GENERATED_SETTLED_MARKER}`;
const [IR_HEADER_LINE, IR_SEPARATOR_LINE] = INDEX_TABLE_HEADER_4COL.split("\n");
const [EXP_HEADER_LINE, EXP_SEPARATOR_LINE] = INDEX_TABLE_HEADER_1COL.split("\n");

// Split a `| a | b |` row into trimmed cell texts, preserving `\|` escapes so
// comparisons against `indexCell`-rendered expectations stay exact. Returns
// null when the line is not a well-formed pipe row.
function splitRowCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  if (!trimmed.endsWith("|") || trimmed.endsWith("\\|")) return null;
  const body = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      current += ch + body[i + 1];
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

// Extract the row's file identity from its file cell: a markdown link whose
// target is `./<bare-filename>`. Anything else fails closed — `bad-row` for
// malformed cells, `escaping-row` for targets that leave the index directory.
function extractRowFile(cell: string): { file: string } | { code: "bad-row" | "escaping-row" } {
  const match = /^\[(.*)\]\((.*)\)$/.exec(cell.trim());
  if (!match) return { code: "bad-row" };
  const target = match[2].trim();
  if (target.startsWith("./")) {
    const file = target.slice(2);
    if (file !== "" && file !== "." && file !== ".." && !/[/\\:]/.test(file)) return { file };
    return { code: "escaping-row" };
  }
  if (/^\.{1,2}\//.test(target) || target.startsWith("/") || /^[a-zA-Z]:/.test(target)) {
    return { code: "escaping-row" };
  }
  return { code: "bad-row" };
}

/**
 * Strict managed-index row parser — the single authority index sync planning
 * and owner audits share. Accepts only the exact structure the impl index
 * writers emit: one generated-index marker, a `Directory:` line, the
 * canonical table header and separator, well-formed rows, and at most one
 * `## Settled` tier. Anything else is a structured error, never a guess.
 */
function parseImplIndexRows(content: string, kind: "ir" | "exp"): ManagedIndexRows {
  const fail = (reason: string, code: ImplIndexParseCode): ManagedIndexRows => ({ ok: false, reason, code });
  const lines = content.split("\n");

  const markerLines = lines.filter((line) => line.includes(GENERATED_INDEX_MARKER));
  if (markerLines.length === 0) {
    return fail("hand-curated or ambiguous index: missing generated-index marker", "missing-marker");
  }
  if (markerLines.length > 1) {
    return fail("ambiguous index: multiple generated-index markers", "ambiguous-marker");
  }
  const markerIndex = lines.findIndex((line) => line.includes(GENERATED_INDEX_MARKER));

  const expectedCells = kind === "ir" ? 4 : 1;
  const fileCellIndex = kind === "ir" ? 3 : 0;
  const headerLine = kind === "ir" ? IR_HEADER_LINE : EXP_HEADER_LINE;
  const separatorLine = kind === "ir" ? IR_SEPARATOR_LINE : EXP_SEPARATOR_LINE;

  let cursor = markerIndex + 1;
  const skipBlank = (): void => {
    while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  };

  const parseRow = (line: string, tier: ImplIndexRow["tier"]): ImplIndexRow | { error: string; code: ImplIndexParseCode } => {
    const cells = splitRowCells(line);
    if (!cells || cells.length !== expectedCells) {
      return { error: `unparseable ${tier} index row: ${line.trim()}`, code: "bad-row" };
    }
    const fileCell = extractRowFile(cells[fileCellIndex]);
    if ("code" in fileCell) {
      return { error: `unparseable ${tier} index row: ${line.trim()}`, code: fileCell.code };
    }
    return { file: fileCell.file, cells, tier };
  };

  const parseTable = (tier: ImplIndexRow["tier"]): { rows: ImplIndexRow[] } | { error: string; code: ImplIndexParseCode } => {
    if (
      cursor + 1 >= lines.length
      || lines[cursor].trim() !== headerLine
      || lines[cursor + 1].trim() !== separatorLine
    ) {
      return { error: `malformed ${tier} index table header`, code: "bad-table-header" };
    }
    cursor += 2;
    const rows: ImplIndexRow[] = [];
    while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
      const row = parseRow(lines[cursor], tier);
      if ("error" in row) return row;
      rows.push(row);
      cursor += 1;
    }
    return { rows };
  };

  skipBlank();
  if (cursor >= lines.length || !lines[cursor].trim().startsWith("Directory:")) {
    return fail("missing Directory line after the generated-index marker", "missing-directory");
  }
  cursor += 1;

  skipBlank();
  const active = parseTable("active");
  if ("error" in active) return fail(active.error, active.code);

  skipBlank();
  const rows: ImplIndexRow[] = [...active.rows];
  if (cursor < lines.length && lines[cursor].trim() === SETTLED_HEADING) {
    cursor += 1;
    skipBlank();
    const settled = parseTable("settled");
    if ("error" in settled) return fail(settled.error, settled.code);
    rows.push(...settled.rows);
    skipBlank();
  }

  // Everything past the recognized region is hand-owned tail — except stray
  // index markers or table rows, which make the structure ambiguous.
  for (; cursor < lines.length; cursor += 1) {
    const trimmed = lines[cursor].trim();
    if (trimmed.includes(GENERATED_SETTLED_MARKER)) {
      return fail("settled-index marker outside the managed index region", "stray-settled-marker");
    }
    if (trimmed.startsWith("|")) {
      return fail("table row outside the managed index region", "stray-table-row");
    }
  }

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.file)) return fail(`duplicate index row for ${row.file}`, "duplicate-row");
    seen.add(row.file);
  }
  return { ok: true, rows };
}

// IR index entries — the single extraction the index writers, the sync
// planner, and the owner audits share, so expected rows stay byte-identical.
function implIndexEntries(dirAbs: string, relativeDir: string, files: string[]): IndexRowEntry[] {
  return files.flatMap((file) => {
    const parsed = parseDoc(fs.readFileSync(path.join(dirAbs, file), "utf8"));
    if (parsed.error) return [];
    if (isForeignDocType(parsed.data.type, "impl", relativeDir)) return [];
    const title = typeof parsed.data.title === "string" && parsed.data.title.trim()
      ? parsed.data.title.trim()
      : ((/^#\s+(.+)$/m.exec(parsed.body)?.[1]) || path.basename(file, ".md"));
    const id = typeof parsed.data.id === "string" ? parsed.data.id : null;
    const status = typeof parsed.data.status === "string" ? parsed.data.status : null;
    return [{ file, id, status, title, type: typeof parsed.data.type === "string" ? parsed.data.type : null }];
  });
}

type ExpectedIndexRow = { cells: string[]; tier: "active" | "settled" };

// Expected index rows derived from source truth, mirroring what the owner
// writers would emit: IR cells come from front matter via implIndexEntries,
// EXP rows are bare ./filename links in listFiles order.
function expectedIndexRows(kind: "ir" | "exp", dirAbs: string, relativeDir: string, files: string[]): Map<string, ExpectedIndexRow> {
  const expected = new Map<string, ExpectedIndexRow>();
  if (kind === "exp") {
    for (const file of files) {
      expected.set(file, { cells: [`[${indexCell(file)}](./${indexCell(file)})`], tier: "active" });
    }
    return expected;
  }
  for (const entry of implIndexEntries(dirAbs, relativeDir, files)) {
    expected.set(entry.file, {
      cells: [
        indexCell(entry.id || "—"),
        indexCell(entry.title),
        indexCell(entry.status || "—"),
        `[${indexCell(entry.file)}](./${indexCell(entry.file)})`,
      ],
      tier: isSettledStatus(entry.type ?? "impl", entry.status) ? "settled" : "active",
    });
  }
  return expected;
}

function expectedIndexSequence(kind: "ir" | "exp", expected: Map<string, ExpectedIndexRow>): string[] {
  if (kind === "exp") return [...expected.keys()];
  const tierFiles = (tier: "active" | "settled"): string[] =>
    [...expected.entries()]
      .filter(([, want]) => want.tier === tier)
      .map(([file]) => file)
      .sort((left, right) => left.localeCompare(right));
  return [...tierFiles("active"), ...tierFiles("settled")];
}

function cellsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function sameStringSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Index-aware section of the owner audits: classifies the README strictly
// (fail-closed like the sync planner) and reports granular drift findings.
// Never writes; severity stays warning/info except structural escapes and
// unparseable indexes, which are errors.
function auditManagedIndex(
  kind: "ir" | "exp",
  dirAbs: string,
  relativeDir: string,
  files: string[],
  findings: Finding[],
): void {
  const indexPath = path.join(dirAbs, "README.md");
  let stats: fs.Stats | null = null;
  try {
    stats = fs.lstatSync(indexPath);
  } catch {
    stats = null;
  }
  if (!stats) return; // caller reports the missing-index warning
  const push = (code: string, message: string, severity: Severity): void => {
    findings.push({ code, file: "README.md", message: `${relativeDir}/README.md ${message}`, severity });
  };
  if (!stats.isFile()) {
    push("index-not-managed", "is a symbolic link or not a regular file", "warning");
    return;
  }
  const content = fs.readFileSync(indexPath, "utf8");
  const parsed = parseImplIndexRows(content, kind);
  if (!parsed.ok) {
    const code = parsed.code === "missing-marker" || parsed.code === "ambiguous-marker" ? "index-not-managed"
      : parsed.code === "duplicate-row" ? "index-duplicate-entry"
      : parsed.code === "escaping-row" ? "index-escapes-root"
      : "index-unparseable";
    const severity: Severity = code === "index-escapes-root" || code === "index-unparseable" ? "error" : "warning";
    push(code, `is not a manageable generated index: ${parsed.reason}`, severity);
    return;
  }
  const expected = expectedIndexRows(kind, dirAbs, relativeDir, files);
  const rowsByFile = new Map(parsed.rows.map((row) => [row.file, row]));
  for (const [file, want] of expected) {
    const row = rowsByFile.get(file);
    if (!row) {
      push("index-missing-entry", `has no row for ${file}`, "warning");
      continue;
    }
    if (!cellsEqual(row.cells, want.cells)) {
      push("index-metadata-mismatch", `row for ${file} does not match the document front matter`, "warning");
    }
    if (row.tier !== want.tier) {
      push("index-tier-mismatch", `row for ${file} sits in the ${row.tier} tier but the document expects ${want.tier}`, "warning");
    }
  }
  for (const row of parsed.rows) {
    if (!expected.has(row.file)) {
      push("index-stale-entry", `row links ${row.file}, which is not an indexable document in this directory`, "warning");
    }
  }
  const currentSequence = parsed.rows.filter((row) => expected.has(row.file)).map((row) => row.file);
  if (!sameStringSequence(currentSequence, expectedIndexSequence(kind, expected))) {
    push("index-ordering", "row order differs from the deterministic index order", "info");
  }
}

function updateIndexForMarkdownDir(cwd: string, relativeDir: string, options?: { force?: boolean }): IndexUpdateResult {
  const dir = path.join(cwd, relativeDir);
  const files = listFiles(dir, ".md");
  const body = renderIndexBody(implIndexEntries(dir, relativeDir, files), { settledType: "impl" });
  return writeImplIndex(
    path.join(dir, "README.md"),
    `# Implementation Records\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${relativeDir}\`\n\n${body}\n`,
    "Implementation Records",
    options?.force === true,
  );
}

function updateIndexForExperimentDir(cwd: string, relativeDir: string, options?: { force?: boolean }): IndexUpdateResult {
  const dir = path.join(cwd, relativeDir);
  const files = listFiles(dir, ".jsonl");
  const header = INDEX_TABLE_HEADER_1COL;
  const rows = files.map((file) => `| [${indexCell(file)}](./${indexCell(file)}) |`);
  const body = rows.length > 0 ? `${header}\n${rows.join("\n")}` : header;
  return writeImplIndex(
    path.join(dir, "README.md"),
    `# Experiment Logs\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${relativeDir}\`\n\n${body}\n`,
    "Experiment Logs",
    options?.force === true,
  );
}

function resolvesLocalTarget(cwd: string, fromFile: string, target: string): boolean {
  const candidates = [
    path.resolve(cwd, target),
    path.resolve(path.dirname(fromFile), target),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function relationLinks(relations: Record<string, unknown>): Array<{ field: RelationField; target: string }> {
  return relationFields.flatMap((field) => {
    const targets = relations[field];
    return Array.isArray(targets) ? targets.map((target) => ({ field, target: String(target) })) : [];
  });
}

function auditImplementationRecords(cwd: string, relativeDir: string): { directory: string; files: number; findings: Finding[] } {
  const dir = path.join(cwd, relativeDir);
  const files = listFiles(dir, ".md");
  const findings: Finding[] = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const parsed = parseDoc(content);
    if (parsed.error) {
      findings.push({
        code: "unparseable-front-matter",
        file,
        message: `Front matter is not valid YAML: ${parsed.error}`,
        severity: "error",
      });
      continue;
    }
    if (isForeignDocType(parsed.data.type, "impl", relativeDir)) continue;
    const schemaResult = implementationRecordSchema.safeParse(parsed.data);
    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        findings.push({
          code: "invalid-front-matter",
          file,
          message: `Invalid front matter ${issue.path.join(".") || "$"}: ${issue.message}`,
          severity: "error",
        });
      }
      continue;
    }
    const data = schemaResult.data;
    for (const relation of relationLinks(data.relations)) {
      if (isExternalLink(relation.target)) continue;
      if (!resolvesLocalTarget(cwd, fullPath, relation.target)) {
        findings.push({
          code: "broken-relation-link",
          file,
          message: `Relation ${relation.field} points to missing target: ${relation.target}`,
          severity: "warning",
        });
      }
    }
    for (const experimentPath of [...data.metadata.experiments.adopted, ...data.metadata.experiments.rejected]) {
      if (!resolvesLocalTarget(cwd, fullPath, experimentPath)) {
        findings.push({
          code: "missing-experiment-link",
          file,
          message: `Experiment reference points to missing target: ${experimentPath}`,
          severity: "warning",
        });
      }
    }
    for (const section of implementationRecordSections) {
      if (!hasSection(parsed.body, section)) {
        findings.push({
          code: "missing-section",
          file,
          message: `Missing required section: ${section}`,
          severity: "error",
        });
      }
    }
  }
  const indexPath = path.join(dir, "README.md");
  let indexStats: fs.Stats | null = null;
  try {
    indexStats = fs.lstatSync(indexPath);
  } catch {
    indexStats = null;
  }
  if (!indexStats) {
    findings.push({ code: "missing-index", file: null, message: "Missing README.md index", severity: "warning" });
  } else {
    auditManagedIndex("ir", dir, relativeDir, files, findings);
  }
  return { directory: relativeDir, files: files.length, findings };
}

function auditExperimentLogs(cwd: string, relativeDir: string): { directory: string; files: number; findings: Finding[] } {
  const dir = path.join(cwd, relativeDir);
  const files = listFiles(dir, ".jsonl");
  const findings: Finding[] = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    let previousSeq = 0;
    const seen = new Set<number>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        findings.push({
          code: "invalid-json",
          file,
          line: index + 1,
          message: "Line is not valid JSON",
          severity: "error",
        });
        continue;
      }
      const baseResult = experimentEventBaseSchema.safeParse(parsed);
      if (!baseResult.success) {
        findings.push({
          code: "invalid-event-shape",
          file,
          line: index + 1,
          message: `Invalid event shape: ${baseResult.error.issues.map((issue) => issue.message).join(", ")}`,
          severity: "error",
        });
        continue;
      }
      if (parsed.schema !== "experiment_event.v1") {
        findings.push({
          code: "invalid-event-schema",
          file,
          line: index + 1,
          message: `Unexpected schema: ${String(parsed.schema)}`,
          severity: "error",
        });
      }
      if (!experimentEventTypes.includes(parsed.type as ExperimentEventType)) {
        findings.push({
          code: "invalid-event-type",
          file,
          line: index + 1,
          message: `Invalid event type: ${String(parsed.type)}`,
          severity: "error",
        });
      }
      const expectedPath = normalizeExperimentPath(cwd, fullPath);
      if (parsed.experiment !== expectedPath) {
        findings.push({
          code: "experiment-path-mismatch",
          file,
          line: index + 1,
          message: `Experiment path mismatch: expected ${expectedPath}`,
          severity: "error",
        });
      }
      const seq = parsed.seq as number;
      if (seen.has(seq) || seq <= previousSeq) {
        findings.push({
          code: "non-monotonic-seq",
          file,
          line: index + 1,
          message: `Sequence must be unique and strictly increasing: ${seq}`,
          severity: "error",
        });
      }
      seen.add(seq);
      previousSeq = seq;
    }
  }
  const indexPath = path.join(dir, "README.md");
  let indexStats: fs.Stats | null = null;
  try {
    indexStats = fs.lstatSync(indexPath);
  } catch {
    indexStats = null;
  }
  if (!indexStats) {
    findings.push({ code: "missing-index", file: null, message: "Missing README.md index", severity: "warning" });
  } else {
    auditManagedIndex("exp", dir, relativeDir, files, findings);
  }
  return { directory: relativeDir, files: files.length, findings };
}

export {
  auditExperimentLogs,
  auditImplementationRecords,
  implDir,
  implIndexEntries,
  listFiles,
  parseImplIndexRows,
  updateIndexForExperimentDir,
  updateIndexForMarkdownDir,
};

export type {
  ImplIndexParseCode,
  ImplIndexRow,
  ManagedIndexRows,
};
