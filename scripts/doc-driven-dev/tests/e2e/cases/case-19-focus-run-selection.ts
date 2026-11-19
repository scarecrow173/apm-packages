import type { E2ECase } from "../harness/case_types";

/**
 * e2e-19 — `focus-required` is emitted; correct Claim/Run focus resumes, and
 * a foreign run's plan/tasks never leak into the selected projection
 * (mandatory scenario 3).
 *
 * 19a — Run-ID focus token. Leg 1 runs unfocused against a repo carrying
 * active-status docs: `resolveFocus` emits the verbatim `focus-required`
 * blocker, the router returns a same-node blocked route at probe, and the
 * runner yields `input-required` — zero dispatches. Leg 2 is a FRESH leg
 * (`resume: false` — a blocked run saves no pending edge) that names the
 * run by a focus token: `e2e-run` resolves through `runTokens`, contributes
 * the run's declared manifest focus, and binds the Dynamic Task Graph to
 * exactly that run's records. The fixture carries a SECOND active run
 * (`foreign-run`) bound to a disjoint design chain with its own task
 * records — `tasksAbsent` proves TASK-FOREIGN never enters the projected
 * route, and the end-of-run store read proves foreign-run's records were
 * never touched (status todo, CAS version 1).
 *
 * 19b — Claim focus token. Same two-leg shape, but leg 2 focuses
 * `SPEC-0001::R-01`: the claim reference resolves its owning document
 * through the Knowledge Graph's claim index, the spec's chain selects
 * `e2e-run` implicitly (the only active run whose declared focus sits
 * inside that chain), and the resumed execution reaches terminal.
 */
export const case19a: E2ECase = {
  id: "e2e-19a",
  description: "focus-required → run-token focus selects e2e-run; foreign run's tasks never leak into the projection",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      // A second design doc forming a disjoint chain — foreign-run binds it.
      "docs/designs/0002-other.md": {
        frontmatter: { id: "DESIGN-0002", type: "design", status: "approved", title: "Other" },
        body: "# Other\n",
      },
    },
    extraRuns: [
      {
        runId: "foreign-run",
        focus: ["docs/designs/0002-other.md"],
        tasks: [{ taskId: "TASK-FOREIGN", status: "todo" }],
      },
    ],
  },
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [{ task: { taskId: "TASK-0001", status: "done" } }],
      commitEvidence: true,
    },
    "implementation-to-verification": { audits: { verification: "completed" } },
    "verification-to-knowledge-consolidation": { audits: { knowledge: "completed" }, delegate: "completed" },
    "knowledge-consolidation-to-exit-audit": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  steps: [
    {
      // Unfocused: one blocked route (edgeId null), zero dispatches.
      options: { runId: "e2e-run" },
      expect: {
        yield: "input-required",
        edgeSequence: [null],
        completedEdges: [],
        blockersContain: ["focus-required"],
      },
    },
    {
      // Fresh leg: the run id IS a focus selector under v3 — it names the
      // run AND contributes its manifest focus paths.
      options: { resume: false, runId: "e2e-run", focus: ["e2e-run"], current: "task-graph" },
      expect: {
        yield: "terminal",
        edgeSequence: [
          "task-graph-to-implementation", "implementation-to-verification",
          "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
          "exit-audit-to-complete", null,
        ],
        tasksContain: [
          { edgeId: "task-graph-to-implementation", id: "TASK-0001", status: "todo" },
        ],
        tasksAbsent: [
          { edgeId: "task-graph-to-implementation", id: "TASK-FOREIGN" },
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 7 }, // 1 blocked (leg 1) + 5 edges + 1 terminal (leg 2)
      { kind: "run-yield", count: 2 },
    ],
    run: {
      // The foreign run's records were never touched by the selected
      // projection or the scripted delegate — CAS version is still 1.
      runId: "foreign-run",
      tasks: { "TASK-FOREIGN": { status: "todo", version: 1 } },
    },
  },
};

export const case19b: E2ECase = {
  id: "e2e-19b",
  description: "focus-required → claim reference focus resolves its chain and resumes to terminal",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      // The spec declares claim R-01 by body marker — the focus token
      // resolves through the claim index to this document's chain.
      "docs/specs/0001-graph.md": {
        frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Graph" },
        body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n\n<!-- claim:R-01 --> deterministic routing\n",
      },
    },
  },
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [{ task: { taskId: "TASK-0001", status: "done" } }],
      commitEvidence: true,
    },
    "implementation-to-verification": { audits: { verification: "completed" } },
    "verification-to-knowledge-consolidation": { audits: { knowledge: "completed" }, delegate: "completed" },
    "knowledge-consolidation-to-exit-audit": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  steps: [
    {
      expect: {
        yield: "input-required",
        edgeSequence: [null],
        completedEdges: [],
        blockersContain: ["focus-required"],
      },
    },
    {
      options: { resume: false, focus: ["SPEC-0001::R-01"], current: "task-graph" },
      expect: {
        yield: "terminal",
        edgeSequence: [
          "task-graph-to-implementation", "implementation-to-verification",
          "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
          "exit-audit-to-complete", null,
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    completedEdges: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete",
    ],
    run: { tasks: { "TASK-0001": { status: "done" } } },
  },
};
