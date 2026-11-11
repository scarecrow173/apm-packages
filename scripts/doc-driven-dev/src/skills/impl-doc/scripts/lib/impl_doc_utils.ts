"use strict";

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateArtifactId } from "../../../lib/artifact_id";
import { changeFields, GENERATED_INDEX_MARKER, GENERATED_SETTLED_MARKER, INDEX_TABLE_HEADER_1COL, INDEX_TABLE_HEADER_4COL, indexCell, isForeignDocType, isGeneratedIndex, mergeManagedIndex, parseDoc, relationFields, renderIndexBody, sanitizeTitle } from "../../../lib/doc_suite_utils";
import type { IndexRowEntry } from "../../../lib/doc_suite_utils";
import { resolveContainedDir, slugify } from "../../../lib/document_utils";
import { assertTypeScope } from "../../../lib/doc_ownership";
import { isSettledStatus } from "../../../lib/doc_lifecycle";
import { hasSection } from "../../../lib/markdown_sections";

const implStatuses = ["draft", "in-progress", "completed", "blocked", "abandoned", "superseded"] as const;
const experimentEventTypes = ["start", "observation", "hypothesis", "change", "validation", "error", "decision", "summary"] as const;
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

type RelationMap = Record<RelationField, string[]>;
type ChangeMap = Record<ChangeField, ChangeEntry[]>;

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

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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

function renderTemplate(name: string, replacements: Record<string, string>): string {
  const templatePath = path.join(__dirname, "../assets/templates", name);
  let content = fs.readFileSync(templatePath, "utf8").trimEnd();
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

function renderExperimentTemplate(replacements: Record<string, string>): Record<string, unknown> {
  const escaped = Object.fromEntries(
    Object.entries(replacements).map(([key, value]) => [key, JSON.stringify(value).slice(1, -1)]),
  );
  const content = renderTemplate("experiment-log.jsonl", escaped);
  return JSON.parse(content);
}

function emptyChanges(): ChangeMap {
  return Object.fromEntries(changeFields.map((field) => [field, [] as ChangeEntry[]])) as ChangeMap;
}

function emptyRelations(): RelationMap {
  return Object.fromEntries(relationFields.map((field) => [field, [] as string[]])) as RelationMap;
}

function completeRelations(input?: Partial<RelationMap>): RelationMap {
  const relations = emptyRelations();
  for (const field of relationFields) {
    relations[field] = input?.[field] || [];
  }
  return relations;
}

function completeChanges(input?: Partial<ChangeMap>): ChangeMap {
  const changes = emptyChanges();
  for (const field of changeFields) {
    changes[field] = input?.[field] || [];
  }
  return changes;
}

function formatScalar(key: string, value: string | number | boolean): string {
  if (typeof value === "string") return `${key}: ${quote(value)}`;
  return `${key}: ${String(value)}`;
}

function formatValue(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [`${key}:`, ...value.map((item) => `  - ${typeof item === "string" ? quote(item) : JSON.stringify(item)}`)];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [formatScalar(key, value)];
  }
  return [`${key}: ${quote(JSON.stringify(value))}`];
}

function formatChangeEntry(entry: ChangeEntry): string[] {
  const preferred = ["type", "path", "from", "to", "source"];
  const keys = [
    ...preferred.filter((key) => key in entry),
    ...Object.keys(entry).filter((key) => !preferred.includes(key)).sort(),
  ];
  return keys.flatMap((key) => formatValue(key, entry[key]));
}

function formatChanges(changes: ChangeMap): string[] {
  return [
    "  changes:",
    ...changeFields.flatMap((field) => {
      const entries = changes[field];
      if (entries.length === 0) return [`    ${field}: []`];
      return [
        `    ${field}:`,
        ...entries.flatMap((entry) => {
          const lines = formatChangeEntry(entry);
          return lines.length === 0
            ? ["      - {}"]
            : [
              `      - ${lines[0]}`,
              ...lines.slice(1).map((line) => `        ${line}`),
            ];
        }),
      ];
    }),
  ];
}

function formatRelationBlock(field: RelationField, values: string[]): string[] {
  if (values.length === 0) return [`  ${field}: []`];
  return [`  ${field}:`, ...values.map((value) => `    - ${quote(value)}`)];
}

function implementationRecordFrontMatter(options: {
  id: string;
  title: string;
  status: typeof implStatuses[number];
  date: string;
  relations?: Partial<RelationMap>;
  changes?: Partial<ChangeMap>;
  adopted?: string[];
  rejected?: string[];
}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`Invalid date: ${options.date} (expected YYYY-MM-DD)`);
  }
  const relations = completeRelations(options.relations);
  const changes = completeChanges(options.changes);
  return [
    "---",
    `id: ${quote(options.id)}`,
    `type: ${quote("impl")}`,
    `status: ${quote(options.status)}`,
    `title: ${quote(sanitizeTitle(options.title))}`,
    `created: ${quote(options.date)}`,
    `updated: ${quote(options.date)}`,
    "owners: []",
    "relations:",
    ...formatRelationBlock("source", relations.source),
    ...formatChanges(changes),
    ...relationFields.filter((field) => field !== "source").flatMap((field) => formatRelationBlock(field, relations[field])),
    "metadata:",
    "  experiments:",
    ...(options.adopted && options.adopted.length > 0
      ? ["    adopted:", ...options.adopted.map((item) => `      - ${quote(item)}`)]
      : ["    adopted: []"]),
    ...(options.rejected && options.rejected.length > 0
      ? ["    rejected:", ...options.rejected.map((item) => `      - ${quote(item)}`)]
      : ["    rejected: []"]),
    "---",
  ].join("\n");
}

function buildImplementationRecordContent(options: {
  id: string;
  title: string;
  status: typeof implStatuses[number];
  date: string;
  relations?: Partial<RelationMap>;
  changes?: Partial<ChangeMap>;
}): string {
  const title = sanitizeTitle(options.title);
  return `${implementationRecordFrontMatter({ ...options, title })}\n\n${renderTemplate("implementation-record.md", { title })}\n`;
}

function parseEventValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed) || /^[\[{"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function parseSetArguments(items: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    const pivot = item.indexOf("=");
    if (pivot <= 0) throw new Error(`Invalid --set value: ${item}`);
    const key = item.slice(0, pivot);
    const value = item.slice(pivot + 1);
    result[key] = parseEventValue(value);
  }
  return result;
}

function normalizeExperimentPath(cwd: string, filePath: string): string {
  return normalizeFilePath(posixRelative(cwd, path.resolve(filePath)));
}

function readExperimentEvents(filePath: string): Array<{ line: number; raw: string; value: Record<string, unknown> | null }> {
  if (!fs.existsSync(filePath)) throw new Error(`Experiment Log not found: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) return [];
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim())
    .map((entry) => {
      try {
        return { line: entry.index + 1, raw: entry.line, value: JSON.parse(entry.line) as Record<string, unknown> };
      } catch {
        return { line: entry.index + 1, raw: entry.line, value: null };
      }
    });
}

function nextExperimentSeq(events: Array<{ value: Record<string, unknown> | null }>): number {
  const seqs = events
    .map((event) => event.value?.seq)
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
  return seqs.length === 0 ? 1 : Math.max(...seqs) + 1;
}

function appendExperimentEvent(filePath: string, event: Record<string, unknown>): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(filePath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
}

function writeExperimentEvents(filePath: string, events: Record<string, unknown>[]): void {
  const content = events.length === 0 ? "" : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function buildExperimentEvent(options: {
  cwd: string;
  filePath: string;
  seq: number;
  type: ExperimentEventType;
  ts?: string;
  summary?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema: "experiment_event.v1",
    experiment: normalizeExperimentPath(options.cwd, options.filePath),
    seq: options.seq,
    type: options.type,
    ts: options.ts || new Date().toISOString(),
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.extra || {}),
  };
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

function buildNewFilePath(options: {
  cwd: string;
  kind: "ir" | "exp";
  title: string;
  explicitDir?: string;
}): { outputPath: string; relativeDir: string } {
  const relativeDir = implDir(options.cwd, options.kind, options.explicitDir);
  const fullDir = path.join(options.cwd, relativeDir);
  ensureDir(fullDir);
  const ext = options.kind === "ir" ? ".md" : ".jsonl";
  const filename = `${slugify(options.title, options.kind)}${ext}`;
  return {
    outputPath: path.join(fullDir, filename),
    relativeDir,
  };
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
  appendExperimentEvent,
  auditExperimentLogs,
  auditImplementationRecords,
  buildExperimentEvent,
  buildImplementationRecordContent,
  buildNewFilePath,
  emptyChanges,
  experimentEventTypes,
  implementationRecordSections,
  implDir,
  implIndexEntries,
  implStatuses,
  listFiles,
  normalizeExperimentPath,
  parseImplIndexRows,
  parseSetArguments,
  posixRelative,
  readExperimentEvents,
  renderExperimentTemplate,
  updateIndexForExperimentDir,
  updateIndexForMarkdownDir,
  writeExperimentEvents,
  nextExperimentSeq,
};

export type {
  ImplIndexParseCode,
  ImplIndexRow,
  ManagedIndexRows,
};
