# Spec Conventions

These conventions define how `spec-doc` creates, audits, indexes, and routes
specification documents.

A spec is the source document that defines what should be built and why it is
needed. In this package, specs cover both product intent and
implementation-facing behavior. Do not split those concerns into a separate
requirements document.

## Directory

If a repository already has a spec directory, keep it. Do not move existing
specs just to match this package's defaults.

When no spec directory exists, use `docs/specs/` by default. This keeps specs
near ADRs, plans, tasks, and other project documentation.

Detection order used by scripts:

1. `docs/specs/`
2. `docs/spec/`
3. `specs/`
4. `spec/`

When multiple candidates exist, prefer the directory with numbered spec files
and an index file. Use `--dir` only when the repository has an explicit
convention that is not in the detection list.

## Filenames

Default filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is a zero-padded sequential number local to the spec directory.
- The title slug is lowercase ASCII with words separated by dashes.
- Prefer a short verb or noun phrase that names the capability, workflow, or
  externally visible behavior.
- Avoid vague names such as `feature.md`, `updates.md`, or `misc.md`.
- Examples: `0001-define-checkout-flow.md`,
  `0002-add-team-invitations.md`.

If a repository already uses slug-only filenames, follow that convention instead
of introducing numbering.

## Required Front Matter

Specs use the shared document front matter:

```yaml
---
id: "SPEC-0001"
type: "spec"
status: "draft"
title: "Define checkout flow"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
  defers: []
  deferred-by: []
---
```

Required fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable document identifier, usually `SPEC-NNNN`. |
| `type` | Yes | Must be `spec`. |
| `status` | Yes | Current lifecycle state. |
| `title` | Yes | Human-readable title matching the document intent. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People or groups accountable for the spec. |
| `relations` | Yes | Meaningful links to sources and related documents. |

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `draft` | Being written or refined. |
| `proposed` | Ready for review but not approved. |
| `approved` | Accepted as the basis for implementation planning. |
| `implemented` | Implemented and verified. |
| `superseded` | Replaced by a newer spec. |
| `rejected` | Explicitly not pursued. |

Keep `status` focused on lifecycle state. Use `relations.superseded-by` to
point to a replacing spec and `relations.implemented-by` to point to plans or
tasks that implement it.

## Relations

Use relation fields for meaning, not document type.

| Field | Meaning |
| --- | --- |
| `source` | External primary evidence, requirements, issue links, or user-provided source material. |
| `references` | Supplementary context that informed the spec but is not a source of truth. |
| `defers` | Future work intentionally deferred from this document, pointing to a draft spec/design. |
| `deferred-by` | Documents that deferred this draft future work to a later phase. |
| `derives-from` | Brainstorming, idea-refine notes, ADRs, or upstream docs that produced the spec. |
| `derived-by` | Plans, tasks, or narrower specs derived from this spec. |
| `refines` | Broader specs or ADRs narrowed by this spec. |
| `refined-by` | Follow-up specs that narrow this spec. |
| `depends-on` | Documents that must remain valid for this spec to hold. |
| `blocks` | Documents or tasks blocked until this spec is approved. |
| `supersedes` | Older specs replaced by this spec. |
| `superseded-by` | Newer specs that replace this spec. |
| `related` | Contextual docs without directional dependency. |
| `implemented-by` | Plans or tasks that implement this spec. |
| `verifies` | Documents or checks this spec verifies, when applicable. |
| `verified-by` | Test plans, review notes, or tasks that verify this spec. |

Internal documents use relative paths. External sources use URLs. For
replacement decisions, link both ways when possible:

- New spec: `relations.supersedes` points to the old spec.
- Old spec: `relations.superseded-by` points to the new spec.

## Required Content

Every spec should answer:

1. What should be built?
2. Why is it needed now?
3. Who benefits?
4. What is in scope and out of scope?
5. What behavior, interface, workflow, or document outcome is required?
6. What acceptance criteria prove the work is correct?
7. What sources, ADRs, or discovery notes informed the spec?

Acceptance criteria must be checkable. Avoid criteria such as "works well" or
"is intuitive" unless they are backed by observable behavior.

## Mutability

Specs are planning inputs, not immutable decision records.

- `draft` and `proposed` specs may be edited freely.
- `approved` specs may receive clarifications that do not change scope.
- Substantive scope, behavior, or acceptance changes after approval should
  create a new spec or explicitly supersede the old one.
- `implemented` specs should be treated as historical evidence. Prefer dated
  notes or superseding specs over rewriting implemented intent.
- Status, owner, and relation updates are acceptable in-place edits.
- Audit reports must not invent missing requirements, sources, or acceptance
  criteria.

## Index

Use `README.md` as the default spec index. If a repository already uses
`index.md`, keep it.

The index should list specs in filename order and include enough metadata for a
reader to scan title, status, and owner quickly.

## Categories

### Area grouping

For large repositories, specs may be split into subdirectories by product area,
platform area, documentation area, or team:

```text
docs/specs/
  product/
    0001-team-invitations.md
  platform/
    0001-api-rate-limits.md
  docs/
    0001-document-lifecycle.md
```

Numbers are local to each category. Document the categorization scheme in the
index before the structure grows. Use area grouping only when a flat directory
is becoming hard to scan.

### Feature grouping

Subdirectories also work for feature-level grouping, when a single feature
requires multiple related specs:

```text
docs/specs/
  checkout/
    0001-define-checkout-flow.md
    0002-checkout-api-contract.md
    0003-checkout-edge-cases.md
```

Use this pattern when the specs are best read together as a set. Keep numbering
local to the feature directory.
