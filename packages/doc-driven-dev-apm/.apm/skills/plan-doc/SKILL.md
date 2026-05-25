---
name: plan-doc
description: Use when turning an approved spec or ADR into an implementation plan with meaningful YAML front matter relations.
license: MIT
---

# Plan Documentation Skill

Use this skill after upstream documents are clear enough to implement. A plan
explains how the work will be built, which documents it implements or derives
from, and which verification steps prove the implementation follows the source
document.

In this package's lifecycle, the upstream path is:
**spec + ADR (parallel) → design → plan**.

`design-doc` is a hard gate for `plan-doc`.

## Workflow

1. Read the upstream spec fully.
   Do not plan from title or memory alone.
2. Confirm the upstream documents are ready.
   Prefer `approved` specs. If it is still draft/proposed, surface that risk
   before planning.
3. Confirm design gate requirements.
   `docs/designs/overview.md` must exist and at least one non-overview design
   document must have front matter `status: "approved"`.
4. Check for related ADRs.
   If ADRs constrain or inform the implementation approach, reference them.
   A plan does not require an ADR to proceed, but must acknowledge and
   incorporate relevant ones created in parallel with the spec.
5. Create the plan.

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
   ```

   The creation script follows `references/plan-conventions.md` and uses
   `assets/templates/plan.md`. If you cannot run the script, copy that template
   and fill it manually.

6. Record relations.
   The generated plan uses `relations.implements` for the upstream spec and
   `relations.derives-from` for linked design docs and ADRs.
7. Keep the plan implementation-ready.
   Include concrete files, behavior, tests, migration steps, and verification
   commands when they are known.

If the design gate fails, the script returns:

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## Implementation Readiness Matrix

Every plan must include the following sections before moving to `approved`.

### Dependency Graph

List execution-order dependencies between steps. Use a simple table or Mermaid
diagram:

| Step | Depends on | Blocks |
|------|-----------|--------|
| A    | —         | B, C   |
| B    | A         | D      |

Identify the critical path and any steps that can run in parallel.

### Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | (describe) | low/med/high | low/med/high | (action) |

Include at minimum: data-loss risk, breaking-change risk, and external
dependency availability risk.

### Rollback Strategy

For each irreversible step (migrations, public API changes, data
transformations), document:

- **Trigger**: condition that requires rollback.
- **Procedure**: exact commands or steps to revert.
- **Verification**: how to confirm the rollback succeeded.

### Verification Matrix

| Step | Verification command or criteria | Pass condition |
|------|----------------------------------|----------------|
| A    | `npm test -- --filter=checkout`  | exit 0, no regressions |
| B    | Manual: confirm UI renders        | screenshot matches spec |

Each step must have at least one verification entry.

## Status

Plan status values: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`.

## Resources

- `scripts/new_plan.js`: create a plan and update its index.
- `references/plan-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for plans.
- `assets/templates/plan.md`: default plan body template.
