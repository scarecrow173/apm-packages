import type { E2ECase } from "../harness/case_types";

/**
 * e2e-18 — journaled migration interruption + resume, then the migrated
 * legacy Plan/Tasks drive a REAL graph leg (mandatory scenario 15).
 *
 * The fixture is the v2 corpus (plan + two task docs, one done / one todo
 * with a depends-on edge, plus the impl record destined for knowledge
 * consolidation) and NO Execution Store run — the run the migration
 * imports is the only run in the repository, so `$run:only` names it
 * deterministically. The impl record is named `0001-graph.md` so its
 * migrated knowledge record lands at `docs/knowledge/0001-graph.md` —
 * the durable path the `knowledge`/`all` audits bind.
 *
 * Ops drive the real CLIs end to end:
 *   1. `migrate plan` → classification "migration", a deterministic
 *      planHash the apply pins against;
 *   2. `writeResolutions` → the required semantic decisions, auto-resolved
 *      from the live plan (root-level file, outside the scanned roots —
 *      the planHash stays stable);
 *   3. commit — apply refuses a dirty worktree, so the resolutions file
 *      lands first and the crash below is the injected publish failure,
 *      not a worktree-cleanliness refusal;
 *   4. `migrate apply --expect <hash>` under DOC_MAINTENANCE_MIGRATE_FAIL_AT
 *      =publish → the journal survives mid-flight, `ok:false`;
 *   5. `migrate recovery --json` → inspect reports migration-incomplete;
 *   6. `migrate recovery --resume` → publish+finalize completes, the
 *      schema manifest stamps LAST → `recovered-resume`, preflight current;
 *   7. commit — the landed migration is committed so the Evidence Record
 *      below binds a stable `commit:HEAD` subject (the tree never changes
 *      during the leg — the only writes are gitignored store records);
 *   8. `evidence` — a passed, digest-verified, HEAD-bound record for the
 *      migrated VD-0001::CHK-01 → SPEC-0001::R-01 link, so the
 *      verification gate's auto-computed summary reads `verified`.
 *
 * Portability proof: the imported run's plan is never auto-approved
 * (`plan-not-approved` would fail the task graph closed), so the leg's
 * `mutateBefore` performs the two explicit normal-boundary bindings —
 * digest-bound re-approval plus a manifest focus inside the focused chain
 * (a null-focus run is never an implicit-selection candidate). The leg
 * then routes the migrated task graph for real: TASK-0002 is runnable
 * (TASK-0001 migrated as done), the delegate completes it — its declared
 * output is the run's task-record transition (Registry 3's honest
 * produced state; a durable impl doc would re-flag preflight) — and the
 * run reaches `terminal` through the full remaining pipeline.
 */
export const case18: E2ECase = {
  id: "e2e-18",
  description: "migrate apply crashes at publish → recovery resumes → migrated run routes task-graph → terminal",
  fixture: {
    run: false,
    // A pure pre-v3 corpus: the harness's default Registry-3 verification/
    // knowledge docs would occupy the ids the migration allocates
    // (KNOW-0001 for the impl record) and short-circuit the whole scenario.
    verificationDoc: false,
    knowledgeDoc: false,
    taskStatuses: ["done", "todo"],
    dependsOn: [[], ["TASK-0001"]],
    files: {
      // The migrated check's target must be a real declared claim — the
      // default spec carries no claim marker.
      "docs/specs/0001-graph.md": {
        frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Graph" },
        body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n\n<!-- claim:R-01 --> deterministic routing\n",
      },
      // Basename `0001-graph.md` → the knowledge conversion lands at
      // docs/knowledge/0001-graph.md, the path the audits bind.
      "docs/impl/ir/0001-task.md": null,
      "docs/impl/ir/0001-graph.md": {
        frontmatter: {
          id: "IMPL-0001", type: "implementation-record", status: "complete", title: "Graph implementation",
        },
        body: "# Implementation Record\n",
      },
    },
  },
  ops: [
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "plan"], saveAs: "plan" },
    { kind: "writeResolutions", path: "migration-resolutions.json" },
    { kind: "mutate", mutator: { commit: true } },
    {
      kind: "cli",
      cli: "doc_maintenance",
      argv: ["migrate", "apply", "--expect", "$plan.plan.planHash", "--resolutions", "migration-resolutions.json"],
      env: { DOC_MAINTENANCE_MIGRATE_FAIL_AT: "publish" },
      saveAs: "crashed",
    },
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "recovery", "--json"], saveAs: "inspect" },
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "recovery", "--resume"], saveAs: "resume" },
    // The landed migration is committed before the leg — evidence binds
    // the stable HEAD and the commit gate sees a clean baseline.
    { kind: "mutate", mutator: { commit: true } },
    {
      kind: "evidence",
      input: {
        evidenceId: "EVID-E2E18-1",
        claim: { ref: "SPEC-0001::R-01" },
        check: { ref: "VD-0001::CHK-01" },
        subject: { kind: "commit", commit: "HEAD" },
        method: "unit",
        provider: { kind: "repository", name: "e2e" },
        outcome: "passed",
        retention: "release",
        artifacts: [{
          uri: "evidence/chk-01.txt",
          sha256: `sha256:${"a".repeat(64)}`,
          availability: "available",
          retention: "release",
          expiresAt: null,
        }],
      },
      resolve: true,
    },
  ],
  steps: [
    {
      // Focus names the design chain — the run's manifest focus (set by
      // mutateBefore) sits inside it, so selection binds the imported run.
      options: { runId: "$run:only", focus: ["DESIGN-0001"] },
      mutateBefore: [
        { approve: { runId: "$run:only" } },
        { runFocus: { runId: "$run:only", focus: ["docs/designs/0001-graph.md"] } },
      ],
      expect: {
        yield: "terminal",
        edgeSequence: [
          "task-graph-to-implementation", "implementation-to-verification",
          "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
          "exit-audit-to-complete", null,
        ],
        tasksContain: [
          { edgeId: "task-graph-to-implementation", id: "TASK-0002", status: "todo" },
        ],
      },
    },
  ],
  current: "task-graph",
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    // The migrated corpus carries no durable task doc, so the checkpoint
    // binds the run's task record — the delegate's honest produced state
    // under Registry 3 (its `execution-task` output is that transition).
    "task-graph-to-implementation": {
      delegate: "completed",
      output: { kind: "execution-task", taskId: "TASK-0002" },
      checkpointEvidence: [{ kind: "execution-task", taskId: "TASK-0002" }],
      mutate: [{ task: { taskId: "TASK-0002", status: "done", runId: "$run:only" } }],
    },
    "implementation-to-verification": {
      audits: { verification: "completed" },
      checkpointEvidence: [{ kind: "execution-task", taskId: "TASK-0002" }],
    },
    "verification-to-knowledge-consolidation": {
      audits: { knowledge: "completed" },
      delegate: "completed",
      checkpointEvidence: [{ kind: "execution-task", taskId: "TASK-0002" }],
    },
    "knowledge-consolidation-to-exit-audit": {
      audits: { all: "completed" },
      delegate: "completed",
      checkpointEvidence: [{ kind: "execution-task", taskId: "TASK-0002" }],
    },
    "exit-audit-to-complete": {
      checkpointEvidence: [{ kind: "execution-task", taskId: "TASK-0002" }],
    },
  },
  expect: {
    // The migrated corpus carries zero legacy markers — routing ran under
    // the stamped manifest, and nothing the leg produced re-flagged it.
    preflight: "current",
    verification: { verdict: "verified" },
    evidence: { count: 1 },
    cli: [
      {
        saveAs: "plan",
        exit: 0,
        jsonMatch: { command: "migrate plan", readOnly: true, plan: { classification: "migration" } },
      },
      { saveAs: "crashed", exit: 1, jsonMatch: { ok: false, applied: false } },
      { saveAs: "inspect", exit: 1, jsonMatch: { ok: false, status: "migration-incomplete" } },
      {
        saveAs: "resume",
        exit: 0,
        jsonMatch: { ok: true, status: "recovered-resume", recovered: true },
      },
    ],
    completedEdges: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete",
    ],
    run: {
      runId: "$run:only",
      tasks: { "TASK-0002": { status: "done" } },
      planApproved: true,
    },
  },
};
