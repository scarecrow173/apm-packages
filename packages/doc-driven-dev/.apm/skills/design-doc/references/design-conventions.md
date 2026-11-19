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
- detailed design files using slug-only names (`<slug>.md`)
- `README.md` index

## Filenames

Default detailed design filename pattern:

```text
title-with-dashes.md
```

Rules:

- Filenames are slug-only: lowercase ASCII words separated by dashes.
- `overview.md` is reserved and never treated as a detailed design file.
- Existing `NNNN-<slug>.md` filenames remain valid, but new documents always
  use slug-only names. Run `migrate_ids.js` under `doc-maintenance/scripts` to upgrade existing files.

### Identity

- Each detailed design doc gets an opaque `DESIGN-<22-char Base62>` id at
  creation time. Ids are UUIDv7-derived and do not depend on filenames,
  directory contents, or creation order.
- `overview.md` (`DESIGN-OVERVIEW`) is excluded from artifact-id generation.

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
  rewriting history, and should re-point or close dependents (plans, tasks)
  that still target the replaced baseline.

## Subdirectory Grouping

### Category subdirectories

For large repositories, design docs may be grouped by area:

```text
docs/designs/
  payments/
    design-checkout-orchestration.md
  identity/
    design-login-sessions.md
```

Filenames need to be unique only within their directory.

### Feature subdirectories

Subdirectories also work for feature-level grouping, when a single feature
requires multiple related design docs:

```text
docs/designs/
  checkout/
    design-checkout-flow.md
    design-checkout-api.md
```

Use this pattern when the designs are best read together as a set.

## Required Front Matter

Detailed design docs use shared YAML front matter with `type: "design"`.
Required fields: `id`, `type`, `status`, `lifecycle`, `title`, `created`,
`updated`, `owners`, `relations`.

`status` is the type-specific workflow state below. `lifecycle` is the
Registry 3 durability axis (`draft` / `current` / `superseded` / `retired`),
independent of `status`; it drives the active/settled index tiers.

## Status Values

Use these type-specific workflow statuses (distinct from `lifecycle`):

| Status | Meaning |
| --- | --- |
| `draft` | Being designed and reviewed. |
| `approved` | Accepted as implementation input. |
| `superseded` | Replaced by newer design docs. |
| `rejected` | Rejected and retained only for traceability. |

## Gate Rule for plan-doc

Under Document Registry 3 `plan` is execution-bound — `new_plan.js` was
removed (Issue #249) so no creator ever reaches this gate; the gate
remains the contract for Execution Store planning flows. It requires:

- `docs/designs/overview.md` exists.
- At least one non-overview design document has exact front matter
  `status: "approved"`.

If either condition fails, `plan-doc` must fail with:

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## Relations

Under Knowledge Relations v1 a design stores only its declared forward
fields plus `relations.source` provenance:

- `relations.realizes` (→ spec) — the spec this design realizes; what
  `new_design --from` seeds.
- `relations.supersedes` (→ design) — the older design it replaces.
- `relations.source` — provenance (external links, issues, conversations).
- `relations.changes` — the provenance change-set, not a document link.

Inverse names (`realized-by`, `superseded-by`) are derived projections —
never stored. `derives-from`, `related`, `references`, `defers`,
`deferred-by`, and the other pre-v3 keys are migration-domain input only:
`doc-status` reports them as `legacy-relation-field` findings and they are
never walked as current graph edges.

## Index

Use `README.md` as the default design index. List both `overview.md` and the
detailed design documents as a Markdown table, in filename order, with these
four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| DESIGN-OVERVIEW | System Design Overview | draft | [overview.md](overview.md) |
| DESIGN-2XyZaBcDeFgHiJkLmNoPqR | Design checkout orchestration | approved | [design-checkout-orchestration.md](design-checkout-orchestration.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`. Take `ID`,
  `Title`, and `Status` from the document front matter; the `File` column is a
  relative link within the index directory. Write `—` when a value is missing.
- List `overview.md` first in the in-flight table, then detailed design docs
  sorted by filename in ascending order. Designs whose `lifecycle` is
  settled (`superseded` or `retired`) move to a `## Settled` table below
  it, also filename-ordered. Settled rows stay linked — the tier
  de-emphasizes history without hiding it.
- Update the index whenever a document is added or its `status` changes —
  materialization is explicit via `doc_maintenance.js index plan|apply`
  (creators never write indexes); `doc_status lint` reports the drift
  (`index-metadata-mismatch`, `index-ordering`) until it does.
- A managed index keeps exactly one in-flight table plus the optional
  `## Settled` tier — `doc_status lint` flags a second table in a tier or
  any table under another `##` heading as `index-unparseable`. As entries
  grow, split documents across owned directories, each with its own
  managed index, rather than adding headed tables inside one index.
- Generated indexes embed an `<!-- doc-suite:generated-index -->` marker.
  Index materialization only writes a `README.md` that contains this marker
  (or one that does not yet exist). A hand-curated index (no marker) is
  preserved — `doc_maintenance.js index apply` reports it as `rejected`
  rather than clobbering it. The creator flags `--no-index`/`--force-index`
  are deprecated and have no effect; `doc_maintenance.js apply
  --force-index` remains the repair-path override for hand-curated indexes.
