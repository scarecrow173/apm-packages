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

## Mutability

- `draft` design docs may be refined freely.
- `approved` design docs should preserve rationale and note updates explicitly.
- Large redesigns should create a superseding design doc instead of silently
  rewriting history.

## Subdirectory Grouping

### Category grouping

For large repositories, design docs may be grouped by area:

```text
docs/designs/
  payments/
    0001-design-checkout-orchestration.md
  identity/
    0001-design-login-sessions.md
```

Keep numbering local to each category when splitting directories.

### Feature grouping

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

`README.md` should list both `overview.md` and detailed design documents.
