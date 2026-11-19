import type { E2ECase } from "../harness/case_types";

/**
 * e2e-27 — an implementation that needs no added knowledge produces ZERO
 * new Markdown and exits (mandatory scenario 12).
 *
 * The run drives the full tail from `task-graph` to `terminal`. The
 * scripted `knowledge-doc` delegate completes WITHOUT any `docs/`
 * mutator — the honest shape of "nothing new was learned". The
 * assertions pin file COUNTS under `docs/` (recursive, re-read at
 * validation time), not the delegate's own report: `docs/knowledge`
 * keeps its two fixture files (index + the pre-existing record) and the
 * whole `docs/` tree stays at its fixture count — consolidation wrote
 * nothing because there was nothing to write.
 */
export const case27: E2ECase = {
  id: "e2e-27",
  description: "knowledge-doc completes with no new Markdown → file counts unchanged → terminal",
  current: "task-graph",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [{ task: { taskId: "TASK-0001", status: "done" } }],
      commitEvidence: true,
    },
    "implementation-to-verification": { audits: { verification: "completed" } },
    // No `mutate`: the completed delegate asserts no new durable content.
    "verification-to-knowledge-consolidation": { audits: { knowledge: "completed" }, delegate: "completed" },
    "knowledge-consolidation-to-exit-audit": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  expect: {
    yield: "terminal",
    edgeSequence: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete", null,
    ],
    fileCount: {
      // The knowledge record + its index — zero new Markdown.
      "docs/knowledge": 2,
      // The whole durable + corpus tree is exactly the fixture's 21 files.
      "docs": 21,
    },
    run: { tasks: { "TASK-0001": { status: "done" } } },
  },
};
