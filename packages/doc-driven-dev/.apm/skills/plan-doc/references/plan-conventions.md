# Plan Conventions

These conventions define how `plan-doc` creates, audits, indexes, and routes
implementation plans.

`plan-doc` requires a `design-doc` approval gate before creation.

A plan translates an approved spec or accepted ADR into implementation order,
risks, dependencies, verification checkpoints, and a task breakdown that is
small enough to execute without reinterpreting the upstream document.

## Planning Scope

If a change spans multiple independent subsystems, split it into separate plans
unless the work shares the same critical path and release intent. A single plan
should read like one implementation stream, not a bundle of unrelated projects.

## Directory

If a repository already has a plan directory, keep it. Do not move existing
plans just to match this package's defaults.

When no plan directory exists, use `docs/plans/` by default.

Detection order used by scripts:

1. `docs/plans/`
2. `docs/implementation-plans/`
3. `plans/`
4. `implementation-plans/`

When multiple candidates exist, prefer the directory with numbered plan files
and an index file. Use `--dir` only when the repository has an explicit
convention that is not in the detection list.

## Filenames

Default filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is a zero-padded sequential number local to the plan directory.
- The title slug is lowercase ASCII with words separated by dashes.
- Prefer an imperative or implementation-oriented phrase, such as
  `implement-checkout-flow` or `migrate-session-storage`.
- Name the plan after the work sequence, not just the upstream spec title.
- Examples: `0001-implement-checkout-flow.md`,
  `0002-migrate-session-storage.md`.

If a repository already uses slug-only filenames, follow that convention instead
of introducing numbering.

## Required Front Matter

Plans use the shared document front matter:

```yaml
---
id: "PLAN-0001"
type: "plan"
status: "draft"
title: "Implement checkout flow"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
---
```

Required fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable document identifier, usually `PLAN-NNNN`. |
| `type` | Yes | Must be `plan`. |
| `status` | Yes | Current lifecycle state. |
| `title` | Yes | Human-readable implementation plan title. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People or groups accountable for execution. |
| `relations` | Yes | Meaningful links to upstream and downstream documents. |

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `draft` | Being written. |
| `approved` | Ready for implementation. |
| `in-progress` | Implementation has started. |
| `blocked` | Cannot proceed until a dependency is resolved. |
| `completed` | Implemented and verified. |
| `superseded` | Replaced by a newer plan. |

Keep `status` focused on execution state. Use `relations.depends-on` for
blocking prerequisites and `relations.superseded-by` for replacement plans.

## Relations

Use relation fields for meaning, not document type.

| Field | Meaning |
| --- | --- |
| `implements` | Specs or ADRs this plan implements. |
| `implemented-by` | Tasks that execute this plan. |
| `derives-from` | Upstream spec, ADR, idea, or brainstorm that produced the plan. |
| `derived-by` | Tasks or follow-up plans derived from this plan. |
| `depends-on` | Plans, tasks, specs, or ADRs that must be resolved first. |
| `blocks` | Plans or tasks blocked by this plan. |
| `source` | External sources that materially affect the implementation approach. |
| `references` | Supplementary implementation notes or docs. |
| `supersedes` | Older plans replaced by this plan. |
| `superseded-by` | Newer plans that replace this plan. |
| `related` | Contextual docs without directional dependency. |
| `verifies` | Specs, ADRs, or acceptance criteria the plan verifies. |
| `verified-by` | Test plans, task docs, or review notes that verify this plan. |

Internal documents use relative paths. External sources use URLs.

## Required Content

Plans should include:

1. Goal and non-goals.
2. Scope boundaries and whether the work should be split into multiple plans.
3. Files, modules, or ownership boundaries the plan will touch.
4. Upstream specs or ADRs being implemented.
5. Implementation sequence with ordered phases.
6. Tasks sized as single actions, not bundled narratives.
7. Dependencies, blockers, risks, and mitigations.
8. Verification commands or manual checks.
9. Rollback or follow-up notes when the implementation is risky.
10. A self-review pass that checks spec coverage, placeholder cleanup, and
    terminology consistency.

## Task Granularity

Write tasks so each one is a discrete action.

- Good: write the failing test.
- Good: run the targeted test and confirm it fails.
- Good: implement the minimal code change.
- Good: re-run the targeted test and confirm it passes.
- Good: commit the change.
- Bad: implement the feature and make sure it works.
- Bad: handle validation and edge cases.

If a task has multiple separable actions, split it.

## Design Gate (Mandatory)

Before creating a plan:

- `docs/designs/overview.md` must exist.
- At least one non-overview design file must have front matter
  `status: "approved"` (exact match).

If the gate fails, `new_plan` must return:

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

Recommended creation command:

```bash
node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
```

Plans should name concrete files, modules, commands, or ownership boundaries
when they are known. If a detail is not known, mark the gap explicitly instead
of pretending the plan is implementation-ready.

## No Placeholders

Plans are failures if they rely on placeholder language instead of concrete
content.

- Do not use `TBD`, `TODO`, `implement later`, or similar filler.
- Do not say "add validation" or "handle edge cases" without specifying what
  the validation or edge case is.
- Do not say "write tests for the above" without naming the tests or behavior.
- Do not reference a function, file, or module that has not already been
  introduced in the plan.

If a detail is unknown, record it as an explicit gap.

## Mutability

Plans are execution artifacts and may evolve while work is active.

- `draft` plans may be edited freely.
- `approved` plans may be clarified before work starts.
- `in-progress` plans may receive dated updates that reflect implementation
  reality, but do not erase the original sequence without explanation.
- `completed` plans should preserve what was actually done and verified.
- Substantive re-planning should create a superseding plan when the old plan no
  longer describes the work.
- Status, owner, and relation updates are acceptable in-place edits.

## Index

Use `README.md` as the default plan index. If a repository already uses
`index.md`, keep it.

The index should list plans in filename order and include enough metadata for a
reader to scan title, status, upstream document, and owner quickly.

## Categories

For large repositories, plans may be split into subdirectories, for example:

```text
docs/plans/
  frontend/
    0001-implement-checkout-flow.md
  backend/
    0001-add-invitation-api.md
  migrations/
    0001-migrate-session-storage.md
```

Numbers are local to each category. Document the categorization scheme in the
index before the structure grows. Use categories by execution area, team,
release, or migration stream only when a flat directory is becoming hard to
scan.

## Review Handoff

When the plan is complete, include enough context for a reviewer to focus on
substantive gaps rather than wording preferences.

- List any explicit assumptions.
- List any unresolved dependencies or missing information.
- Point to the upstream spec, design docs, and ADRs that matter most.
