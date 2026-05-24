---
name: task-doc
description: Use when tracking implementation slices as YAML front matter plus Markdown tasks linked to plans, specs, ADRs, or other tasks.
license: MIT
---

# Task Documentation Skill

Use this skill to track implementation slices that are small enough to execute
and review. Tasks should link back to the plan, spec, or ADR they implement and
should state concrete completion criteria.

## Workflow

1. Read the related plan or upstream document.
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

## Resources

- `scripts/new_task.js`: create a task and update its index.
- `references/task-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for tasks.
- `assets/templates/task.md`: default task body template.
