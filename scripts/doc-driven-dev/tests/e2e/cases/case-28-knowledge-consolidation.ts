import type { E2ECase } from "../harness/case_types";
import { KNOWLEDGE_DOC } from "../harness/scripted_dispatcher";

/**
 * e2e-28 — key knowledge consolidates INTO an existing Knowledge record;
 * no new Markdown file appears and no implementation chronology is
 * persisted (mandatory scenario 13).
 *
 * The scripted `knowledge-doc` delegate appends the consolidated finding
 * to the pre-existing KNOW-0001 record (its declared durable output) —
 * the mutator runs through the real `applyMutator` boundary and the
 * delegate's output proof binds the post-mutation revision. Validation
 * re-reads the filesystem: `docs/knowledge` still holds exactly two
 * files (no `0002-*.md` was spawned), the record itself carries the
 * consolidated text, and `docs/impl` keeps only its fixture files —
 * the old implementation chronology is corpus history the run never
 * rewrote.
 */
export const case28: E2ECase = {
  id: "e2e-28",
  description: "knowledge-doc consolidates into the existing record → no new file, no impl chronology → terminal",
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
    "verification-to-knowledge-consolidation": {
      audits: { knowledge: "completed" },
      delegate: "completed",
      mutate: [
        {
          append: {
            path: KNOWLEDGE_DOC,
            body: "\n## Consolidated Findings\n\n- The graph routes deterministically from projected state.\n",
          },
        },
      ],
    },
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
    finalFiles: {
      [KNOWLEDGE_DOC]: { bodyIncludes: ["Consolidated Findings", "deterministically"] },
    },
    fileCount: {
      // Still index + one record — consolidation updated, never spawned.
      "docs/knowledge": 2,
      // impl/ir README + 0001-task.md + impl/exp README — chronology untouched.
      "docs/impl": 3,
    },
    run: { tasks: { "TASK-0001": { status: "done" } } },
  },
};
