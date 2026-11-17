# Knowledge Conventions

These conventions define how `knowledge-doc` creates, audits, and indexes
durable knowledge documents under Document Registry 3.

A knowledge document is a durable record of understanding: a codebase fact,
an architecture note, an operational runbook, or a lesson learned. It is
canonical Git-Markdown — not an execution artifact and not derived output.

## Directory

Canonical directory: `docs/knowledge/`. Unlike older suites, knowledge
declares no alias directories — the single canonical spelling keeps routing
and ownership unambiguous.

## Filenames

`new_knowledge.js` generates `<slugified-title>.md` from `--title`, or an
explicit `--name`. Filenames are lower-kebab-case.

## Front Matter

```yaml
---
id: "KNOW-<22-char base62>"
type: "knowledge"
status: "draft"
lifecycle: "draft"
knowledge_kind: "codebase"
title: "…"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  informs: []
  explains: []
  supersedes: []
---
```

### Required fields

- `id` — `KNOW-` prefix plus the shared 22-character Base62 artifact id.
- `type` — always `knowledge`.
- `knowledge_kind` — top-level field classifying the record:
  | Value | Meaning |
  | --- | --- |
  | `codebase` | How the code is structured or behaves today. |
  | `architecture` | Why the system is shaped the way it is. |
  | `operation` | How to run, deploy, or operate a process. |
  | `lesson` | What experience taught that future work should reuse. |

### Status vs lifecycle

`status` is the type-specific workflow state; `lifecycle` is the registry's
durability axis (`draft` → `current` → `superseded`/`retired`). New documents
default to `lifecycle: "draft"`. Unknown lifecycle values are invalid — they
are never coerced to `current`.

| Status | Meaning |
| --- | --- |
| `draft` | Recorded but unverified. |
| `confirmed` | Reviewed and accepted as accurate. |
| `archived` | No longer maintained; kept for reference (settled). |
| `superseded` | Replaced by a newer knowledge document (settled). |

## Relations

- `relations.source` — where the knowledge came from (documents, URLs,
  conversations); provenance, not Knowledge Relations vocabulary.
- `relations.informs` — durable documents this knowledge affects.
- `relations.explains` — durable documents this knowledge clarifies.
- `relations.supersedes` — the knowledge document this one replaces.

## Index

`docs/knowledge/README.md` is a generated, derived index
(`<!-- doc-suite:generated-index -->`). Never hand-maintain its table;
materialize explicitly:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
