import type { CallerEffect } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { DelegateMode, PolicyFacts } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import type { E2ECase } from "../harness/case_types";
import { case01 } from "./case-01-happy-path";

const spec = "docs/specs/0001-graph.md";
const adr = "docs/adr/0001-graph.md";
const discovery = "docs/discovery/0001-graph.md";
const fixture = { files: {
  [spec]: { frontmatter: { id: "SPEC-0001", type: "spec", status: "draft", title: "Graph" }, body: "# Graph\n" },
  [adr]: { frontmatter: { id: "ADR-0001", type: "adr", status: "draft", title: "Graph" }, body: "# Graph\n" },
  [discovery]: { frontmatter: { id: "DISC-0001", type: "discovery", status: "accepted", title: "Graph" }, body: "# Discovery\n" },
} };
const specWrite = { write: { path: spec, frontmatter: { status: "proposed", relations: { "derives-from": ["DISC-0001"] } }, body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n" } };
const adrWrite = { write: { path: adr, frontmatter: { status: "accepted", relations: { "derives-from": ["DISC-0001"] } }, body: "# Graph\n\n## Considered Options\n\n### A\n\n### B\n" } };
const modes = new Set<DelegateMode>(["same-context", "subagent-as-tool", "isolated-subagent"]);
const policy = (_route: unknown, effect: CallerEffect): PolicyFacts => ({
  effectId: effect.id, stage: effect.kind, independentScope: false,
  sharedJudgment: effect.kind === "delegate" && effect.id === "briefing-flow",
  contextCost: "low", parallelCandidate: false, hostCapabilities: modes,
});

// The graph dispatches briefing-flow once; the scripted dispatcher simulates
// its writes. The mode is policy attribution, not evidence of skill execution.
export const case14a: E2ECase = {
  id: "e2e-14a",
  description: "scripted briefing pair, shared-judgment trace and real pair audit",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      mutate: [specWrite, adrWrite],
    },
  },
  expect: {
    ...case01.expect,
    events: [{ kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "delegate", executionMode: "same-context", modeReason: "shared-judgment", count: 1 }],
    finalFiles: {
      [spec]: { frontmatter: { status: "proposed", relations: { "derives-from": ["DISC-0001"] } } },
      [adr]: { frontmatter: { status: "accepted", relations: { "derives-from": ["DISC-0001"] } } },
    },
    briefingAudit: { spec, adr, consistent: true },
  },
};

// The first completed delegate writes only the spec; the briefing gate routes
// back, and the second delegate yields input-required after both audits. Resume
// reuses those receipts before the delegate repairs spec+ADR. This is an
// EffectOutcome yield, NOT a retry outcome or an actual skill execution.
export const case14c: E2ECase = {
  ...case14a,
  id: "e2e-14c",
  description: "partial pair → input-required yield → pending resume repairs pair",
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" }, delegate: "completed",
      mutate: [specWrite],
    },
    "briefing-retry": {
      audits: { spec: "completed", adr: "completed" }, delegate: [{ yield: "input-required" }, "completed"],
      mutate: [adrWrite, { append: { path: spec, body: "\nLate information incorporated.\n" } }],
    },
  },
  steps: [
    {
      expect: {
        yield: "input-required",
        edgeSequence: ["probe-to-briefing", "briefing-retry"],
        completedEdges: ["probe-to-briefing"],
        briefingAudit: { spec, adr, consistent: false },
        checkpointReceipts: [{ edgeId: "probe-to-briefing", count: 1 }, { edgeId: "briefing-retry", count: 0 }],
        events: [
          { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "audit", count: 2 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "audit", effectId: "spec", outcome: "completed", count: 1 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "audit", effectId: "adr", outcome: "completed", count: 1 },
          { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "delegate", effectId: "briefing-flow", count: 1 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "delegate", effectId: "briefing-flow", outcome: "yield", reason: "input-required", count: 1 },
          { kind: "effect-outcome", edgeId: "briefing-retry", outcome: "retry", count: 0 },
        ],
      },
    },
    {
      expect: {
        yield: "terminal",
        edgeSequence: [
          "briefing-retry", "briefing-to-design", "design-to-planning", "planning-to-task-graph",
          "task-graph-to-implementation", "implementation-to-followup-triage",
          "followup-triage-terminal", "exit-audit-to-complete", null,
        ],
        briefingAudit: { spec, adr, consistent: true },
        checkpointReceipts: [{ edgeId: "probe-to-briefing", count: 1 }, { edgeId: "briefing-retry", count: 1 }],
        events: [
          { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "audit", count: 0 },
          { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "delegate", effectId: "briefing-flow", executionMode: "same-context", modeReason: "shared-judgment", count: 1 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "delegate", effectId: "briefing-flow", outcome: "completed", count: 1 },
        ],
      },
    },
  ],
  expect: {
    ...case14a.expect,
    edgeSequence: [
      "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "probe-to-briefing", "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete",
    ],
    events: [
      { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "delegate", executionMode: "same-context", modeReason: "shared-judgment", count: 2 },
      { kind: "run-yield", reason: "input-required", count: 1 },
      { kind: "run-yield", reason: "terminal", count: 1 },
    ],
    finalFiles: {
      ...case14a.expect.finalFiles,
      [spec]: { frontmatter: { status: "proposed" }, bodyIncludes: ["Late information incorporated."] },
    },
  },
};
