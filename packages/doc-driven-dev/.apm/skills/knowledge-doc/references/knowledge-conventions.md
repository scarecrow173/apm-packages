# Knowledge Conventions

These conventions define how `knowledge-doc` creates, audits, and indexes
durable knowledge documents under Document Registry 3.

A knowledge document is a durable record of understanding: a codebase fact,
an architecture note, an operational runbook, or a lesson learned. It is
canonical Git-Markdown — not an execution artifact and not derived output.

The *extraction* half of the contract — when implementation findings become
knowledge at all, and the assess → decide → apply consolidation flow — is
`references/knowledge-extraction.md`; this file is the format contract.

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
| `confirmed` | Reviewed and accepted as accurate — requires recorded provenance (`--from` at creation; an unverified guess is never saved as certain). |
| `archived` | No longer maintained; kept for reference (settled). |
| `superseded` | Replaced by a newer knowledge document (settled). |

## Relations

- `relations.source` — where the knowledge came from (documents, URLs,
  conversations); provenance, not Knowledge Relations vocabulary.
- `relations.informs` — durable documents this knowledge affects.
- `relations.explains` — durable documents this knowledge clarifies.
- `relations.supersedes` — the knowledge document this one replaces
  (`new_knowledge.js --supersedes` and `consolidate_knowledge.js` validate
  the target resolves to a knowledge document).

## Consolidation CLI

`scripts/consolidate_knowledge.js` is the consolidation entrypoint — the
decision contract of `knowledge-extraction.md` enforced deterministically:

```bash
# Read-only screening: candidates, conflicts, and the gate.
node scripts/consolidate_knowledge.js assess --title "…" [--kind codebase] [--keyword …]

# Explicit decision — exactly one of:
node scripts/consolidate_knowledge.js apply --decision none
node scripts/consolidate_knowledge.js apply --decision route --to spec|design|adr|verification|discovery|idea|brainstorm
node scripts/consolidate_knowledge.js apply --decision integrate --into <knowledge-doc> --from <src>… --basis <evidence> [--status …] [--informs <doc>]… [--explains <doc>]…
node scripts/consolidate_knowledge.js apply --decision create --title "…" --kind <kind> --from <src>… --basis <evidence> [--acknowledge <id|path>]…
```

- `assess` never writes; `route` and `none` never write.
- `integrate` mutates knowledge documents only — a spec/design/ADR target
  is refused and routed to its owning skill instead.
- `create` refuses while `assess` reports unacknowledged conflicts; each
  conflict must be passed via `--acknowledge` after review.
- `--from` and `--basis` are required on `integrate` and `create`: the
  origin (原典) and evidence basis (根拠) of an extraction are always
  recorded.

## Index

`docs/knowledge/README.md` is a generated, derived index
(`<!-- doc-suite:generated-index -->`). Never hand-maintain its table;
materialize explicitly:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
