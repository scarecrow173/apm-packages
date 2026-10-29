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
import { case14c } from "../cases/case-14-briefing-execution";
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
  // The default fixture has a shared design chain. Make the spec invalid first.
  updateArtifact(repo, audit.spec, { status: "draft" });
  assert.deepEqual(checkExpectations(run, { briefingAudit: { ...audit, consistent: false } }), []);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, consistent: true } }).join("\n"), /briefingAudit:/);
  updateArtifact(repo, audit.spec, { status: "proposed" });
  assert.deepEqual(checkExpectations(run, { briefingAudit: { ...audit, consistent: true } }), []);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, consistent: false } }).join("\n"), /briefingAudit:/);
  assert.match(checkExpectations(run, { briefingAudit: { ...audit, spec: "missing.md", consistent: true } }).join("\n"), /briefingAudit:/);
});

test("briefing pending audit refuses a spec edit between yield and resume", { timeout: 120_000 }, () => {
  const e2eCase: E2ECase = {
    ...case14c,
    id: "harness-briefing-stale-pending-audit",
    steps: [
      case14c.steps![0],
      {
        mutateBefore: [{ append: { path: "docs/specs/0001-graph.md", body: "\nChanged before resume.\n" } }],
        expect: {
          yield: "authority-required",
          edgeSequence: ["briefing-retry"],
          completedEdges: ["probe-to-briefing"],
          events: [
            { kind: "effect-dispatched", edgeId: "briefing-retry", count: 0 },
          ],
          briefingAudit: { spec: "docs/specs/0001-graph.md", adr: "docs/adr/0001-graph.md", consistent: false },
          checkpointReceipts: [{ edgeId: "briefing-retry", count: 0 }],
        },
      },
    ],
    expect: {
      yield: "authority-required",
      edgeSequence: ["briefing-retry"],
      completedEdges: ["probe-to-briefing"],
      events: [
        { kind: "run-yield", reason: "input-required", count: 1 },
        { kind: "run-yield", reason: "authority-required", count: 1 },
        { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "audit", count: 2 },
        { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "delegate", count: 1 },
      ],
      briefingAudit: { spec: "docs/specs/0001-graph.md", adr: "docs/adr/0001-graph.md", consistent: false },
      checkpointReceipts: [{ edgeId: "briefing-retry", count: 0 }],
    },
  };
  const { report } = runCase(e2eCase);
  assert.deepEqual(report.failures, []);
});

// Issue #124: the baseline separates the runtime scan channel (summed
// artifact-scan events — the whole-repo projection, which is allowed) from
// the document bodies actually supplied to dispatched effects (the union of
// every accepted outcome's authoritativeInputs paths).
test("runCase records a scan-vs-delegate-input read baseline", { timeout: 120_000 }, () => {
  const { run, report } = runCase(case01);
  assert.deepEqual(report.failures, []);
  const baseline = run.baseline;
  assert.ok(baseline, "run.baseline missing");

  // Delegate inputs = unique authoritativeInputs paths across every accepted
  // outcome of the run (audit and delegate stages alike — both are bodies
  // handed to the dispatched effect, not to the scan channel).
  const expectedInputs = new Set(
    run.result.outcomes.flatMap((outcome) => outcome.authoritativeInputs.map((ref) => ref.path)),
  );
  assert.equal(baseline.delegateInputs.files, expectedInputs.size);
  assert.ok(baseline.delegateInputs.files > 0);
  assert.ok(baseline.delegateInputs.bytes > 0);

  // Scan totals come straight from the trace's artifact-scan events — the
  // same aggregation traceSummary reports, so the two channels agree.
  assert.equal(baseline.scan.files, report.traceSummary.filesRead);
  assert.equal(baseline.scan.bytes, report.traceSummary.bytesRead);

  // Every delegate input is itself a canonical doc the scan re-reads at each
  // routing hop, so the scan strictly dominates on this fixture and the
  // ratio stays within [0, 1]. (artifact-scan events do NOT count the
  // caller's own canonicalReference reads — inputs ⊆ scanned set is what
  // keeps the bound honest here.)
  assert.ok(baseline.scan.files >= baseline.delegateInputs.files);
  assert.ok(baseline.scan.bytes >= baseline.delegateInputs.bytes);
  assert.ok(baseline.ratio > 0 && baseline.ratio <= 1);
});

test("leg-boundary audit and receipt expectations are not evaluated on final state", { timeout: 120_000 }, () => {
  const first = case14c.steps![0];
  const e2eCase: E2ECase = {
    ...case14c,
    id: "harness-briefing-leg-snapshot",
    steps: [
      {
        ...first,
        expect: {
          ...first.expect,
          briefingAudit: { spec: "docs/specs/0001-graph.md", adr: "docs/adr/0001-graph.md", consistent: true },
          checkpointReceipts: [{ edgeId: "briefing-retry", count: 1 }],
        },
      },
      case14c.steps![1],
    ],
  };
  const { report } = runCase(e2eCase);
  assert.equal(report.failures.length, 2);
  assert.match(report.failures.join("\n"), /leg 1: briefingAudit:/);
  assert.match(report.failures.join("\n"), /leg 1: checkpointReceipts briefing-retry: expected 1, got 0/);
});
