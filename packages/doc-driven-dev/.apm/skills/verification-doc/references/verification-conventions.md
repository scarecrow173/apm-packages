# Verification Design Conventions

These conventions define how `verification-doc` creates, audits, and indexes
durable Verification Design documents under Document Registry 3.

A Verification Design document records verification *intent*: what must be
checked, which contract or claim it protects, and why the check exists. It
replaces the legacy `test-spec` format (migration-only under Registry 3).

## Directory

Canonical directory: `docs/verification/`. No alias directories are declared —
the single canonical spelling keeps routing and ownership unambiguous.

## Filenames

`new_verification.js` generates `<slugified-title>.md` from `--title`, or an
explicit `--name`. Filenames are lower-kebab-case.

## Front Matter

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "…"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  supersedes: []
---
```

### Required fields

- `id` — `VD-` prefix plus the shared 22-character Base62 artifact id.
- `type` — always `verification`.

### Status vs lifecycle

`status` is the type-specific workflow state; `lifecycle` is the registry's
durability axis (`draft` → `current` → `superseded`/`retired`). New documents
default to `lifecycle: "draft"`. Unknown lifecycle values are invalid — they
are never coerced to `current`.

| Status | Meaning |
| --- | --- |
| `draft` | Verification intent being captured. |
| `proposed` | Design written; awaiting review. |
| `approved` | Reviewed and accepted as the verification contract. |
| `deprecated` | Check no longer needed (settled). |
| `superseded` | Replaced by a newer Verification Design (settled). |

## Relations

- `relations.source` — the documents, issues, or evidence that motivated this
  verification design.
- `relations.supersedes` — the Verification Design document this one replaces.

Check→Claim relations (`checks[].target`) are derived from the Check contract
defined by follow-up work, and Evidence `supported-by` links come from the
Evidence Store — neither is a stored relation field here.

## Index

`docs/verification/README.md` is a generated, derived index
(`<!-- doc-suite:generated-index -->`). Never hand-maintain its table;
materialize explicitly:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
