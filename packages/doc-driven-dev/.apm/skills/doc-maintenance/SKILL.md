---
name: doc-maintenance
description: Use when repairing deterministic document inconsistencies, regenerating managed indexes, or normalizing document paths that doc-status diagnosed. Preview-first, explicit-apply only.
license: MIT
---

# Document Maintenance Skill

`doc-maintenance` owns the mutation side of the document quality contract:
safe, deterministic repair and index regeneration. It answers "how do we fix
the mechanical inconsistencies already diagnosed?" while `doc-status` keeps
answering "what is broken in the current document set?".

This skill is not a development orchestrator. It holds no lifecycle routing
authority in `doc-driven-dev-graph`, and the correctness verdict after any
repair still belongs to `doc-status`.

## Preview-First Contract

Every invocation follows this pipeline:

```text
scan → plan → preview → explicit apply → rescan → doc-status validation
```

- `plan` computes the change set and writes nothing.
- `apply` executes only the whitelisted actions, then rescans the repository
  and reports remaining `doc-status` findings.
- An invocation without `apply` never modifies project files.

## Safe Repair Whitelist

Only meaning-preserving, mechanically provable changes may auto-apply:

- `rebuild-index` — regenerate the managed index table
  (`<!-- doc-suite:generated-index -->`) for a document type: add missing
  entries, drop stale ones, sync ID/title/status/file cells, and restore
  deterministic ordering. Hand-curated README files without the marker are
  never overwritten unless `--force-index` is passed.
- `fix-link-case` — rewrite a link target whose path differs from the real
  file only by case, using the actual directory entry.

Never auto-repaired (semantic inference is refused):

- missing relations, statuses, owners, or sources
- missing upstream documents
- semantic targets of broken links
- orphan document deletion
- hand-curated index files (without `--force-index`)

Findings outside the whitelist are reported as skipped with a `manual` or
`migration` reason so the caller can route them to a human or to migration.
The repo-level `doc-status` findings — `tracked-execution-doc`,
`tracked-legacy-doc`, `legacy-corpus-doc`, every Evidence Store axis, and
the `*-evidence-store` marker findings — are skip-only by contract:
tracked plan/task and legacy Markdown is migration inventory the
`migrate` flow owns, and Evidence records are immutable — this skill never
repairs, rewrites, or copies them into durable Markdown. The scope-level
`legacy-doc-in-durable-dir` marker is the same class: a legacy or
execution-bound typed file sitting in a durable directory is migration
corpus only the `migrate` flow resolves.

## Commands

```bash
node scripts/doc_maintenance.js plan --type spec
node scripts/doc_maintenance.js plan --json
node scripts/doc_maintenance.js apply --type spec
node scripts/doc_maintenance.js apply --force-index --json
```

- `plan` — preview actions and skipped findings; writes nothing.
- `apply` — apply whitelisted actions, rescan, and print a validation summary
  (`findings before` / `findings after`).
- Options: `--type` (durable types `idea`, `brainstorm`, `discovery`,
  `spec`, `design`, `adr`, `knowledge`, `verification`, or `all`),
  `--dir`, `--force-index`, `--json`.

`index` is the explicit managed-index materialization entrypoint — INDEX
only, across every durable owner. Unlike `plan`/`apply` it touches nothing
outside managed index content (no link normalization, no source repairs),
and it dispatches each write to the owning writer: shared-4col directories
(`docs/knowledge` and `docs/verification` included) through the shared
renderer/merge and `docs/adr` through the ADR managed writer. Directories whose residents are execution-bound (`docs/plans`,
`docs/tasks`, `docs/implementation-plans`, `docs/work-items`) or legacy
(`docs/test-spec`, `docs/test-specs`, `docs/impl`, `docs/impl/ir`,
`docs/impl/exp`) are migration-owned scopes — `index` reports them as
rejected targets (`... index is migration-owned`) and never writes; the
impl index engine runs only inside `migrate_ids`.

```bash
node scripts/doc_maintenance.js index plan [--dir <path>] [--json]
node scripts/doc_maintenance.js index apply [--dir <path>] [--expect <planHash>] [--json]
```

- `index plan` — preview only; writes nothing. Reports each target's
  directory, kind, owner, verdict (`in-sync` / `sync` / `create` /
  `rejected`), change count, source count, and `planHash`.
- `index apply` — re-plans, re-validates every drift pin (sources, file
  list, index bytes) against the live filesystem, then writes. Reports the
  `written` and `blocked` lists; any blocked target exits non-zero.
  `--expect <planHash>` pins the apply to a previously previewed `planHash`
  and refuses all writes when the recomputed plan differs. Rejected
  targets — hand-curated, malformed, symlinked, or out-of-contract
  directories such as `docs/impl` itself — are reported and never written.
- Options: `--dir`, `--expect`, `--json`. There is no `--type` or
  `--force-index` on `index` — strict by contract.

### `index apply` exit codes and rejected targets

`index plan` exits 0 even when targets are `rejected` — the preview
reports every verdict honestly. `index apply` still writes every
target that plans cleanly, reports each target it cannot write in
`blocked`, and exits 1 whenever `blocked` is non-empty. The default
scope is every managed directory, so one `rejected` directory fails
the whole run even when the directories you changed applied cleanly;
pass `--dir <path>` to scope the apply to a single directory.

A `rejected` target is never written and has no force path on the
`index` op (`--force-index` is not a valid argument there). Do not work
around it by hand — fix the cause and regenerate. The `reason` field
identifies the cause: a hand-curated index needs the generated-index
marker (or `promote_index` adoption where that narrow case applies), and
a migration-owned directory (`... index is migration-owned`) can only be
reconciled inside migration tooling. For `docs/impl/ir` and
`docs/impl/exp` the owner-side rules live in
[impl-doc](../impl-doc/SKILL.md) ("The migration-owned directory
indexes"); `promote_index` covers only its legacy-scaffold adoption case
and is not a general escape hatch.

### Resolving index conflicts

Managed index tables are generated — never hand-merge their rows. When
a merge leaves an index conflicted, take either side's file to clear
the conflict (the rows are regenerated anyway), then rebuild from
source truth and verify:

```bash
git checkout --theirs docs/specs/README.md   # --ours works too
node scripts/doc_maintenance.js index apply --dir docs/specs
node scripts/doc_maintenance.js index plan --dir docs/specs   # verdict=in-sync
```

## Idempotency

The same repair applied twice is a no-op the second time: index regeneration
produces deterministic output for the same document set, and applied link
normalizations no longer appear as findings.

## Status-Transition Close-Out

Status edits are manual front-matter changes — no command transitions a
document — but they can move a row between the in-flight table and the
`## Settled` tier. On every `status` change, regenerate the owning index
in the same change (`index plan` then `index apply`); `doc_status
lint` reports the stale index until then. Regeneration is also the
two-tier format migration.

## Schema Preflight & Migration Gate

Every normal entrypoint in the package — routing, inspection, context fetch,
task-graph and dashboard builds, status audits, creators, and maintenance —
runs a shared schema preflight before it touches the repository. The
preflight reads the consumer manifest at `docs/.doc-driven-dev/schema.json`
and cross-checks the real document tree, relations, and execution state
against it. Normal execution proceeds only while the repository is `current`
or `uninitialized`; `migration-required`, `migration-incomplete`,
`unsupported-version`, and `invalid` print a machine-readable refusal to
stdout (reason code, detected version, path, recommended command) and exit 2.
Read-only and preview commands keep their byte- and Git-state-preserving
contract; the preflight itself never writes.

The manifest declares the schema contract:

```json
{
  "schemaVersion": 1,
  "documentRegistry": 3,
  "knowledgeRelations": 1,
  "verificationDesign": 1,
  "evidenceRecord": 1,
  "graphDefinition": 3
}
```

`migrate` is the only authorized migration surface and the only way through a
non-current state — there is no general guard bypass:

```bash
node scripts/doc_maintenance.js migrate plan [--cwd <repo>] [--json]
node scripts/doc_maintenance.js migrate apply [--cwd <repo>] [--expect <planHash>] [--resolutions <file>] [--allow-dirty] [--json]
node scripts/doc_maintenance.js migrate recovery [--cwd <repo>] [--resume|--rollback] [--expect <planHash>] [--json]
```

- `migrate plan` — fully read-only; reports the preflight diagnosis, apply
  eligibility, and a deterministic `planHash`. On every repository it
  additionally emits the complete legacy inventory and
  dry-run migration plan: every legacy document (Spec, ADR, Design,
  Discovery, Test Spec, Plan, Task, IR, EXP), old relations and indexes,
  caller checkpoints/receipts/`effectOutcome` bookkeeping, experiment
  JSONL events, active runs with their required handoff, foreign state,
  input hashes, planned writes and removals, collisions with their
  deterministic alternates, mechanical convertibles, semantic-decision
  blockers, resolution inputs, and residual risks. It writes nothing —
  not the repository, the Git index, the Execution Store, or the
  manifest — and never guesses lifecycle, status, relations, or
  evidence truth: ambiguous items are explicit decisions or blockers.
  Test Specs plan into Verification Design documents preserving their
  intent; Plans/Tasks plan into an Execution Store run snapshot; IR/EXP
  items classify conservatively into durable or diagnostic destinations.
  Legacy relations such as `derives-from` are never mechanically
  rewritten into Knowledge Relations v1 — each is a semantic decision.
- `migrate apply` — the journaled migration engine. It rebuilds the
  deterministic plan and refuses every write until all gates pass: the
  `--expect <planHash>` pin, a `migration` classification with no
  collisions, every required semantic decision resolved via
  `--resolutions <file>` (a JSON object `{schemaVersion: 1, planHash,
  decisions: {"D-0001": <choice-or-object>}}`, with `runHandoffs` for
  existing-run merges), a clean worktree unless `--allow-dirty` pins the
  risk, and the Execution Store boundary. It then stages all artifacts
  under `.apm/state/doc-driven-dev/migration/`, validates the staged
  bytes (durable front matter, export digests, task DAG, VD check
  bindings), and publishes step-by-step under
  `docs/.doc-driven-dev/migration.journal.json`. Test Specs become
  Verification Design docs with declared checks, Plans/Tasks import as
  Execution Store runs carrying receipts, checkpoints, and plan
  provenance, ambiguous or explicitly diagnostic content routes into a
  deterministic diagnostics run, managed indexes regenerate (new type
  dirs get one), sources are removed at finalize, a postflight
  lint/graph gate plus the schema preflight runs, and the manifest is
  stamped LAST. `applied` is true only when the post-apply preflight is
  `current`; on a manifest-only repo it stays the old bounded path —
  manifest stamp, nothing else.
- `migrate recovery` — inspects an in-flight journal without mutating
  it. `--resume` continues from the exact step the apply stopped at
  (every step is idempotent; a crash before the step plan committed
  re-runs the staging transform; input/staging drift refuses with a
  replan instruction), `--rollback` undoes done steps in reverse —
  published artifacts removed, originals restored — leaving the tree
  byte-identical to the pre-migration state. The one irreversible step
  is a `finalize` run handoff: a finalized run stays finalized and
  rollback reports it rather than pretending — restore it by importing
  its export or re-approving. `--expect` pins recovery to a specific
  planHash.

## Migration Commands

`doc-maintenance` also owns the repository migration entry points. The graph
dispatches the `migrate_docs` and `scaffold_docs` delegates by name; the
canonical scripts live here, and the copies under
`doc-driven-dev-graph/scripts/` are compatibility entry points that run the
same implementation.

```bash
node scripts/scaffold_docs.js --cwd <repo>
node scripts/migrate_docs.js --cwd <repo> --from <dir> [--split-h1] [--apply] [--json]
node scripts/migrate_ids.js --cwd <repo> [--apply] [--keep-filenames] [--allow-dirty] [--extra-root <dir>]... [--json]
node scripts/promote_index.js --cwd <repo> [--dir <path>] [--apply] [--json]
```

`scaffold_docs` is the one immediate-create entry point; the rest are
preview-first:

- `scaffold_docs` creates the canonical *durable* docs tree without
  overwriting existing files, writing each directory's contract index —
  the shared managed format for shared-suite dirs, the owner format for
  `docs/adr` — on first run. Execution-bound and migration-owned
  directories are never scaffolded. Its write side effects are bootstrap,
  not repair, so it has no preview phase.
- `migrate_docs` plans imports into canonical docs; `--apply` writes. A
  recognized `type:` in front matter is a typed route — `type: adr` still
  migrates into `docs/adr` under the declared `adr-doc` mutator row — while
  a declared non-durable `type:` (`plan`, `task`, `test-spec`, `impl`,
  `exp`) is migration debt: the source is skipped outright, never
  re-routed into the durable tree. A route reached only by content
  patterns never writes into an owner dir: sources whose text guesses
  `docs/adr`,
  `docs/impl/ir`, or `docs/impl/exp` are skipped as
  `unsupported-owner-route` in plan and apply alike. Apply re-checks every
  canonical target dir for containment — a target that escapes the
  checkout or resolves through a link is a hard failure, never a write
  through the link — and the scaffold bootstrap it triggers gates each
  directory creation and index write on the same realpath check.
  Materializing owner indexes (`docs/adr`, `docs/impl/*`) stays with the
  owner writers inside migration tooling; apply regenerates shared-suite
  managed indexes only.
- `migrate_ids` discovers, maps, and preflights before rewriting legacy
  `TYPE-NNNN` ids and numbered filenames. Any preflight blocker stops the
  run before mutation — `ok: false` with `failureStage: "preflight"` means
  zero writes. `apply` rewrites references, renames files, regenerates each
  touched index through its owning writer (the shared managed-index writer,
  the ADR writer for `docs/adr`, the impl safe sync library — called
  directly since the `sync_impl_index` CLI was removed — for
  `docs/impl/ir`/`docs/impl/exp`), then revalidates the repository with
  `doc-status` audits (duplicate ids, unresolved relations, broken links,
  index consistency). Each index reports `regenerated`, `skipped`, or
  `blocked`, with an optional `reason` on skipped/blocked entries; a
  `blocked` index fails the run like a validation error. `ok: false` with
  `failureStage: "validation"` means the mutations are on disk and not
  rolled back — revert with Git.
  Reference rewriting covers every active document that can carry artifact
  references: `docs/`, canonical dirs, root-level Markdown (`AGENTS.md`,
  `README.md`, ...), distributed agent docs (`.apm/`, `packages/*/.apm/`),
  plus any `--extra-root` directory. `EXP-NNNN` experiment references rewrite
  to the canonical `.jsonl` path, and every legacy token that cannot be
  remapped blocks the run as `unresolved-legacy-reference`.
- `promote_index` previews and applies the adoption of unedited legacy
  scaffold READMEs in `docs/adr`, `docs/impl/ir`, and `docs/impl/exp`.
  Eligibility is byte-level: the file must match the exact index the old
  scaffold wrote, and the rewrite is delegated to the owning index writer.
  Hand-curated or modified files are reported as `rejected` and never
  touched.

## Read-Write Boundary

- `doc-status` (`list` / `lint` / `audit` / `health`) never modifies files.
- `doc-maintenance` is the shared entrypoint for rewriting managed index
  content, normalizing link paths, and running document migrations — always
  through an explicit apply: `apply` for whitelisted repairs, `index apply`
  for managed index materialization.
- Owner-local explicit writers remain for their own durable directories:
  `update_index.js` (adr-doc) for `docs/adr`. `sync_impl_index.js`
  (impl-doc) was removed under Registry 3 — impl indexes
  are migration-owned and reconcile only inside `migrate_ids`.
- Migration is planned and applied through the same preview-first contract
  but is never performed implicitly by a repair command.

## Resources

- `scripts/doc_maintenance.js`: plan/apply entry point for safe repairs and
  managed index regeneration; `index plan|apply` is the explicit managed
  index materialization entrypoint across owners; `migrate plan|apply|recovery`
  is the journaled v2→v3 migration surface behind the shared preflight gate —
  `migrate plan` emits the read-only legacy inventory and dry-run plan,
  `migrate apply` runs the staged/journaled engine, and `migrate recovery`
  inspects, resumes, or rolls back an in-flight journal.
- `scripts/migrate_docs.js`, `scripts/migrate_ids.js`,
  `scripts/scaffold_docs.js`, `scripts/promote_index.js`: migration and
  bootstrap entry points owned by this skill (the first three are also
  reachable through the compatibility scripts under
  `doc-driven-dev-graph/scripts/`).
