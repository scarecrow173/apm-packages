# Design Conventions

These conventions define how `design-doc` creates and maintains design artifacts.

## Directory

Use `docs/designs/` by default.

Detection order used by scripts:

1. `docs/designs/`
2. `docs/design/`
3. `designs/`
4. `design/`

The directory must contain:

- `overview.md` (required overall design map)
- numbered detailed design files (`NNNN-<slug>.md`) or existing slug-only style
- `README.md` index

## Filenames

Default detailed design filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is zero-padded and sequential in the design directory.
- Slug uses lowercase ASCII and dashes.
- `overview.md` is reserved and never treated as a detailed design file.

### Numbering source

- In **numbered** directories (`NNNN-<slug>.md` files present), `NNNN` is taken
  from the highest filename prefix in that directory and incremented locally.
- In **slug-only** directories (no `NNNN-` prefixes), scripts derive the next
  sequential `DESIGN-NNNN` id by scanning the front matter `id:` of every design
  doc under `docs/designs/` recursively (including subdirectories), so the global
  id sequence continues even when files use slug names and subdirectory layout.
- `overview.md` (`DESIGN-OVERVIEW`) is excluded from both naming detection and
  numbering.

### Explicit filenames and subdirectory placement

To place a design under a feature subdirectory with a fixed filename, pass
`--dir` and `--name`:

```text
node scripts/new_design.js --title "Graph Visualization" \
  --dir docs/designs/graph-visualization --name design.md
```

`overview.md` and the `README.md` index always stay at the canonical
`docs/designs/` root, even for subdirectory writes.

## Mutability

- `draft` design docs may be refined freely.
- `approved` design docs should preserve rationale and note updates explicitly.
- Large redesigns should create a superseding design doc instead of silently
  rewriting history.

## Subdirectory Grouping

### Category subdirectories

For large repositories, design docs may be grouped by area:

```text
docs/designs/
  payments/
    0001-design-checkout-orchestration.md
  identity/
    0001-design-login-sessions.md
```

Keep numbering local to each category when splitting directories.

### Feature subdirectories

Subdirectories also work for feature-level grouping, when a single feature
requires multiple related design docs:

```text
docs/designs/
  checkout/
    0001-design-checkout-flow.md
    0002-design-checkout-api.md
```

Use this pattern when the designs are best read together as a set. Keep
numbering local to the feature directory.

## Required Front Matter

Detailed design docs use shared YAML front matter with `type: "design"`.

## Status Values

| Status | Meaning |
| --- | --- |
| `draft` | Being designed and reviewed. |
| `approved` | Accepted as implementation input. |
| `superseded` | Replaced by newer design docs. |
| `rejected` | Rejected and retained only for traceability. |

## Gate Rule for plan-doc

`plan-doc` creation requires:

- `docs/designs/overview.md` exists.
- At least one non-overview design document has exact front matter
  `status: "approved"`.

If either condition fails, `plan-doc` must fail with:

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## Relations

- Use `relations.derives-from` for upstream spec/ADR/discovery docs.
- Use `relations.related` for sibling designs.
- Use `relations.references` for supplementary materials.
- Use `relations.defers` for future work intentionally deferred from this design (a draft spec/design); the deferred doc points back with `relations.deferred-by`.

## Index

Use `README.md` as the default design index. List both `overview.md` and the
detailed design documents as a Markdown table, in filename order, with these
four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| DESIGN-OVERVIEW | System Design Overview | draft | [overview.md](overview.md) |
| DESIGN-0001 | Design checkout orchestration | approved | [0001-design-checkout-orchestration.md](0001-design-checkout-orchestration.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`. Take `ID`,
  `Title`, and `Status` from the document front matter; the `File` column is a
  relative link within the index directory. Write `—` when a value is missing.
- List `overview.md` first, then detailed design docs sorted by filename in
  ascending order.
- Whenever a new target file is added, update the index in the same change.
- As entries grow, split the index into multiple headings, one table per
  heading, for readability. Align the split with the subdirectory grouping
  (category or feature) so each heading maps to one group.
- Generated indexes embed an `<!-- doc-suite:generated-index -->` marker.
  Scripts only overwrite a `README.md` that contains this marker (or one that
  does not yet exist). A hand-curated index (no marker) is preserved and the
  script warns instead of clobbering it. Use `--force-index` to overwrite a
  hand-curated index, or `--no-index` to skip index regeneration entirely.
  `--no-index` and `--force-index` cannot be used together.
