# impl-doc Conventions

Under Document Registry 3 `impl` (Implementation Records) and `exp`
(Experiment Logs) are legacy migration-only types: they cannot be created or
linted as durable documents, the `new_impl_record.js` /
`new_experiment_log.js` / `sync_impl_index.js` entrypoints were removed
(Issue #249), and the directories below
are migration-owned scopes. These conventions describe the pre-v3 document
shape that migration tooling reads and the index contract that
`migrate_ids.js` reconciles.

## Directory

Implementation Records live under:

```text
docs/impl/ir/
```

Experiment Logs live under:

```text
docs/impl/exp/
```

If a repository already uses an established equivalent path, prefer that path
via CLI `--dir`.

## Filenames

Default filename patterns:

```text
title-with-dashes.md
title-with-dashes.jsonl
```

Rules:

- Filenames are slug-only: lowercase ASCII words separated by dashes.
- `ir/` and `exp/` names need to be unique only within their own directory.
- Document identity lives in the front matter `id`, not in the filename or its
  sort position. Existing `NNNN-<slug>` filenames remain valid, but new files
  always use slug-only names. Run `migrate_ids.js` under `doc-maintenance/scripts` to upgrade existing files.

## Implementation Record Front Matter

Implementation Records use the existing doc-suite shape plus shared
`relations.changes` and `metadata.experiments`.

Required fields:

- `id`
- `type: "impl"`
- `status`
- `title`
- `created`
- `updated`
- `owners`
- `relations`
- `metadata.experiments.adopted`
- `metadata.experiments.rejected`

Not used in v1:

- `metadata.record-type`
- `metadata.validation`

## Status Values

Allowed Implementation Record statuses:

- `draft`
- `in-progress`
- `completed`
- `blocked`
- `abandoned`
- `superseded`

## Implementation Record Lifecycle

Implementation Records are Markdown documents updated during Phase 5.

- Create or reuse the Implementation Record at task start, before the first
  code change.
- Keep the front matter and body current as implementation proceeds.
- Treat the record as the task's running implementation narrative, not a
  retrospective summary written at the end.

Sections to keep current during implementation — the audited `##`
headings; `audit_impl_record.js` reports `missing-section` for any
absent one:

- Summary
- Context
- Implementation (`### Changes` and `### Decisions During
  Implementation` carry the running record)
- Related Experiments
- Validation
- Risks
- Follow-ups

Status guidance:

- Use `status: "in-progress"` while implementation is underway.
- Change to `completed` only after verification and review evidence is present.
- Change to `blocked` when work is paused for loopback or other explicit
  interruption.

Implementation Records and Experiment Logs record what was tried and what
resulted. The durable intent behind a guarantee — why a test exists and when
it may be retired — belongs to `test-spec` documents (`docs/test-specs/`),
not to `impl-doc`.

## Experiment Log Events

Experiment Log files are JSONL.

- One line equals one event.
- `start` is optional at creation time.
- Under the pre-v3 runtime the update path was `append_experiment_event`
  (removed under Registry 3 — no event writer ships).
- Exceptional correction used `edit_experiment_log` (likewise removed).

Allowed event types:

- `start`
- `observation`
- `hypothesis`
- `change`
- `validation`
- `error`
- `decision`
- `summary`

Required event fields:

- `schema`
- `experiment`
- `seq`
- `type`
- `ts`

## Audit Focus

Implementation Record audit checks:

- required front matter fields
- valid `type` and `status`
- valid `relations.changes` shape
- local relation target existence
- required body sections

Experiment Log audit checks:

- valid JSON per line
- required event fields
- allowed event type
- unique, strictly increasing `seq`
- `experiment` path matches the file path

Both audits also check the managed `README.md` index read-only and report
`index-*` findings (see the impl-doc skill for the code list).

## Index

Each directory uses `README.md` as its index.

### Implementation Records

Use `README.md` as the index under `docs/impl/ir/`. List records as a Markdown
table, in filename order, with these four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| IMPL-5RfVgTgBnHkLmQwErTyUiO | Implement checkout flow | completed | [implement-checkout-flow.md](implement-checkout-flow.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`, sourced from
  the front matter; the `File` column is a relative link within the index
  directory. Write `-` when a value is missing.
- Sort rows by filename in ascending order within each tier. In-flight
  records fill the main table; records with a settled status (`completed`,
  `abandoned`, `superseded`) move to a `## Settled` table below it, also
  filename-ordered. Settled rows stay linked — the tier de-emphasizes
  history without hiding it.
- The pre-v3 contract reconciled the index whenever a record was added or
  its `status` changed, materialization staying explicit (creators never
  wrote indexes). Under Registry 3 the same safe sync engine
  (`planImplIndexSync` / `applyImplIndexSync`, verdict
  `in-sync` / `sync` / `create` / `rejected`) runs only inside
  `migrate_ids` — there is no public `sync_impl_index.js` CLI.
  `audit_impl_record.js` reports the drift (`index-missing-entry`,
  `index-stale-entry`, `index-metadata-mismatch`, `index-tier-mismatch`,
  `index-ordering`) until it is applied. `doc_status` and the
  `doc_maintenance` repair verbs do not repair impl indexes;
  `doc_maintenance index` materializes them only through the same safe
  sync API.
- The managed region is exactly one active table plus an optional
  `## Settled` table. Keep hand-written notes outside the generated
  region (before the marker or after the tables); additional index
  tables make the index ambiguous and are rejected.

### Experiment Logs

Use `README.md` as the index under `docs/impl/exp/`. Experiment Logs are JSONL
files with no front matter, so the index uses a single-column table of file
links, in filename order:

| File |
| --- |
| [checkout-retry.jsonl](checkout-retry.jsonl) |

The matching Implementation Record links to each log via `metadata.experiments`
and relations; the README provides a directory-level overview only.

The same sync engine reconciles the exp index the same way — verdict
`in-sync` / `sync` / `create` / `rejected`, `rejected` for hand-curated or
malformed READMEs — inside `migrate_ids` only.

A new Experiment Log under the pre-v3 contract left the index deferred —
the creator never wrote it. Under Registry 3 no Experiment Log can be
minted at all; the index is reconciled only by the migration-owned sync
engine inside `migrate_ids`.
