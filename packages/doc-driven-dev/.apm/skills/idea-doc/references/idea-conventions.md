# Idea Conventions

These conventions define how `idea-doc` creates, audits, indexes, and routes
idea documents.

An idea document records an early, unformalized thought before it is ready
for exploration or specification. It is the lightest document type in the
lifecycle. Write one idea per file; keep content brief.

## Directory

Use `docs/ideas/` by default. This keeps ideas visible and near other project
documentation.

Detection order used by scripts:

1. `docs/ideas/`

Do not move existing files just to match this convention. Use `--dir` only
when the repository has an explicit convention that differs.

## Filenames

Default filename pattern:

```text
title-with-dashes.md
```

Rules:

- Filenames are slug-only: lowercase ASCII words separated by dashes.
- Prefer a short noun phrase that names the idea topic.
- Avoid vague names such as `idea.md` or `notes.md`.
- Examples: `support-offline-mode-for-mobile.md`,
  `introduce-event-sourcing.md`.

Document identity lives in the front matter `id`, not in the filename or its
sort position. Existing `NNNN-<slug>.md` filenames remain valid, but new
documents always use slug-only names.

## Required Front Matter

Idea documents use the shared document front matter:

```yaml
---
id: "IDEA-4MnBvCxZaSdFgHjKlPoIuY"
type: "idea"
status: "draft"
title: "Support offline mode for mobile"
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
| `id` | Yes | Stable document identifier in `IDEA-<22-char Base62>` form (UUIDv7-derived; legacy `IDEA-NNNN` remains valid). |
| `type` | Yes | Must be `idea`. |
| `status` | Yes | Current lifecycle state. |
| `title` | Yes | Human-readable title matching the idea topic. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People accountable for following up on the idea. |
| `relations` | Yes | Meaningful links to sources and related documents. |

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `draft` | Just captured; next action not yet decided. |
| `exploring` | Actively thinking about it; may gather initial evidence. |
| `promoted` | Handed off to discovery-doc or spec-doc; no further action here. |
| `parked` | Deferred for later; preserved but not active. |
| `archived` | Evaluated and not pursued; kept for reference. |
| `superseded` | Replaced by a newer idea document. |

Set `promoted` only after creating the downstream document and linking it
in `relations.derived-by`.

## Relations

| Field | Meaning |
| --- | --- |
| `source` | External link, issue, conversation, or observation that prompted the idea. |
| `derived-by` | Downstream discovery-doc or spec-doc created from this idea. |
| `supersedes` | Older idea replaced by this one. |
| `superseded-by` | Newer idea that replaces this one. |
| `related` | Contextual docs without directional dependency. |

Keep relations minimal. Idea documents do not need full relation coverage;
use `source` and `derived-by` when applicable.

## Required Content

Every idea document should answer:

1. What is the core idea in one or two sentences?
2. What problem, pain, or opportunity does it address?
3. Who benefits and how?
4. What open questions remain before this can be formalized?
5. What is the immediate next action?

Keep it short. A well-written idea document fits on one screen. If it grows
longer, the idea is ready for `discovery-doc`.

## One Idea per File

Each idea document records a single, distinct idea. If a conversation or
meeting produces multiple ideas, create a separate file for each. Do not
bundle unrelated ideas into one document.

## Promotion Rule

When an idea is ready for deeper exploration or formalization:

1. Create the downstream document (`discovery-doc` or `spec-doc`).
2. Link it in `relations.derived-by`.
3. Set status to `promoted`.
4. Preserve the idea document as the upstream audit trail.

Do not move idea content into the spec or discovery document. Ideas serve
as lightweight pre-flight records; the formal work belongs in the downstream
document type.

## Index

Use `README.md` as the default idea index.

List idea documents as a Markdown table, in filename order, with four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| IDEA-4MnBvCxZaSdFgHjKlPoIuY | Support offline mode for mobile | promoted | [support-offline-mode-for-mobile.md](support-offline-mode-for-mobile.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`. Take `ID`,
  `Title`, and `Status` from the document front matter; the `File` column is a
  relative link within the index directory. Write `—` when a value is missing.
- Sort rows by filename in ascending order.
- Update the index whenever a new idea document is added.

## Subdirectory Grouping

For large repositories, ideas may be split into subdirectories by product area
or team:

```text
docs/ideas/
  mobile/
    support-offline-mode.md
  platform/
    introduce-event-sourcing.md
```

Use this pattern only when a flat directory is hard to scan.
