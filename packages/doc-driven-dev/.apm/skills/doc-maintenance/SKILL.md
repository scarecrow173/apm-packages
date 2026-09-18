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

## Idempotency

The same repair applied twice is a no-op the second time: index regeneration
produces deterministic output for the same document set, and applied link
normalizations no longer appear as findings.

## Migration Commands

`doc-maintenance` also owns the repository migration entry points. The graph
dispatches the `migrate_docs` and `scaffold_docs` delegates by name; the
canonical scripts live here, and the copies under
`doc-driven-dev-graph/scripts/` are compatibility entry points that run the
same implementation.

```bash
node scripts/scaffold_docs.js --cwd <repo>
node scripts/migrate_docs.js --cwd <repo> --from <dir> [--split-h1] [--apply] [--json]
node scripts/migrate_ids.js --cwd <repo> [--apply] [--keep-filenames] [--allow-dirty] [--json]
```

All three follow the same preview-first contract:

- `scaffold_docs` creates the canonical docs tree without overwriting existing
  files.
- `migrate_docs` plans imports into canonical docs; `--apply` writes.
- `migrate_ids` discovers, maps, and preflights before rewriting legacy
  `TYPE-NNNN` ids and numbered filenames; any blocker stops the run before
  mutation, and `apply` revalidates the repository with `doc-status` audits
  (duplicate ids, unresolved relations, broken links, index consistency).

## Read-Write Boundary

- `doc-status` (`list` / `lint` / `audit` / `health`) never modifies files.
- `doc-maintenance` is the only skill that may rewrite managed index content,
  normalize link paths, or run document migrations, and only through the
  explicit `apply` command.
- Migration is planned and applied through the same preview-first contract
  but is never performed implicitly by a repair command.

## Resources

- `scripts/doc_maintenance.js`: plan/apply entry point for safe repairs and
  managed index regeneration.
- `scripts/migrate_docs.js`, `scripts/migrate_ids.js`,
  `scripts/scaffold_docs.js`: migration and bootstrap entry points owned by
  this skill (also reachable through the compatibility scripts under
  `doc-driven-dev-graph/scripts/`).
