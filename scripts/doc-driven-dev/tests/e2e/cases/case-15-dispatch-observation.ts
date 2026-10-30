import type { CallerEffect } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import {
  buildDelegateHandoff,
  toExecutionMode,
  type DelegateMode,
  type PolicyFacts,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { E2ECase } from "../harness/case_types";
import type { SubDispatchSpec } from "../harness/scripted_dispatcher";
import { case01 } from "./case-01-happy-path";

/**
 * e2e-15 — observable execution-mode boundary for briefing paths (#135).
 *
 * The graph dispatches `briefing-flow` as ONE delegate; its inner spec-doc,
 * adr-doc, and research execution are adapter-internal. The scripted adapter
 * plays the host: `EdgeScript.subDispatches` is its internal dispatch plan
 * and every entry produces a `dispatch-observed` event recording what the
 * adapter ACTUALLY did (target, requested, actual, method) — the same
 * contract a real host adapter implements by literally spawning a subagent.
 *
 * The same-context path (15a) runs spec-doc/adr-doc inline; the
 * condition-met path (15b) additionally dispatches `research` as an
 * isolated subagent. Graph-level `effect-dispatched` counts are identical —
 * the paths differ only in the observed dispatch records, which is exactly
 * the boundary this issue makes visible. All other edges reuse e2e-01's
 * script so the run reaches terminal and checkpoint/audit evidence can be
 * compared end to end.
 */

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
const researchFindings = { append: { path: discovery, body: "\n## Research Findings\n\n- independent evidence gathered\n" } };

const ALL_MODES = new Set<DelegateMode>(["same-context", "subagent-as-tool", "isolated-subagent"]);

/** briefing-flow stays same-context (shared judgment); every other effect gets the inert row. */
const policy = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => ({
  effectId: effect.id,
  stage: effect.kind,
  independentScope: false,
  sharedJudgment: effect.kind === "delegate" && effect.id === "briefing-flow",
  contextCost: "low",
  parallelCandidate: false,
  hostCapabilities: ALL_MODES,
});

/** The two same-context inner dispatches of a completed briefing delegate. */
const sameContextPair: SubDispatchSpec[] = [
  { target: "spec-doc", requested: "same-context", mutate: [specWrite] },
  { target: "adr-doc", requested: "same-context", mutate: [adrWrite] },
];

/** Research first (independent, bounded to the discovery scope), then the pair inline. */
const researchThenPair: SubDispatchSpec[] = [
  { target: "research", requested: "subagent", writeScope: ["docs/discovery/"], mutate: [researchFindings] },
  ...sameContextPair,
];

const HAPPY_EDGES = [
  "probe-to-briefing", "briefing-to-design", "design-to-planning",
  "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
  "followup-triage-terminal", "exit-audit-to-complete",
];

/**
 * e2e-15a `same-context-dispatch-path`: the completed briefing delegate
 * fans out into two same-context internal dispatches. Every
 * `dispatch-observed` echoes its request: the self-report is the scripted
 * adapter honoring same-context, and spec-doc/adr-doc record
 * `inline-skill` — no bounded spawn anywhere in the run.
 */
export const case15a: E2ECase = {
  id: "e2e-15a",
  description: "same-context path: spec-doc/adr-doc observed as inline-skill, zero spawns",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: sameContextPair,
    },
  },
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_EDGES, null],
    completedEdges: HAPPY_EDGES,
    events: [
      // 16 graph-level dispatches (2 audits + 1 delegate on this edge).
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", count: 3 },
      // …but 5 dispatch-observed records on it: 2 audit selfs + delegate
      // self + spec-doc + adr-doc internals.
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", count: 5 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "briefing-flow", requested: "same-context", actual: "same-context", method: "scripted", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "spec-doc", requested: "same-context", actual: "same-context", method: "inline-skill", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "adr-doc", requested: "same-context", actual: "same-context", method: "inline-skill", count: 1 },
      { kind: "dispatch-observed", target: "research", count: 0 },
      { kind: "dispatch-observed", method: "subagent-spawn", count: 0 },
      { kind: "dispatch-observed", method: "not-executed", count: 0 },
      // 16 self-observations + 2 internal = 18.
      { kind: "dispatch-observed", count: 18 },
      { kind: "dispatch-observed", actual: "same-context", count: 18 },
    ],
    checkpointReceipts: [{ edgeId: "probe-to-briefing", count: 1 }],
    briefingAudit: { spec, adr, consistent: true },
    finalFiles: {
      [spec]: { frontmatter: { status: "proposed" } },
      [adr]: { frontmatter: { status: "accepted" } },
    },
  },
};

/**
 * e2e-15b `delegated-research-path`: identical graph dispatches, different
 * observed path — the research condition is met, so the adapter spawns an
 * independent bounded research dispatch (`actual: "subagent"`,
 * `method: "subagent-spawn"`) confined to `docs/discovery/` before writing
 * the pair inline. The spec/adr sub-dispatches stay same-context exactly as
 * briefing-flow's dispatch table prescribes.
 */
export const case15b: E2ECase = {
  id: "e2e-15b",
  description: "independent research path: research observed as subagent-spawn, pair stays inline",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: researchThenPair,
    },
  },
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_EDGES, null],
    completedEdges: HAPPY_EDGES,
    events: [
      // Same graph-level dispatch counts as 15a…
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", count: 3 },
      // …one more observed dispatch: the independent research spawn.
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", count: 6 },
      { kind: "dispatch-observed", target: "research", requested: "subagent", actual: "subagent", method: "subagent-spawn", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "spec-doc", method: "inline-skill", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "adr-doc", method: "inline-skill", count: 1 },
      { kind: "dispatch-observed", method: "subagent-spawn", count: 1 },
      { kind: "dispatch-observed", method: "not-executed", count: 0 },
      // 16 self + research + spec-doc + adr-doc = 19.
      { kind: "dispatch-observed", count: 19 },
      { kind: "dispatch-observed", actual: "subagent", count: 1 },
    ],
    checkpointReceipts: [{ edgeId: "probe-to-briefing", count: 1 }],
    briefingAudit: { spec, adr, consistent: true },
    finalFiles: {
      [spec]: { frontmatter: { status: "proposed" } },
      [adr]: { frontmatter: { status: "accepted" } },
      [discovery]: { bodyIncludes: ["Research Findings"] },
    },
  },
};

/**
 * e2e-15c `delegated-research-resume`: yield/resume on the delegated path
 * with late-arriving information. Leg 1 completes probe-to-briefing after
 * research + spec-doc (adr still draft → briefing gate fails), then the
 * briefing-retry delegate yields `input-required`. Leg 2 resumes: the
 * delegate is re-dispatched, adr-doc completes the pair and spec-doc
 * incorporates the late insight appended to discovery between legs.
 */
export const case15c: E2ECase = {
  id: "e2e-15c",
  description: "delegated path yield/resume: research spawn, input-required, resume writes pair + late info",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: [
        { target: "research", requested: "subagent", writeScope: ["docs/discovery/"], mutate: [researchFindings] },
        { target: "spec-doc", requested: "same-context", mutate: [specWrite] },
      ],
    },
    "briefing-retry": {
      audits: { spec: "completed", adr: "completed" },
      delegate: [{ yield: "input-required" }, "completed"],
      subDispatches: [[
        { target: "adr-doc", requested: "same-context", mutate: [adrWrite] },
        { target: "spec-doc", requested: "same-context", mutate: [{ append: { path: spec, body: "\nLate insight incorporated.\n" } }] },
      ]],
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
          // probe-to-briefing: self + audits selfs + research + spec-doc.
          { kind: "dispatch-observed", edgeId: "probe-to-briefing", count: 5 },
          { kind: "dispatch-observed", target: "research", actual: "subagent", method: "subagent-spawn", count: 1 },
          // briefing-retry leg 1: audits + delegate yield — internals never fire on a yield.
          { kind: "dispatch-observed", edgeId: "briefing-retry", count: 3 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "delegate", outcome: "yield", reason: "input-required", count: 1 },
        ],
      },
    },
    {
      mutateBefore: [{ append: { path: discovery, body: "\nLate insight.\n" } }],
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
          // Audits were reused; the completing delegate records self + adr-doc + spec-doc.
          { kind: "effect-dispatched", edgeId: "briefing-retry", stage: "audit", count: 0 },
          { kind: "dispatch-observed", edgeId: "briefing-retry", count: 3 },
          { kind: "dispatch-observed", edgeId: "briefing-retry", target: "adr-doc", method: "inline-skill", count: 1 },
          { kind: "effect-outcome", edgeId: "briefing-retry", stage: "delegate", outcome: "completed", count: 1 },
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
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
      { kind: "dispatch-observed", target: "research", method: "subagent-spawn", count: 1 },
      { kind: "run-yield", reason: "input-required", count: 1 },
      { kind: "run-yield", reason: "terminal", count: 1 },
    ],
    finalFiles: {
      [spec]: { frontmatter: { status: "proposed" }, bodyIncludes: ["Late insight incorporated."] },
      [adr]: { frontmatter: { status: "accepted" } },
      [discovery]: { bodyIncludes: ["Research Findings", "Late insight."] },
    },
  },
};

/**
 * e2e-15d `delegated-mode-unavailable`: research is requested as a
 * subagent, but the simulated host cannot execute subagents — the internal
 * dispatch declines (not-executed) and the delegate yields
 * `authority-required` instead of silently falling back to same-context.
 */
export const case15d: E2ECase = {
  id: "e2e-15d",
  description: "unavailable mode: research subagent declined, yield — never a silent same-context switch",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  unsupportedModes: ["subagent"],
  script: {
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: researchThenPair,
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      { kind: "dispatch-observed", target: "research", requested: "subagent", actual: "unknown", method: "not-executed", count: 1 },
      // spec-doc/adr-doc never fired — the pipeline stops at the refusal.
      { kind: "dispatch-observed", target: "spec-doc", count: 0 },
      { kind: "dispatch-observed", target: "adr-doc", count: 0 },
      // No silent switch: research never reports an executed same-context run.
      { kind: "dispatch-observed", target: "research", method: "inline-skill", count: 0 },
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "delegate", outcome: "yield", reason: "authority-required", count: 1 },
    ],
    finalFiles: {
      [spec]: { frontmatter: { status: "draft" } },
      [adr]: { frontmatter: { status: "draft" } },
    },
  },
};

/**
 * e2e-15e `self-observation-mismatch-rejected`: the policy delegates the
 * briefing-flow dispatch itself (override → isolated-subagent → requested
 * `subagent` + a real handoff), but the adapter reports it ran same-context.
 * The runner's attribution check rejects the dispatch — the mismatched
 * observation stays in the trace as the forensic record.
 */
export const case15e: E2ECase = {
  id: "e2e-15e",
  description: "adapter reports same-context while subagent was requested → dispatch rejected",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy: (_route, effect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: false,
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: false,
    hostCapabilities: ALL_MODES,
    ...(effect.kind === "delegate" && effect.id === "briefing-flow"
      ? { override: { mode: "isolated-subagent" as const, reason: "eval-fixture" } }
      : {}),
  }),
  script: {
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      reportActual: "same-context",
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "delegate", executionMode: "subagent", modeReason: "override:eval-fixture", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "briefing-flow", requested: "subagent", actual: "same-context", method: "scripted", count: 1 },
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "audit", count: 2 },
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "delegate", count: 0 },
    ],
  },
};

/**
 * e2e-15f `unauthorized-subdispatch-refused`: the research sub-dispatch's
 * write scope is `docs/discovery/` but its script tries to append to the
 * spec — an unauthorized change, refused before any write and reported
 * `not-executed`; the delegate yields `authority-required`.
 */
export const case15f: E2ECase = {
  id: "e2e-15f",
  description: "research write outside declared scope → refused, delegate yields authority-required",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: [
        { target: "research", requested: "subagent", writeScope: ["docs/discovery/"], mutate: [{ append: { path: spec, body: "\nout of scope\n" } }] },
      ],
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      { kind: "dispatch-observed", target: "research", requested: "subagent", actual: "unknown", method: "not-executed", count: 1 },
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "delegate", outcome: "yield", reason: "authority-required", count: 1 },
    ],
    finalFiles: {
      [spec]: { frontmatter: { status: "draft" } },
      [discovery]: { frontmatter: { status: "accepted" } },
    },
  },
};

/**
 * e2e-15g `stale-top-level-rejected-same-context`: on the same-context
 * path the delegate's own outcome carries stale evidence (fingerprint no
 * longer resolves) — `assertEffectOutcome` rejects it after the
 * self-observation was recorded; the forensic dispatch-observed remains.
 */
export const case15g: E2ECase = {
  id: "e2e-15g",
  description: "same-context path: stale outcome evidence rejected, observation recorded first",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: { malformed: "stale-fingerprint" },
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "briefing-flow", actual: "same-context", method: "scripted", count: 1 },
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "delegate", count: 0 },
    ],
  },
};

/**
 * e2e-15h `stale-subdispatch-rejected-research`: on the delegated path the
 * research spawn completes but returns evidence that no longer resolves —
 * the simulated host rejects the return, so its observation shows the
 * executed spawn while the delegate yields `authority-required`.
 */
export const case15h: E2ECase = {
  id: "e2e-15h",
  description: "delegated path: executed research spawn with stale return → delegate yield",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy,
  script: {
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      subDispatches: [
        { target: "research", requested: "subagent", writeScope: ["docs/discovery/"], mutate: [researchFindings], staleReturn: true },
      ],
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      // The spawn executed (its observation is the executed mechanism)…
      { kind: "dispatch-observed", target: "research", requested: "subagent", actual: "subagent", method: "subagent-spawn", count: 1 },
      // …but the delegate could not complete over a stale return.
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "delegate", outcome: "yield", reason: "authority-required", count: 1 },
    ],
    finalFiles: {
      [spec]: { frontmatter: { status: "draft" } },
      [discovery]: { bodyIncludes: ["Research Findings"] },
    },
  },
};

/**
 * e2e-15i `delegated-top-level-handoff`: the policy delegates briefing-flow
 * itself (isolated-subagent); the runner attaches the caller-built handoff
 * granting write scope over spec/adr, and the adapter's mutations stay
 * inside it — the observed actual mode is `subagent`, proving the dispatch
 * honored the delegated contract end to end.
 */
export const case15i: E2ECase = {
  id: "e2e-15i",
  description: "delegated top-level dispatch: handoff-scoped writes honored, actual=subagent observed",
  fixture,
  focus: ["PLAN-0001"],
  signals: case01.signals,
  policy: (_route, effect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: false,
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: false,
    hostCapabilities: ALL_MODES,
    ...(effect.kind === "delegate" && effect.id === "briefing-flow"
      ? { override: { mode: "isolated-subagent" as const, reason: "eval-fixture" } }
      : {}),
  }),
  buildHandoff: ({ decision, inputs }) => buildDelegateHandoff({
    mode: toExecutionMode(decision.mode),
    focus: inputs.map((input) => input.path),
    inputs,
    permissions: { read: ["docs/"], write: ["docs/specs/", "docs/adr/"] },
  }),
  script: {
    ...case01.script,
    "probe-to-briefing": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      mutate: [specWrite, adrWrite],
    },
  },
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_EDGES, null],
    completedEdges: HAPPY_EDGES,
    events: [
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "delegate", executionMode: "subagent", modeReason: "override:eval-fixture", count: 1 },
      { kind: "dispatch-observed", edgeId: "probe-to-briefing", target: "briefing-flow", requested: "subagent", actual: "subagent", method: "scripted", count: 1 },
      { kind: "dispatch-observed", target: "briefing-flow", actual: "subagent", count: 1 },
    ],
    briefingAudit: { spec, adr, consistent: true },
    finalFiles: {
      [spec]: { frontmatter: { status: "proposed" } },
      [adr]: { frontmatter: { status: "accepted" } },
    },
  },
};
