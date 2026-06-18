# Discovery Conventions

These conventions define how `discovery-doc` creates, audits, indexes, and
routes discovery documents.

A discovery document records the intermediate output of a briefing or
exploration phase: exploration goals, key issues, alternative comparisons,
tentative conclusions, open questions, and promotion candidates. It is the
upstream source that spec-doc and adr-doc derive from. It is not an approved
or implemented document.

## Directory

Use `docs/discovery/` by default. This keeps discovery documents near ADRs,
specs, and other project documentation, while keeping them visually distinct
from finalized artifacts.

Do not move existing documents just to match this convention. If a repository
already has a discovery or brainstorm directory, keep it.

Detection order used by scripts:

1. `docs/discovery/`

Use `--dir` only when the repository has an explicit convention that differs
from the detection list.

## Filenames

Default filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is a zero-padded sequential number local to the discovery directory.
- The title slug is lowercase ASCII with words separated by dashes.
- Prefer a short noun phrase that names the exploration topic.
- Avoid vague names such as `research.md` or `notes.md`.
- Examples: `0001-explore-auth-strategy-options.md`,
  `0002-evaluate-event-bus-alternatives.md`.

If the repository already uses slug-only filenames, follow that convention.

## Required Front Matter

Discovery documents use the shared document front matter:

```yaml
---
id: "DISC-0001"
type: "discovery"
status: "draft"
title: "Explore auth strategy options"
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
| `id` | Yes | Stable document identifier, always `DISC-NNNN`. |
| `type` | Yes | Must be `discovery`. |
| `status` | Yes | Current lifecycle state. |
| `title` | Yes | Human-readable title matching the exploration topic. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People or groups accountable for the exploration. |
| `relations` | Yes | Meaningful links to sources and related documents. |

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `draft` | Exploration in progress; conclusions not yet stable. |
| `active` | Exploration is underway; being actively updated. |
| `resolved` | Conclusions promoted to spec-doc or adr-doc; no further work needed. |
| `archived` | Exploration halted without promotion; preserved for reference. |
| `superseded` | Replaced by a newer discovery document. |

Discovery documents are not approved or implemented. Set `resolved` only
after all promotion candidates are addressed and linked in `relations.derived-by`.

## Relations

Use relation fields for meaning, not document type.

| Field | Meaning |
| --- | --- |
| `source` | External primary evidence: research reports, issue links, user interviews, benchmarks. |
| `derives-from` | Broader context or upstream artifacts that prompted this exploration. |
| `derived-by` | Downstream specs or ADRs written from the conclusions of this discovery. |
| `supersedes` | Older discovery documents replaced by this one. |
| `superseded-by` | Newer discovery document that replaces this one. |
| `related` | Contextual docs without directional dependency. |
| `references` | Supplementary material consulted but not a primary source. |
| `defers` | Future explorations intentionally deferred from this document. |
| `deferred-by` | Documents that deferred this exploration to a later phase. |

Internal documents use relative paths. External sources use URLs. Always link
both ways when possible:

- Discovery that generates a spec: set `relations.derived-by` to the spec;
  set `relations.derives-from` in the spec to point back here.
- Discovery superseded by another: set `relations.superseded-by` in the old
  document and `relations.supersedes` in the new one.

## Required Content

Every discovery document should answer:

1. What exploration goal or open question does this document address?
2. What constraints (technical, product, policy, timeline) apply?
3. What alternatives were considered, and what are their trade-offs?
4. What tentative conclusions or hypotheses emerged?
5. What open questions remain unresolved?
6. Which downstream documents (spec, ADR, design) should be created?
7. What research evidence or external sources support these conclusions?

Keep conclusions tentative and clearly labeled as hypotheses until they are
promoted to a spec or ADR.

## Mutability

Discovery documents are working notes until promoted.

- `draft` and `active` documents may be edited freely.
- `resolved` documents should be treated as historical evidence. Prefer dated
  notes or a new discovery document over rewriting a resolved record.
- `archived` documents preserve the exploration context; do not overwrite them.
- Status, owner, and relation updates are acceptable in-place edits at any status.

## One Topic per File Rule

Each discovery document should address a single exploration topic. If briefing
produces findings on multiple independent questions, create a separate discovery
document for each. Large single-topic explorations may be split by approach or
decision axis, but the split should map to distinct spec or ADR candidates.

## Promotion Rule

Once the conclusions of a discovery document are captured in a spec or ADR:

1. Link the downstream document in `relations.derived-by`.
2. Set status to `resolved`.
3. Preserve the discovery document as the audit trail.

Do not move a discovery document to `docs/specs/` or `docs/adr/`. The final
decisions belong in their own document type with their own lifecycle status.
Research evidence stays in `docs/research/` (if a separate research directory
is used) and is linked via `relations.source`.

## Index

Use `README.md` as the default discovery index.

List discovery documents as a Markdown table, in filename order, with four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| DISC-0001 | Explore auth strategy options | resolved | [0001-explore-auth-strategy-options.md](0001-explore-auth-strategy-options.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`. Take `ID`,
  `Title`, and `Status` from the document front matter; the `File` column is a
  relative link within the index directory. Write `—` when a value is missing.
- Sort rows by filename in ascending order.
- Update the index whenever a new discovery document is added.

## Subdirectory Grouping

For large repositories, discovery documents may be split by product area or
investigation domain:

```text
docs/discovery/
  auth/
    0001-explore-auth-strategy-options.md
  infrastructure/
    0001-evaluate-event-bus-alternatives.md
```

Use this pattern only when a flat directory is hard to scan. Keep numbering
local to each subdirectory.
