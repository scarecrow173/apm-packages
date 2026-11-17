---
name: impl-doc
description: "Record what was actually implemented (ir) and what was tried during
  implementation (exp) under docs/impl/. Use when creating or auditing Implementation
  Records or Experiment Logs for any task. Keywords: implementation record, experiment
  log, ir, exp, impl audit, docs/impl"
license: MIT
---

# Implementation Documentation Skill

Use this skill to audit what was actually implemented and what was tried
during implementation in a pre-v3 corpus.

`impl-doc` is a document-generation sibling of `adr-doc`, `spec-doc`,
`design-doc`, `plan-doc`, and `task-doc`. It is not an implementation workflow
skill.

## Document Registry v3 status

`impl` (Implementation Records) and `exp` (Experiment Logs) are **legacy
formats** under Document Registry 3: they are interpreted only by migration
tooling and cannot be created or linted as durable documents. `docs/impl/ir`,
`docs/impl/exp`, and the `docs/impl` container are migration-owned scopes.

Every write entrypoint refuses at the registry gate — before any gate check,
scope check, or write:

`Document type "impl" is a legacy format under Document Registry 3: it is interpreted only by migration tooling and cannot be created or linted as a durable document`

- **Refusing mutators**: `new_impl_record.js`, `new_experiment_log.js`,
  `append_experiment_event.js`, `edit_experiment_log.js`,
  `sync_impl_index.js`.
- **Read-only audits stay available**: `audit_impl_record.js` and
  `audit_experiment_log.js` still inspect existing corpora, including index
  drift findings.
- **Migration-only sync**: the `impl-4col` / `exp-1col` index engines run
  only inside `migrate_ids`, which calls the sync library directly.
  `doc_maintenance index` reports these dirs as rejected targets
  (`... index is migration-owned`) and writes nothing.
- Evidence relations (Check → Claim → Evidence) belong to the Evidence
  Store, not to stored front matter relations; durable verification intent
  is a `verification` document (`docs/verification`, verification-doc).

The conventions and workflows below remain the contract for reading and
migrating a pre-v3 `docs/impl` corpus; they no longer describe files this
skill mints.

## When to Create What

Before running any commands, decide which artifact you need:

| Situation | Create | Timing |
| --- | --- | --- |
| Task implementation is starting | Create or reuse an in-progress Implementation Record | At task start, before the first code change, with `--status "in-progress"` |
| Task approach is uncertain - exploring options or testing hypotheses | Experiment Log | Optional before or at the start of exploratory implementation |
| Task approach is clear - executing a known plan | Skip exp, ir only | Still create the Implementation Record at task start |
| Multiple approaches were tested | One Experiment Log per approach | During investigation |

### Granularity Rules

- **1 task-doc -> 1 ir**: One Implementation Record per task. Subtasks link via
  `relations.changes`.
- **ir starts the task**: Create or reuse the task's in-progress Implementation
  Record before implementation starts. Keep the body current as the work
  proceeds instead of writing it after the fact.
- **exp is optional**: Create an Experiment Log only when genuinely exploring.
  Mechanical tasks with a known solution still require an Implementation
  Record, but they do not need an Experiment Log.
- **exp -> ir link is required when both exist**: When an exp was created, the
  resulting ir MUST reference it in `metadata.experiments.adopted` or `.rejected`.

## Responsibilities

1. Audit Implementation Records for front matter, relation, and section shape
   (read-only, on a pre-v3 corpus)
2. Audit Experiment Logs for minimum JSONL integrity (read-only)
3. Interpret `docs/impl/ir` and `docs/impl/exp` indexes for migration
   tooling — the sync engine runs inside `migrate_ids` only

## Workflow

### Refused write paths (Registry 3)

`new_impl_record.js`, `new_experiment_log.js`,
`append_experiment_event.js`, and `edit_experiment_log.js` all refuse at
the registry gate: `impl` and `exp` are legacy formats with no durable
creation or mutation path. Use `verification-doc` for durable verification
intent and the Evidence Store for evidence relations.

### Auditing a pre-v3 corpus

```bash
node scripts/audit_impl_record.js --json
node scripts/audit_experiment_log.js --json
```

### The migration-owned directory indexes

`docs/impl/ir/README.md` and `docs/impl/exp/README.md` are managed indexes
whose reconciliation is **migration-owned** under Registry 3.
`sync_impl_index.js` refuses at the registry gate like every other impl
writer; the safe sync engine (`planImplIndexSync` / `applyImplIndexSync`)
runs only inside `migrate_ids`, which calls the library directly.

- Verdicts the engine reports: `in-sync` (no-op), `sync` (reconcile drift),
  `create` (missing README), `rejected` (fail-closed). Rejected indexes —
  hand-curated, ambiguous, malformed, conflicting, or unsafe such as a
  symlinked README or links escaping the directory — are never written.
- An apply re-plans, verifies SHA-256 pins of every source file, the file
  list, and the README, then writes atomically via temp file + rename.
  Hand-written preamble and tail content around the generated region is
  preserved byte-for-byte.
- `doc_status` and the `doc_maintenance` repair verbs do not repair impl
  indexes; `doc_maintenance index` reports the dirs as rejected
  (`... index is migration-owned`) rather than dispatching to the sync
  engine — normal index operations fail closed on migration-owned scope.

Both audits are read-only and report index drift as findings:

- `missing-index` — no `README.md` (warning)
- `index-not-managed` — the README lacks the generated marker, is a
  symlink, or is otherwise not a regular managed file (warning)
- `index-missing-entry` / `index-stale-entry` / `index-duplicate-entry` —
  row membership drift (warning)
- `index-metadata-mismatch` / `index-tier-mismatch` — row cells or the
  active/settled tier disagree with source truth (warning)
- `index-ordering` — row order differs from the deterministic order
  (info)
- `index-unparseable` / `index-escapes-root` — malformed structure or
  links that escape the index directory (error)

## NEVER

- NEVER start task implementation without first creating or reusing an
  in-progress ir for that task
- NEVER treat known-solution or mechanical tasks as an excuse to skip the ir;
  they still require an in-progress Implementation Record from task start
- NEVER write an ir after the fact from memory - ir must reflect decisions made
  during implementation, not a post-hoc narrative
- NEVER manually edit JSONL files - use `append_experiment_event` or
  `edit_experiment_log`; direct edits break sequential `seq` integrity
- NEVER merge multiple tasks into one ir - one task = one ir; traceability
  depends on this 1:1 mapping
- NEVER skip the audit step before reporting completion - undetected front matter
  errors break downstream tools that query `relations.changes`
- NEVER create an exp after the task is done - it records real-time observations,
  not retrospective notes

## Conventions

- Implementation Records use the legacy doc-suite front matter conventions.
- `relations.changes` is part of the shared relation contract.
- `metadata.record-type` is not used in v1.
- `metadata.validation` is not used in v1.
- Experiment Log `start` events are optional at creation time (in the legacy
  corpus).
- All `new_*`, `append_*`, `edit_*`, and `sync_impl_index` commands refuse at
  the registry gate under Registry 3 — audits and migration tooling are the
  only entrypoints that touch these formats.

## Resources

- `references/impl-conventions.md`: directory, filename, status, and audit
  rules — load MANDATORY before any audit or migration operation
- `assets/templates/implementation-record.md`: legacy body template —
  reference structure only; no Registry 3 creation path fills it
- `assets/templates/experiment-log.jsonl`: legacy JSONL event template —
  reference structure only
