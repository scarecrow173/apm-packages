import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CASES } from "./cases";
import { runCase } from "./harness/run_case"; // thin wrapper: fixture → runner → validator → report
import {
  compareNormalizedTraces,
  formatReport,
  writeReportJson,
  type CaseReport,
} from "./harness/reporter";

const reports: CaseReport[] = [];

/**
 * Determinism lane: these cases run a SECOND time inside their test and the
 * re-run's normalized trace must deep-equal the first run's
 * (`compareNormalizedTraces` over `normalizeForCompare`). The subset is
 * deliberately small — one case per behavior family — so the lane adds
 * < ~60s to a suite that already runs ~500s; doubling all 66 cases would
 * buy no marginal signal over what the per-case event shape/count
 * expectations already pin globally. Representative picks:
 *   e2e-09  multi-leg yield/resume + commit gate
 *   e2e-17a ops-only migration lane (emits no trace events — the re-run
 *           still re-verifies its op expectations end to end)
 *   e2e-22a Execution Store–mutating run (CAS task-record writes)
 *   e2e-24a evidence lane (immutable Evidence Record ops)
 *   e2e-30a caller refusal (throws before any route is accepted)
 */
const DETERMINISM_SAMPLE = new Set(["e2e-09", "e2e-17a", "e2e-22a", "e2e-24a", "e2e-30a"]);

for (const e2eCase of CASES) {
  test(`e2e ${e2eCase.id}: ${e2eCase.description}`, { timeout: 120_000 }, (t) => {
    const { run, report } = runCase(e2eCase);
    reports.push(report);
    // Reference-only artifact: refreshed after every case so a failing run
    // still leaves the accumulated report on disk.
    writeReportJson(reports, path.join(os.tmpdir(), "e2e-report.jsonl"));
    t.diagnostic(formatReport(reports));
    if (report.failures.length > 0) {
      throw new Error(`${e2eCase.id} failed:\n${report.failures.join("\n")}`);
    }
    assert.equal(report.pass, true);
    if (!DETERMINISM_SAMPLE.has(e2eCase.id)) return;
    // Determinism lane: the second run is a fresh fixture — it must pass its
    // own expectations AND reproduce a normalized-identical trace. Its
    // report stays out of `reports` (one row per case in table/JSONL).
    const rerun = runCase(e2eCase);
    const diffs = compareNormalizedTraces(run.traceEvents, rerun.run.traceEvents);
    t.diagnostic(
      `determinism lane ${e2eCase.id}: re-run ${rerun.run.traceEvents.length} trace events,`
      + ` ${diffs.length} normalized diffs`,
    );
    const problems = [
      ...rerun.report.failures.map((failure) => `re-run: ${failure}`),
      ...diffs,
    ];
    if (problems.length > 0) {
      throw new Error(`${e2eCase.id} determinism lane failed:\n${problems.join("\n")}`);
    }
  });
}
