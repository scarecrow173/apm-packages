---
name: plan-doc
description: Use when turning an approved spec or ADR into an implementation plan with meaningful YAML front matter relations.
license: MIT
---

# Plan Documentation Skill

Use this skill after a spec or ADR is clear enough to implement. A plan explains
how the work will be built, which documents it implements or derives from, and
which verification steps prove the implementation follows the source document.

## Workflow

1. Read the upstream spec or ADR fully.
   Do not plan from title or memory alone.
2. Confirm the upstream document is ready.
   Prefer `approved` specs or `accepted` ADRs. If it is still draft/proposed,
   surface that risk before planning.
3. Create the plan.

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md
   ```

   The creation script follows `references/plan-conventions.md` and uses
   `assets/templates/plan.md`. If you cannot run the script, copy that template
   and fill it manually.

4. Record relations.
   The generated plan uses `relations.implements` and `relations.derives-from`
   for the upstream document.
5. Keep the plan implementation-ready.
   Include concrete files, behavior, tests, migration steps, and verification
   commands when they are known.

## Status

Plan status values: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`.

## Resources

- `scripts/new_plan.js`: create a plan and update its index.
- `references/plan-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for plans.
- `assets/templates/plan.md`: default plan body template.
