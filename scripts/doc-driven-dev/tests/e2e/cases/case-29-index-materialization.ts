import type { E2ECase } from "../harness/case_types";

/**
 * e2e-29 — a worktree without materialized indexes does not stall the
 * graph; only explicit `index apply` reflects index changes (mandatory
 * scenario 16).
 *
 * The `omitIndexes` fixture scaffolds every managed dir but writes NO
 * README index files — the state a fresh worktree is in before
 * materialization. The graph leg routes from `task-graph` to `terminal`
 * regardless: durable Graph State reads front-matter documents and store
 * records, never index files. Only the explicit post-leg
 * `doc_maintenance index plan|apply` materializes the managed indexes —
 * planHash-pinned through the same `--expect` drift guard the CLI
 * enforces, with the plan hash resolved from the recorded plan output
 * (`$idxplan.planHash`), and the apply report's written list + the
 * generated README files asserted independently.
 */
export const case29: E2ECase = {
  id: "e2e-29",
  description: "graph routes without indexes; explicit index apply materializes managed READMEs",
  current: "task-graph",
  fixture: { taskStatuses: ["todo"], omitIndexes: true },
  focus: ["DESIGN-0001"],
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
  postOps: [
    { kind: "cli", cli: "doc_maintenance", argv: ["index", "plan", "--json"], saveAs: "idxplan" },
    { kind: "cli", cli: "doc_maintenance", argv: ["index", "apply", "--expect", "$idxplan.planHash", "--json"], saveAs: "idxapply" },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete", null,
    ],
    cli: [
      {
        saveAs: "idxplan",
        exit: 0,
        jsonMatch: { command: "index plan" },
        // Every managed durable dir reports a `create` verdict — no index
        // existed before materialization.
        stdoutMatch: /"verdict": "create"/,
      },
      {
        saveAs: "idxapply",
        // Repo-wide enumeration only reaches the seven durable dirs — every
        // verdict is `create`, so nothing lands in `blocked` and the apply
        // exits cleanly. The execution-bound/legacy dirs are not docTypes
        // at all: materialization never even enumerates them.
        exit: 0,
        jsonMatch: {
          command: "index apply",
          blocked: [],
          written: [
            "docs/adr/README.md",
            "docs/designs/README.md",
            "docs/discovery/README.md",
            "docs/ideas/README.md",
            "docs/knowledge/README.md",
            "docs/specs/README.md",
            "docs/verification/README.md",
          ],
        },
      },
    ],
    finalFiles: {
      // Only the explicit apply produced index content — a generated
      // managed index that lists the resident spec document.
      "docs/specs/README.md": { bodyIncludes: ["<!-- doc-suite:generated-index -->", "0001-graph.md"] },
    },
    gitDirty: true, // materialized indexes are uncommitted writes
  },
};
