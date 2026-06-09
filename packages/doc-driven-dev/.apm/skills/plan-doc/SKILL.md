---
name: plan-doc
description: Use when turning an approved spec or ADR into an implementation plan, especially when you need scope checks, file decomposition, small task breakdowns, verification, or meaningful YAML front matter relations.
license: MIT
---

# Plan Documentation Skill

Use this skill after upstream documents are clear enough to implement. A plan
explains how the work will be built, which documents it implements or derives
from, and which verification steps prove the implementation follows the source
document.

## Scope Check

If a spec spans multiple independent subsystems, do not force them into one
plan by default. Split into separate plans when each subsystem can be
implemented and verified independently. Keep a single plan only when the steps
share the same critical path and the same release intent.

## Workflow

1. Read the upstream spec fully.
   Do not plan from title or memory alone.
2. Check scope before decomposition.
   Map the proposed plan to one implementation stream. If it crosses
   subsystems, split it or call out the split explicitly.
3. Confirm the upstream documents are ready.
   Prefer `approved` specs. If it is still draft/proposed, surface that risk
   before planning.
4. Confirm design gate requirements.
   `docs/designs/overview.md` must exist and at least one non-overview design
   document must have front matter `status: "approved"`.
5. Map files and responsibilities before writing tasks.
   List the files, modules, docs, or ownership boundaries the plan will touch.
   If a detail is unknown, mark the gap instead of inventing a placeholder.
6. Check for related ADRs.
   If ADRs constrain or inform the implementation approach, reference them.
   A plan does not require an ADR to proceed, but must acknowledge and
   incorporate relevant ones created in parallel with the spec.
7. Create the plan.

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
   ```

   The creation script follows `references/plan-conventions.md` and uses
   `assets/templates/plan.md`. If you cannot run the script, copy that template
   and fill it manually.

8. Record relations.
   The generated plan uses `relations.implements` for the upstream spec and
   `relations.derives-from` for linked design docs and ADRs.
9. Keep the plan implementation-ready.
   Include concrete files, behavior, tests, migration steps, and verification
   commands when they are known.
   Use bite-sized task steps: one action per step.
   Avoid placeholders and vague instructions.

If the design gate fails, the script returns:

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## Implementation Readiness Matrix

Every plan must include the following sections before moving to `approved`.

### File Map

List the files or modules the plan will create or modify and what each one is
responsible for. Keep the responsibilities narrow enough that another engineer
can see the decomposition without re-reading the spec.

| Path | Responsibility | Notes |
|------|----------------|-------|
| `path/to/file.ts` | Owns X | Changes with Y |
| `path/to/test.ts` | Verifies X | Add before implementation |

If the file list is incomplete, call out the gap explicitly.

### Dependency Graph

List execution-order dependencies between steps. Use a simple table or Mermaid
diagram:

| Step | Depends on | Blocks |
|------|------------|--------|
| A    | —          | B, C   |
| B    | A          | D      |

Identify the critical path and any steps that can run in parallel.

### Task Granularity

Each task should be one action that an implementer can complete without
guesswork. Split test writing, test execution, implementation, and commit steps
when they are distinct actions.

- Good: "Write the failing test"
- Good: "Run the targeted test and confirm it fails"
- Good: "Implement the minimal code change"
- Good: "Re-run the targeted test and confirm it passes"
- Bad: "Implement the feature and make sure it works"
- Bad: "Handle validation and edge cases"

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

### Self-Review

Before the plan moves forward, check it against the source material again.

1. Spec coverage: does every spec requirement map to a task?
2. Placeholder scan: remove or replace `TBD`, `TODO`, `implement later`, and
   similar vague language.
3. Consistency check: do file paths, relation keys, status values, commands,
   and terminology match across the plan?

### Review Handoff

Capture the remaining assumptions and open questions so a reviewer can focus on
real gaps instead of style changes.

- List any gaps that were intentionally left explicit.
- List any dependencies that must be resolved before implementation starts.
- Point the reviewer at the upstream spec, design docs, and ADRs that informed
  the plan.

## Status

Plan status values: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`.

## Never

- Never force unrelated subsystems into a single plan without calling out the
  split.
- Never leave file responsibilities implicit when they can be named.
- Never use placeholder language such as `TBD`, `TODO`, or `implement later`.
- Never merge test creation, test execution, implementation, and verification
  into one task when they are separable.
- Never hide unknowns; record gaps explicitly instead of inventing details.
- Never omit a verification entry for a step.
- Never rely on one repo's directory guess without checking the repo's actual
  plan directory convention.

## Resources

- `scripts/new_plan.js`: create a plan and update its index.
- `references/plan-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for plans.
- `assets/templates/plan.md`: default plan body template.
