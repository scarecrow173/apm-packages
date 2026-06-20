---
name: plan-doc
description: "Turn an approved spec or ADR into an implementation-ready plan with scope split, file map, dependency graph, risk register, rollback strategy, and verification matrix. Use when a spec or ADR is approved and you are planning implementation, deciding whether work splits into multiple plans, or you need file decomposition, ordered task breakdown, verification steps, or meaningful YAML front matter relations to upstream/downstream docs. Requires the design gate: docs/designs/overview.md must exist and at least one non-overview design doc must have front matter status approved. Keywords: implementation plan, plan-doc, scope split, file map, dependency graph, risk register, rollback, verification matrix, task breakdown, design gate"
license: MIT
---

# Plan Documentation Skill

Use this skill after upstream documents are clear enough to implement. A plan
explains how the work will be built, which documents it implements or derives
from, and which verification steps prove the implementation follows the source
document.

## Thinking Framework

Before creating a plan, answer these questions. They shape every later decision.

- **Who executes this?** Assume a future implementer with no memory of this
  session and no context for the spec. Every ambiguity you leave becomes a
  judgment call they make alone — and they will guess wrong.
- **One stream or many?** If two subsystems can ship and be verified
  independently, they are separate plans. A shared critical path and a single
  release intent are the only valid reasons to keep them in one plan.
- **What does "done" look like?** A plan without concrete, runnable verification
  criteria is a wish list, not a plan. Define the pass condition before the task.
- **What is irreversible here?** Migrations, public API changes, and data
  transformations cannot be undone with `git revert`. These need a rollback
  strategy before they enter the plan, not after they break.

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

   **MANDATORY before writing**: Read
   [`references/plan-conventions.md`](references/plan-conventions.md) in full to
   confirm directory detection, filename pattern, front matter schema, status
   values, relation semantics, and the design gate. The plan body depends on
   these conventions being correct.

   **Do NOT load** `assets/templates/plan.md` manually — `new_plan.js` loads it
   for you. Only open it directly when the script cannot run.

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
   ```

   If you cannot run the script, copy `assets/templates/plan.md` and fill it
   manually using the conventions you just read.

8. Record relations.
   The generated plan uses `relations.implements` for the upstream spec and
   `relations.derives-from` for linked design docs and ADRs.
9. Keep the plan implementation-ready.
   Include concrete files, behavior, tests, migration steps, and verification
   commands when they are known.
   Use bite-sized task steps: one action per step.
   Avoid placeholders and vague instructions.
10. Prepare implementation handoff.
    When the dependency graph contains independent work streams, recommend
    delegated or subagent-capable implementation as the default execution mode.
    Ask the user for approval before dispatching additional agents, remote
    automation, or separate execution contexts.

    If the user approves, discover the implementation and delegation capabilities
    available in the current environment, choose the capability that can execute
    plan tasks with review checkpoints, and proceed task-by-task. If no suitable
    capability is available, state that gap and continue inline with the same
    verification matrix.

    Do not hardcode environment-specific skill IDs in the plan. Describe the
    required capability instead: delegated implementation, independent task
    execution, review checkpoints, and verification before completion.

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
  → WHY: A bundled plan hides the real dependency boundaries, so a reviewer
  cannot tell which parts can ship independently and execution stalls on the
  slowest subsystem.
- Never leave file responsibilities implicit when they can be named.
  → WHY: The implementer re-derives the decomposition from the spec and reaches
  a different split than you intended, producing files that overlap or contradict.
- Never use placeholder language such as `TBD`, `TODO`, or `implement later`.
  → WHY: Placeholders pass a skim review but block execution — the implementer
  hits the gap mid-task with no context to fill it and guesses or stops.
- Never merge test creation, test execution, implementation, and verification
  into one task when they are separable.
  → WHY: An implementer skips the failing-first check when "write and run the
  test" is one step. The red run is the only proof the test exercises the right
  behavior; without it a passing test may be testing nothing.
- Never hide unknowns; record gaps explicitly instead of inventing details.
  → WHY: An invented detail looks authoritative, so the implementer trusts it
  and builds on a false premise, whereas an explicit gap routes the question to
  whoever can answer it.
- Never omit a verification entry for a step.
  → WHY: A step with no pass condition is "done" whenever the implementer
  decides it is, so regressions and partial work slip through unnoticed.
- Never rely on one repo's directory guess without checking the repo's actual
  plan directory convention.
  → WHY: Writing to `docs/plans/` when the repo uses `implementation-plans/`
  creates an orphan plan that the index and downstream tooling never find.

## Resources

- `scripts/new_plan.js`: create a plan and update its index.
- `references/plan-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for plans
  — load MANDATORY before creating or filling a plan.
- `assets/templates/plan.md`: default plan body template
  — loaded automatically by `new_plan.js`, do not load manually.
