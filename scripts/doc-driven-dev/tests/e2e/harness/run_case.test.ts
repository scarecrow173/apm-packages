/**
 * Harness wiring tests for run_case: the `resume:false` leg option and the
 * per-field expect scoping (final-leg yield/edgeSequence/completedEdges,
 * whole-run events tallies, end-of-run finalFiles). These are runner-plumbing
 * cases, not golden graph cases, so they live outside cases/CASES.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { E2ECase } from "./case_types";
import { runCase } from "./run_case";
import { case01 } from "../cases/case-01-happy-path";
import { checkExpectations, type CaseRun } from "./case_validator";
import { createFixtureRepo, updateArtifact } from "./fixture_manager";

const HAPPY_SEQUENCE = [
  "probe-to-briefing", "briefing-to-design", "design-to-planning",
  "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
  "followup-triage-terminal", "exit-audit-to-complete",
];
const SIGNALS = ["implementation-verified", "followup-terminal", "exit-audit-pass"];

// Leg 1 is a blocked run (focus:[]) — handoff.current stays at the entry node
// and leg 2 must run a FRESH run, not a resume (the e2e-02 shape). Top-level
// edgeSequence asserts only leg 2's routes; events tally the whole run.
const resumeFalseBlockedLeg: E2ECase = {
  id: "harness-resume-false-blocked-leg",
  description: "leg 2 resume:false runs fresh on the same trace after a blocked leg",
  fixture: { taskStatuses: ["todo"] },
  script: case01.script,
  steps: [
    { options: { focus: [] }, expect: { yield: "input-required", edgeSequence: [null] } },
    {
      options: { resume: false, focus: ["PLAN-0001"], signals: SIGNALS },
      expect: { yield: "terminal" },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_SEQUENCE, null], // last-leg scope — NOT the 10-event whole trace
    completedEdges: HAPPY_SEQUENCE,
    events: [{ kind: "route-selected", count: 10 }], // 1 blocked (leg 1) + 9 (leg 2)
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};

// Leg 1 completes probe-to-briefing in single-step mode, leaving
// handoff.current = "briefing". Leg 2 with resume:false must re-start at the
// entry node — if the handoff leaked through, its first edge would be
// briefing-to-design instead of probe-to-briefing.
const resumeFalseRestartsAtEntry: E2ECase = {
  id: "harness-resume-false-entry",
  description: "leg 2 resume:false restarts at entry instead of the handoff node",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  signals: SIGNALS,
  script: case01.script,
  steps: [
    {
      options: { mode: "single-step" },
      expect: {
        yield: "single-step-complete",
        edgeSequence: ["probe-to-briefing"],
        completedEdges: ["probe-to-briefing"],
      },
    },
    { options: { resume: false }, expect: { yield: "terminal" } },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_SEQUENCE, null], // starts at probe, not briefing
    completedEdges: HAPPY_SEQUENCE,
  },
};

const CASES = [resumeFalseBlockedLeg, resumeFalseRestartsAtEntry];

for (const e2eCase of CASES) {
  test(`harness ${e2eCase.id}: ${e2eCase.description}`, { timeout: 120_000 }, () => {
    const { report } = runCase(e2eCase);
    if (report.failures.length > 0) {
      throw new Error(`${e2eCase.id} failed:\n${report.failures.join("\n")}`);
    }
    assert.equal(report.pass, true);
  });
}

test("briefing audit expectation checks JSON and exit status for both outcomes", () => {
  const repo = createFixtureRepo();
  const run = { repo, traceEvents: [] } as unknown as CaseRun;
  const audit = { spec: "docs/specs/0001-graph.md", adr: "docs/adr/0001-graph.md" };
  // Default fixture has no spec/ADR pairing; checking for true must fail.
  assert.deepEqual(checkExpectations(run, { briefingAudit: { ...audit, consistent: false } }), []);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, consistent: true } }).join("\n"), /briefingAudit:/);
  updateArtifact(repo, audit.spec, { relations: { "derives-from": ["ADR-0001"] } });
  assert.deepEqual(checkExpectations(run, { briefingAudit: { ...audit, consistent: true } }), []);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, consistent: false } }).join("\n"), /briefingAudit:/);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, spec: "missing.md", consistent: true } }).join("\n"), /briefingAudit:/);
});
