---
name: task-doc
description: Task record contract for Execution Store runs — use when decomposing an approved run plan into executable slices, defining task dependencies and done criteria, or migrating a pre-v3 docs/tasks corpus. Tasks are (runId, taskId) records, not durable Markdown files.
license: MIT
---

# Task Documentation Skill

Use this skill to track implementation slices that are small enough to execute
and review. Tasks should link back to the plan, spec, or ADR they implement and
should state concrete completion criteria.

## Document Registry v3 status

`task` is **execution-bound** (`persistence: ephemeral`) under Document
Registry 3: task state lives in the Execution Store, not in a durable Git
document, and `docs/tasks` / `docs/work-items` are *former* directories that
accept no durable writes. No `new_task.js` creator ships (Issue #249 removed
it) — the only `task` interpreter left is the registry, whose type name still
refuses on the shared query surface with:

`Document type "task" is execution-bound (persistence: ephemeral): it has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store`

The preconditions, relations, and done-criteria contract below remain the
task-model contract for Execution Store records and for migrating a pre-v3
`docs/tasks` corpus (`migrate_docs` / `migrate_ids` in doc-maintenance). They
no longer describe a file this skill mints.

## Preconditions

<HARD-GATE>
To create a task record in a run, one of the following must be satisfied:

1. **Normal path**: The run's `plan.md` carries a digest-bound approval —
   the Task Graph's `plan-not-approved` gate fails closed otherwise.
   Do not derive tasks from an unapproved plan.
   If the plan is not yet approved, complete its review and `approve-plan`
   first.
2. **Emergency fix path**: When no plan exists, ALL of the following must hold:
   - State the reason for urgency in the task record body (one line).
   - Reference an `approved` spec-doc or `accepted` adr-doc in the record's
     `checks` or the run plan — the durable artifact is the upstream anchor.
   - If no spec/ADR exists either, create one first (brief content is acceptable).
3. **Post-implementation follow-up path**: When the task comes from the
    lifecycle Phase 4 Exit Gate, ALL of the following must hold:
   - The follow-up has a recorded classification.
   - `bug-fix` and `doc-only` tasks reference the current approved run plan,
     the verified task record, or the affected upstream document.
   - `decision-required` and `new-feature` items are not implementation tasks
     until their upstream spec, ADR, design, or plan route is completed.
   - Dependencies are explicit through the record's `dependsOn` — sibling
     task ids inside the same run only.

If none of these paths is satisfied, do not create the task.
</HARD-GATE>

Task identity is `(runId, taskId)`: a record exists only inside its run,
`dependsOn` names sibling records in the same run, and `blocks` is the
derived reverse projection — never an independent field.

## Workflow

1. Confirm that the normal path, emergency fix path, or
   post-implementation follow-up path preconditions above are met before
   creating the task.
2. Create a task record for one coherent implementation slice.

   Under Document Registry 3 no `new_task.js` creator ships (see *Document
   Registry v3 status* above) — `task` is execution-bound, so the
   record is created in the Execution Store, not as a `docs/tasks` file.
   `references/task-conventions.md` defines the record contract and
   `assets/templates/task.md` remains the reference body structure.

3. Use meaningful dependencies.
   A task record's `dependsOn` lists the sibling task ids in the same run
   that must reach `done` first — each entry creates a
   `dependency -> this task` edge in the Task DAG, and `blocks` is derived
   as the reverse projection rather than declared separately. `dependsOn`
   never names durable artifacts or tasks in another run: upstream anchors
   (spec, ADR, design, the run's plan) live in `checks` text or the plan
   body, not in the dependency field. Task creation records dependencies
   but does not validate the whole DAG; use `build_task_graph.js --run`
   for resolution and validation.
4. Keep status current.
   Use `todo`, `in-progress`, `blocked`, `done`, or `wont-do`.
5. Prefer short tasks.
   Split work when one task mixes unrelated files, behaviors, or verification
   paths. Keep a floor too: a task file should be a delegable work item —
   fold items smaller than one coherent action into the plan's own task list
   instead of creating micro-task files.

## Done Criteria Requirements

Every task record must declare at least one machine-checkable entry in
`checks` — the field that carries the pre-v3 `## Verification` contract.
Human-only criteria are acceptable as supplements but must not be the sole
verification.

**Required record shape:**

```json
{
  "taskId": "TASK-0001",
  "title": "…",
  "status": "todo",
  "dependsOn": [],
  "checks": [
    "`npm test -- --filter=checkout-button` exits 0",
    "`grep -r 'CheckoutButton' src/components/` returns matches",
    "Manual: button renders in Storybook (supplement only)"
  ],
  "scope": ["src/components/checkout/"]
}
```

**Rules:**

1. At least one `checks` entry must be a runnable command with an expected
   exit code or output pattern.
2. Commands must be copy-pasteable without modification (no placeholders).
3. If no automated check is possible, document why and add a follow-up task
   to create one.
4. `scope` declares the task's write boundary — the parallel-safety judgment
   compares against it, so keep entries verifiable repo-relative paths.

A task cannot move to `done` until all verification commands pass. Task
status transitions are Execution Store state changes — `docs/tasks` has no
Registry 3 index to regenerate.

## Resources

- `new_task.js`: *removed* under Registry 3 — `task` is
  execution-bound and has no durable creation path; run tasks are minted
  only as Execution Store records by `planning-flow`.
- `references/task-conventions.md`: status values, relations, required
  content, and conventions for task records.
- `assets/templates/task.md`: task body template — the reference structure
  for the Execution Store record, not a file template a script fills.
