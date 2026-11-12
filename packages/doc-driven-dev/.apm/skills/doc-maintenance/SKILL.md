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
- Options: `--type`, `--dir`, `--force-index`, `--json`.

`index` is the explicit managed-index materialization entrypoint — INDEX
only, across every owner. Unlike `plan`/`apply` it touches nothing outside
managed index content (no link normalization, no source repairs), and it
dispatches each write to the owning writer: shared-4col directories through
the shared renderer/merge, `docs/adr` through the ADR managed writer, and
`docs/impl/ir`/`docs/impl/exp` through the impl-doc safe sync engine (the
same API `sync_impl_index` uses — never the unconditional writers).

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

- `scaffold_docs` creates the canonical docs tree without overwriting existing
  files, writing each directory's contract index — the owner format for
  `docs/adr`, `docs/impl/ir`, `docs/impl/exp` — on first run. Its write side
  effects are bootstrap, not repair, so it has no preview phase.
- `migrate_docs` plans imports into canonical docs; `--apply` writes. A
  recognized `type:` in front matter is a typed route — `type: adr` still
  migrates into `docs/adr` under the declared `adr-doc` mutator row. A route
  reached only by content patterns never writes into an owner dir: sources
  whose text guesses `docs/adr`, `docs/impl/ir`, or `docs/impl/exp` are
  skipped as `unsupported-owner-route` in plan and apply alike. Apply
  re-checks every canonical target dir for containment — a target that
  escapes the checkout or resolves through a link is a hard failure, never
  a write through the link — and the scaffold bootstrap it triggers gates
  each directory creation and index write on the same realpath check.
  Materializing owner indexes (`docs/adr`, `docs/impl/*`) stays with the
  `index` entrypoint and owner writers; apply regenerates shared-suite
  managed indexes only.
- `migrate_ids` discovers, maps, and preflights before rewriting legacy
  `TYPE-NNNN` ids and numbered filenames. Any preflight blocker stops the
  run before mutation — `ok: false` with `failureStage: "preflight"` means
  zero writes. `apply` rewrites references, renames files, regenerates each
  touched index through its owning writer (the shared managed-index writer,
  the ADR writer for `docs/adr`, the impl-doc safe sync engine for
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
- `doc-maintenance` is the only skill that may rewrite managed index content,
  normalize link paths, or run document migrations, and only through an
  explicit apply — `apply` for whitelisted repairs, `index apply` for
  managed index materialization.
- Managed index materialization goes through `index apply` only: each write
  dispatches to the directory's owning writer, and impl indexes are reached
  exclusively through the `sync_impl_index` safe sync API.
- Migration is planned and applied through the same preview-first contract
  but is never performed implicitly by a repair command.

## Resources

- `scripts/doc_maintenance.js`: plan/apply entry point for safe repairs and
  managed index regeneration; `index plan|apply` is the explicit managed
  index materialization entrypoint across owners.
- `scripts/migrate_docs.js`, `scripts/migrate_ids.js`,
  `scripts/scaffold_docs.js`, `scripts/promote_index.js`: migration and
  bootstrap entry points owned by this skill (the first three are also
  reachable through the compatibility scripts under
  `doc-driven-dev-graph/scripts/`).
