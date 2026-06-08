---
name: impl-doc
description: Use when recording implemented outcomes and machine-readable implementation experiments under docs/impl/.
license: MIT
---

# Implementation Documentation Skill

Use this skill to record what was actually implemented and what was tried during
implementation.

`impl-doc` is a document-generation sibling of `adr-doc`, `spec-doc`,
`design-doc`, `plan-doc`, and `task-doc`. It is not an implementation workflow
skill.

## Responsibilities

1. Create an Implementation Record under `docs/impl/ir/`
2. Audit Implementation Records for front matter, relation, and section shape
3. Create an Experiment Log under `docs/impl/exp/`
4. Append experiment events through CLI as the normal operating path
5. Edit existing experiment events through CLI for exceptional fixes
6. Audit Experiment Logs for minimum JSONL integrity

## Workflow

1. Create the Implementation Record:

   ```bash
   node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md
   ```

2. Create the Experiment Log:

   ```bash
   node scripts/new_experiment_log.js --title "Try foo service extraction" --task docs/tasks/0003-implement-foo-service.md
   ```

3. Append events through CLI:

   ```bash
   node scripts/append_experiment_event.js \
     --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
     --type hypothesis \
     --summary "Splitting FooService may simplify BarService responsibilities"
   ```

4. Edit an existing event only when correction is required:

   ```bash
   node scripts/edit_experiment_log.js \
     --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
     --seq 4 \
     --set implementation=docs/impl/ir/0001-extract-foo-service.md
   ```

5. Audit both artifact types before reporting completion:

   ```bash
   node scripts/audit_impl_record.js --json
   node scripts/audit_experiment_log.js --json
   ```

## Conventions

- Implementation Records use existing doc-suite front matter conventions.
- `relations.changes` is part of the shared relation contract.
- `metadata.record-type` is not used in v1.
- `metadata.validation` is not used in v1.
- Experiment Log `start` events are optional at creation time.
- The normal path is CLI-based creation and updates, not free-form manual edits.

## Resources

- `references/impl-conventions.md`: directory, filename, status, and audit rules
- `assets/templates/implementation-record.md`: default body template
- `assets/templates/experiment-log.jsonl`: default JSONL event template
