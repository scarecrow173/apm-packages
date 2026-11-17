---
name: task-doc
description: Use when tracking implementation slices as YAML front matter plus Markdown tasks linked to plans, specs, ADRs, or other tasks.
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
accept no durable writes. `new_task.js` refuses at the registry gate — before
the TASK-DOC-GATE checks, scope checks, or any write — with:

`Document type "task" is execution-bound (persistence: ephemeral): it has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store`

The preconditions, relations, and done-criteria contract below remain the
task-model contract for Execution Store records and for migrating a pre-v3
`docs/tasks` corpus (`migrate_docs` / `migrate_ids` in doc-maintenance). They
no longer describe a file this skill mints.

## Preconditions

<HARD-GATE>
To create a task, one of the following must be satisfied:

1. **Normal path**: The referenced plan has `status` of `approved` or above.
   Do not derive tasks from a `draft` plan.
   If the plan is not yet approved, complete its review and approval first.
2. **Emergency fix path**: When no plan exists, ALL of the following must hold:
   - State the reason for urgency in the task body (one line).
   - Reference an `approved` spec-doc or `accepted` adr-doc via
     `relations.implements` or `relations.derives-from`.
   - If no spec/ADR exists either, create one first (brief content is acceptable).
3. **Post-implementation follow-up path**: When the task comes from the
    lifecycle Phase 4 Exit Gate, ALL of the following must hold:
   - The follow-up has a recorded classification.
   - `bug-fix` and `doc-only` tasks reference the current approved plan, the
     verified task, or the affected upstream document.
   - `decision-required` and `new-feature` items are not implementation tasks
     until their upstream spec, ADR, design, or plan route is completed.
   - Dependencies are explicit through `relations.depends-on` and
     `relations.blocks`.

If none of these paths is satisfied, do not create the task.
</HARD-GATE>

When a plan is supplied through `--plan`, the creator must enforce
TASK-DOC-GATE-001: the referenced plan must exist and have status
`approved`, `in-progress`, or `completed`.

## Workflow

1. Confirm that the normal path, emergency fix path, or
   post-implementation follow-up path preconditions above are met before
   creating the task.
2. Create a task record for one coherent implementation slice.

   Under Document Registry 3 `new_task.js` refuses at the registry gate (see
   *Document Registry v3 status* above) — `task` is execution-bound, so the
   record is created in the Execution Store, not as a `docs/tasks` file.
   `references/task-conventions.md` defines the record contract and
   `assets/templates/task.md` remains the reference body structure.

3. Use meaningful relations.
   Generated tasks point to the plan with `relations.implements` and
   `relations.depends-on`. `--depends-on` and `--blocks` may be repeated; values are recorded in input
   order with duplicates removed. In the Task DAG, a `depends-on` reference
   resolving to another selected task creates `dependency -> this task`, while a
   `blocks` reference creates `this task -> blocked task`. References to a plan,
   spec, ADR, or design remain upstream artifact relations rather than Task DAG
   edges. Task creation records references but does not validate the whole DAG;
   use `build_task_graph.js` for resolution and validation.
   `--verified-by` may be repeated to link the test specs this task satisfies;
   each target must resolve to an existing document by path or ID
   (TASK-DOC-GATE-002).
4. Keep status current.
   Use `todo`, `in-progress`, `blocked`, `done`, or `wont-do`.
5. Prefer short tasks.
   Split work when one task mixes unrelated files, behaviors, or verification
   paths. Keep a floor too: a task file should be a delegable work item —
   fold items smaller than one coherent action into the plan's own task list
   instead of creating micro-task files.

## Done Criteria Requirements

Every task must include a `## Verification` section with at least one
machine-checkable command. Human-only criteria are acceptable as supplements
but must not be the sole verification.

**Required format:**

```markdown
## Verification

- [ ] `npm test -- --filter=checkout-button` exits 0
- [ ] `grep -r 'CheckoutButton' src/components/` returns matches
- [ ] Manual: button renders in Storybook (supplement only)
```

**Rules:**

1. At least one entry must be a runnable command with an expected exit code or
   output pattern.
2. Commands must be copy-pasteable without modification (no placeholders).
3. If no automated check is possible, document why and add a follow-up task to
   create one.

A task cannot move to `done` until all verification commands pass. Task
status transitions are Execution Store state changes — `docs/tasks` has no
Registry 3 index to regenerate.

## Resources

- `scripts/new_task.js`: refuses at the registry gate under Registry 3 —
  `task` is execution-bound and has no durable creation path.
- `references/task-conventions.md`: status values, relations, required
  content, and conventions for task records.
- `assets/templates/task.md`: task body template — the reference structure
  for the Execution Store record, not a file template a script fills.
