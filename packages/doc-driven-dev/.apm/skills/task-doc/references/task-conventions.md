# Task Conventions

These conventions define how `task-doc` creates, audits, indexes, and routes
implementation tasks.

A task is a small, reviewable implementation slice linked to a plan, spec, ADR,
or another task. A task should be narrow enough that one agent can complete and
verify it without rediscovering the whole project context.

## Directory

If a repository already has a task or work-item directory, keep it. Do not move
existing tasks just to match this package's defaults.

When no task directory exists, use `docs/tasks/` by default.

Detection order used by scripts:

1. `docs/tasks/`
2. `docs/work-items/`
3. `tasks/`
4. `work-items/`

When multiple candidates exist, prefer the directory with numbered task files
and an index file. Use `--dir` only when the repository has an explicit
convention that is not in the detection list.

## Filenames

Default filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is a zero-padded sequential number local to the task directory.
- The title slug is lowercase ASCII with words separated by dashes.
- Prefer an imperative phrase naming the implementation slice.
- Keep titles narrow: one behavior, module, migration step, or verification
  path.
- Avoid task names that hide scope, such as `cleanup.md`, `fix-stuff.md`, or
  `phase-1.md`.
- Examples: `0001-wire-checkout-button.md`,
  `0002-add-invitation-api-tests.md`.

If a repository already uses slug-only filenames, follow that convention instead
of introducing numbering.

## Required Front Matter

Tasks use the shared document front matter:

```yaml
---
id: "TASK-0001"
type: "task"
status: "todo"
title: "Wire checkout button"
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
  defers: []
  deferred-by: []
---
```

Required fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable document identifier, usually `TASK-NNNN`. |
| `type` | Yes | Must be `task`. |
| `status` | Yes | Current execution state. |
| `title` | Yes | Human-readable task title. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People or groups accountable for the task. |
| `relations` | Yes | Meaningful links to upstream, dependency, and verification docs. |

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `todo` | Not started. |
| `in-progress` | Being implemented. |
| `blocked` | Waiting on a dependency or decision. |
| `done` | Implemented and verified. |
| `wont-do` | Explicitly not pursued. |

Keep `status` focused on execution state. Use `relations.depends-on` and
`relations.blocks` for sequencing instead of encoding dependency state in the
title.

## Relations

Use relation fields for meaning, not document type.

| Field | Meaning |
| --- | --- |
| `implements` | Plan, spec, or ADR this task executes. |
| `derives-from` | Upstream plan or discovery note that produced this task. |
| `depends-on` | Tasks, plans, decisions, or specs required before this task can proceed. |
| `blocks` | Tasks or plans blocked by this task. |
| `verifies` | Spec, plan, ADR, or behavior this task verifies. |
| `verified-by` | Test notes, review notes, or follow-up tasks that verify this task. |
| `source` | External source that directly constrains the task. |
| `references` | Supplementary implementation notes or docs. |
| `defers` | Future work intentionally deferred from this document, pointing to a draft spec/design. |
| `deferred-by` | Documents that deferred this draft future work to a later phase. |
| `supersedes` | Older tasks replaced by this task. |
| `superseded-by` | Newer tasks that replace this task. |
| `related` | Contextual docs without directional dependency. |

Internal documents use relative paths. External sources use URLs.

## Required Content

Tasks should include:

1. Work to perform.
2. Upstream documents being implemented.
3. Dependencies and blockers.
4. Affected files, modules, or docs.
5. Done criteria.
6. Verification command, test, or manual review.
7. Notes about what is explicitly out of scope for this task.

Done criteria must be checkable. If a task cannot state its verification path,
return to the plan or spec before starting implementation.

## Mutability

Tasks are active execution records.

- `todo` tasks may be edited freely.
- `in-progress` tasks may receive clarifications and dated implementation
  notes, but should not hide work already attempted.
- `blocked` tasks should record the blocking document or task in
  `relations.depends-on`.
- `done` tasks should preserve completion evidence and verification notes.
- If the task scope changes substantially, create a new task or supersede the
  old one instead of broadening it silently.
- Status, owner, and relation updates are acceptable in-place edits.

## Index

Use `README.md` as the default task index. If a repository already uses
`index.md`, keep it.

The index should list tasks in filename order and include enough metadata for a
reader to scan title, status, upstream plan, blockers, and owner quickly.

## Subdirectory Grouping

### Category subdirectories

For large repositories, tasks may be split into subdirectories by implementation
area, release, or workstream:

```text
docs/tasks/
  frontend/
    0001-wire-checkout-button.md
  backend/
    0001-add-checkout-endpoint.md
  verification/
    0001-add-checkout-e2e.md
```

Numbers are local to each category. Document the categorization scheme in the
index before the structure grows. Use area grouping only when a flat directory
is becoming hard to scan.

### Feature subdirectories

Subdirectories also work for feature-level grouping, when all tasks for a
single feature are best tracked together:

```text
docs/tasks/
  checkout/
    0001-wire-checkout-button.md
    0002-add-checkout-api-endpoint.md
    0003-add-checkout-e2e-tests.md
```

Use this pattern when the tasks belong to the same feature and share a common
upstream plan. Keep numbering local to the feature directory.
