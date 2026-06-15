# doc-driven-dev-lifecycle Bootstrap Contract

This document defines the canonical docs tree that `scaffold_docs` creates
before Briefing begins.

## Canonical Tree

- `docs/ideas/README.md`
- `docs/discovery/README.md`
- `docs/specs/README.md`
- `docs/designs/README.md`
- `docs/plans/README.md`
- `docs/tasks/README.md`
- `docs/adr/README.md`
- `docs/impl/ir/README.md`
- `docs/impl/exp/README.md`

## Rules

- Create missing directories and `README.md` files only.
- Preserve any existing files in the target repo.
- Do not create `docs/designs/overview.md`; `design-doc` owns that file.
- Repeated runs must be idempotent.

## Completion

- The canonical directories exist.
- Each canonical directory has a `README.md`.
- Existing files remain untouched.
- `docs/designs/overview.md` is still absent until `design-doc` creates it.
