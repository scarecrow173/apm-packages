---
name: task-doc
description: Use when tracking implementation slices as YAML front matter plus Markdown tasks linked to plans, specs, ADRs, or other tasks.
license: MIT
---

# Task Documentation Skill

Use this skill to track implementation slices that are small enough to execute
and review. Tasks should link back to the plan, spec, or ADR they implement and
should state concrete completion criteria.

## Preconditions

<HARD-GATE>
To create a task, one of the following must be satisfied:

1. **Normal path**: The referenced plan has `status` of `approved` or above.
   Do not derive tasks from a `draft` plan.
   If the plan is not yet approved, complete its review and approval first.
2. **Emergency fix path**: When no plan exists, ALL of the following must hold:
   - State the reason for urgency in the task body (one line).
   - Reference an `approved` spec-doc or adr-doc via
     `relations.implements` or `relations.derives-from`.
   - If no spec/ADR exists either, create one first (brief content is acceptable).
3. **Post-implementation follow-up path**: When the task comes from the
   lifecycle Phase 5 Exit Gate, ALL of the following must hold:
   - The follow-up has a recorded classification.
   - `bug-fix` and `doc-only` tasks reference the current approved plan, the
     verified task, or the affected upstream document.
   - `decision-required` and `new-feature` items are not implementation tasks
     until their upstream spec, ADR, design, or plan route is completed.
   - Dependencies are explicit through `relations.depends-on` and
     `relations.blocks`.

If neither path is satisfied, do not create the task.
</HARD-GATE>

## Workflow

1. Confirm the referenced plan has `status: "approved"`.
   For emergency fixes without a plan, verify the emergency fix path
   preconditions above are met.
2. Create a task for one coherent implementation slice.

   ```bash
   node scripts/new_task.js --title "Wire checkout button" --plan docs/plans/0001-implement-checkout-flow.md
   ```

   The creation script follows `references/task-conventions.md` and uses
   `assets/templates/task.md`. If you cannot run the script, copy that template
   and fill it manually.

3. Use meaningful relations.
   Generated tasks point to the plan with `relations.implements` and
   `relations.depends-on`.
4. Keep status current.
   Use `todo`, `in-progress`, `blocked`, `done`, or `wont-do`.
5. Prefer short tasks.
   Split work when one task mixes unrelated files, behaviors, or verification
   paths.

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

A task cannot move to `done` until all verification commands pass.

## Resources

- `scripts/new_task.js`: create a task and update its index.
- `references/task-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for tasks.
- `assets/templates/task.md`: default task body template.
