/**
 * Case reporter: per-case report records, an aligned text summary, JSONL
 * output, and normalized trace comparison for reproducibility checks.
 * durationMs is reference-only — it is never asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  normalizeForCompare,
  summarizeTrace,
  type TraceEvent,
  type TraceSummary,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import type { CaseRun } from "./case_validator";

export type CaseReport = {
  caseId: string;
  pass: boolean;
  yieldReason: string | null;
  hops: number;
  edgeSequence: string[];
  failures: string[];
  traceSummary: TraceSummary;
  /** Reference only — never asserted. */
  durationMs: number;
};

export function reportCase(caseId: string, run: CaseRun, failures: string[], durationMs: number): CaseReport {
  const yieldEvents = run.traceEvents.filter((event) => event.kind === "run-yield");
  const lastYield = yieldEvents.at(-1);
  return {
    caseId,
    pass: failures.length === 0,
    yieldReason: lastYield?.reason ?? run.result.yieldReason,
    hops: lastYield?.hops ?? run.result.hops,
    edgeSequence: run.traceEvents
      .filter((event) => event.kind === "route-selected")
      .map((event) => event.edgeId ?? event.status),
    failures: [...failures],
    traceSummary: summarizeTrace(run.traceEvents),
    durationMs,
  };
}

/** Aligned text table + failure detail. */
export function formatReport(reports: CaseReport[]): string {
  const header = ["case", "result", "yield", "hops", "ms", "edges"];
  const rows = reports.map((report) => [
    report.caseId,
    report.pass ? "PASS" : "FAIL",
    report.yieldReason ?? "—",
    String(report.hops),
    String(report.durationMs),
    report.edgeSequence.join(" → "),
  ]);
  const widths = header.map((title, column) => Math.max(
    title.length,
    ...rows.map((row) => row[column].length),
  ));
  const line = (row: string[]): string => row
    .map((cell, column) => cell.padEnd(widths[column]))
    .join("  ")
    .trimEnd();
  const lines = [line(header), line(widths.map((width) => "-".repeat(width)))];
  for (const row of rows) lines.push(line(row));
  for (const report of reports) {
    if (report.failures.length === 0) continue;
    lines.push("", `${report.caseId} failures:`);
    for (const failure of report.failures) lines.push(`  - ${failure}`);
  }
  return lines.join("\n");
}

/** JSONL — one CaseReport per line. */
export function writeReportJson(reports: CaseReport[], file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, reports.map((report) => JSON.stringify(report)).join("\n") + "\n", "utf8");
}

/** Deep-equal comparison over normalizeForCompare'd traces; returns diff strings. */
export function compareNormalizedTraces(a: TraceEvent[], b: TraceEvent[]): string[] {
  const diffs: string[] = [];
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (left.length !== right.length) {
    diffs.push(`trace length differs: ${left.length} vs ${right.length}`);
  }
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (!isDeepStrictEqual(left[index], right[index])) {
      diffs.push(
        `event ${index + 1} differs:` +
        `\n  a: ${JSON.stringify(left[index])}` +
        `\n  b: ${JSON.stringify(right[index])}`,
      );
    }
  }
  return diffs;
}
