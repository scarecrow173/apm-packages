# Verification Design Conventions

These conventions define how `verification-doc` creates, audits, and indexes
durable Verification Design documents under Document Registry 3.

A Verification Design document records verification *intent*: what must be
checked, which claim it protects, how the check is performed, and why the
check exists. It replaces the legacy `test-spec` format (migration-only
under Registry 3).

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
checks:
  - id: "CHK-01"
    target: "SPEC-<id>::R-01"
    method: "unit"
    implementation: "…"
    preconditions: []
    passCriteria:
      kind: "unit"
      expect: "…"
    limitations: []
    required: true
checkHighWater: 1
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

## Check contract (`checks:`)

The `checks:` front-matter array is the sole Check→Claim authority. Each
entry is a `VerificationCheckV1` — all eight fields are required:

| Field | Contract |
| --- | --- |
| `id` | `CHK-<digits>` — stable and unique inside the document. The qualified check reference `VD-<id>::CHK-NN` is what task `checks` entries and Evidence Records cite. |
| `target` | Qualified Claim reference `<document-id>::<KEY>` (e.g. `SPEC-<id>::R-01`). The claim must exist — unknown Claim IDs are findings, and writers refuse them. |
| `method` | One of: `unit`, `integration`, `e2e`, `property`, `static`, `model-checking`, `formal-proof`, `runtime-monitoring`, `manual-review`. |
| `implementation` | How the check is realized — test name, proof script, monitor, review step. |
| `preconditions` | Conditions under which the check applies. `required: true` checks must declare at least one. |
| `passCriteria` | Typed discriminated union `{ kind: <method>, <criterion>: "…" }`. `kind` must equal `method`. |
| `limitations` | Known limits of the check; may be empty but must be present. |
| `required` | `true` marks a required gate for Evidence Assessment; `false` is advisory. |

`passCriteria` is method-typed — `kind` is the discriminant and must equal
`method`, so a criteria payload for one method is never read as another.
Each method carries one required criterion field:

| Method | Required `passCriteria` field |
| --- | --- |
| `unit` | `expect` |
| `integration` | `expect` |
| `e2e` | `expect` |
| `property` | `invariant` |
| `static` | `rule` |
| `model-checking` | `property` |
| `formal-proof` | `theorem` |
| `runtime-monitoring` | `signal` |
| `manual-review` | `checklistItem` |

Sibling to `checks:` is `checkHighWater` — the greatest `CHK-<digits>`
ordinal ever declared or allocated in the document. The scripts write it
whenever the check set changes: it is the durable high-water mark that
keeps removed check ids from ever being reissued (`--remove-check` never
frees an id, so tail-delete then add mints a fresh `CHK-NN`). Treat it as
script-owned — hand-editing it down reopens id reissue.

Body anchors of the form `<!-- check:CHK-NN -->` (or the self-qualified
`<!-- check:VD-<id>::CHK-NN -->`) bind a check's id to its prose
description — optional, but when present they must name a check the front
matter declares. Anchors outside verification documents are invalid.

Lint (`doc_status lint --type verification`) reports: malformed `checks`
data, missing fields, invalid/duplicate check ids, invalid targets or
methods, `passCriteria`/`method` contradiction, required checks without
preconditions, unknown Claim IDs, and invalid, duplicate, misplaced, or
unresolved body anchors.

## Relations

- `relations.source` — the documents, issues, or evidence that motivated this
  verification design.
- `relations.supersedes` — the Verification Design document this one replaces.

Check→Claim relations (`checks` / `checked-by`) are *derived* from
`checks[].target` — the Knowledge Graph projects them; they are never stored
in `relations`. Evidence `supported-by` links come from the Evidence Store —
also never stored here.

## Reuse and update

An existing design that covers the claim is updated in place — never
duplicated:

```bash
node scripts/resolve_verification.js --for-claim SPEC-<id>::R-01
node scripts/update_verification.js --doc VD-<id> --check '<json>'
```

`--check` upserts by check id (idless payloads allocate the next `CHK-NN`),
`--remove-check CHK-NN` deletes, and `--title`/`--status`/`--lifecycle`/
`--from`/`--supersedes` update fields. Edits keep check ids stable — only
the check's design revision changes.

## Index

`docs/verification/README.md` is a generated, derived index
(`<!-- doc-suite:generated-index -->`). Never hand-maintain its table;
materialize explicitly:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
