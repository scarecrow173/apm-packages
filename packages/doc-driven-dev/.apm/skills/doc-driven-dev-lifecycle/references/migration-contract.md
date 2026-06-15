# doc-driven-dev-lifecycle Migration Contract

This document defines how `migrate_docs` brings existing Markdown documentation
into the canonical doc-driven-dev tree.

## Position in the Lifecycle

Migration is an optional Phase -1 for repositories that already have
documentation before adopting doc-driven-dev. Run it before Phase 0
`scaffold_docs`.

## Safety Rules

- Dry-run is the default.
- `--apply` creates converted canonical documents.
- Original source documents are preserved.
- Existing canonical target files are not overwritten.
- Existing canonical directories are skipped by default.
- `docs/designs/overview.md` is still owned by `design-doc`.

## Supported Transformations

- Inventory Markdown files from one or more `--from` directories.
- Classify each document into the canonical docs tree.
- Convert known doc types to canonical front matter.
- Preserve ADR, implementation record, and experiment log content with minimal metadata.
- Split multi-H1 source files when `--split-h1` is passed.

## Completion

- Dry-run report lists every planned source-to-target mapping.
- Apply run creates the reported files.
- Existing source files remain present.
- `doc-status` can audit the resulting canonical docs.
