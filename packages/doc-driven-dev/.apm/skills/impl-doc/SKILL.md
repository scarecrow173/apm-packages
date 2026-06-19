---
name: impl-doc
description: "Record what was actually implemented (ir) and what was tried during
  implementation (exp) under docs/impl/. Use when creating or auditing Implementation
  Records or Experiment Logs for any task. Keywords: implementation record, experiment
  log, ir, exp, impl audit, docs/impl"
license: MIT
---

# Implementation Documentation Skill

Use this skill to record what was actually implemented and what was tried during
implementation.

`impl-doc` is a document-generation sibling of `adr-doc`, `spec-doc`,
`design-doc`, `plan-doc`, and `task-doc`. It is not an implementation workflow
skill.

## When to Create What

Before running any commands, decide which artifact you need:

| Situation | Create | Timing |
|-----------|--------|--------|
| Task approach is uncertain — exploring options or testing hypotheses | Experiment Log | Before or at the start of implementation |
| Task approach is clear — executing a known plan | Skip exp, ir only | When task completes |
| Task is complete and ready to close | Implementation Record | Before closing the task |
| Multiple approaches were tested | One Experiment Log per approach | During investigation |

### Granularity Rules

- **1 task-doc → 1 ir**: One Implementation Record per task. Subtasks link via
  `relations.changes`.
- **exp is optional**: Create an Experiment Log only when genuinely exploring.
  Mechanical tasks with a known solution do not need one.
- **exp → ir link is required when both exist**: When an exp was created, the
  resulting ir MUST reference it in `metadata.experiments.adopted` or `.rejected`.

## Responsibilities

1. Create an Implementation Record under `docs/impl/ir/`
2. Audit Implementation Records for front matter, relation, and section shape
3. Create an Experiment Log under `docs/impl/exp/`
4. Append experiment events through CLI as the normal operating path
5. Edit existing experiment events through CLI for exceptional fixes
6. Audit Experiment Logs for minimum JSONL integrity

## Workflow

### Creating an Implementation Record

**MANDATORY**: Load `references/impl-conventions.md` before this step —
it defines required front matter fields and audit rules.
**Do NOT load** `assets/templates/experiment-log.jsonl` for this task.

```bash
node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md
```

### Creating an Experiment Log

**MANDATORY**: Load `references/impl-conventions.md` before this step —
it defines allowed event types and JSONL integrity rules.
**Do NOT load** `assets/templates/implementation-record.md` for this task.

```bash
node scripts/new_experiment_log.js --title "Try foo service extraction" --task docs/tasks/0003-implement-foo-service.md
```

### Appending Events

```bash
node scripts/append_experiment_event.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --type hypothesis \
  --summary "Splitting FooService may simplify BarService responsibilities"
```

### Editing an Existing Event (exceptional only)

```bash
node scripts/edit_experiment_log.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --seq 4 \
  --set implementation=docs/impl/ir/0001-extract-foo-service.md
```

### Auditing Before Completion

```bash
node scripts/audit_impl_record.js --json
node scripts/audit_experiment_log.js --json
```

## NEVER

- NEVER write an ir after the fact from memory — ir must reflect decisions made
  during implementation, not a post-hoc narrative
- NEVER manually edit JSONL files — use `append_experiment_event` or
  `edit_experiment_log`; direct edits break sequential `seq` integrity
- NEVER merge multiple tasks into one ir — one task = one ir; traceability
  depends on this 1:1 mapping
- NEVER skip the audit step before reporting completion — undetected front matter
  errors break downstream tools that query `relations.changes`
- NEVER create an exp after the task is done — it records real-time observations,
  not retrospective notes

## Conventions

- Implementation Records use existing doc-suite front matter conventions.
- `relations.changes` is part of the shared relation contract.
- `metadata.record-type` is not used in v1.
- `metadata.validation` is not used in v1.
- Experiment Log `start` events are optional at creation time.
- The normal path is CLI-based creation and updates, not free-form manual edits.
- Trust boundary: `new_*`, `append_*`, and `edit_*` commands are state-changing
  and write immediately to the paths selected by `--task`, `--file`, or
  default output conventions.

## Resources

- `references/impl-conventions.md`: directory, filename, status, and audit rules
  — load MANDATORY before any create or audit operation
- `assets/templates/implementation-record.md`: default body template
  — loaded automatically by `new_impl_record.js`, do not load manually
- `assets/templates/experiment-log.jsonl`: default JSONL event template
  — loaded automatically by `new_experiment_log.js`, do not load manually
