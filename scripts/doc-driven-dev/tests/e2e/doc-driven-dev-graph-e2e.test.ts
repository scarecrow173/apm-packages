import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CASES } from "./cases";
import { runCase } from "./harness/run_case"; // thin wrapper: fixture → runner → validator → report
import { formatReport, writeReportJson, type CaseReport } from "./harness/reporter";

const reports: CaseReport[] = [];

for (const e2eCase of CASES) {
  test(`e2e ${e2eCase.id}: ${e2eCase.description}`, { timeout: 120_000 }, (t) => {
    const { report } = runCase(e2eCase);
    reports.push(report);
    // Reference-only artifact: refreshed after every case so a failing run
    // still leaves the accumulated report on disk.
    writeReportJson(reports, path.join(os.tmpdir(), "e2e-report.jsonl"));
    t.diagnostic(formatReport(reports));
    if (report.failures.length > 0) {
      throw new Error(`${e2eCase.id} failed:\n${report.failures.join("\n")}`);
    }
    assert.equal(report.pass, true);
  });
}
