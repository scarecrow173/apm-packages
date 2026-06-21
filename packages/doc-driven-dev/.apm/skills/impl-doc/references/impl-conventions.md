# impl-doc Conventions

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
NNNN-title-with-dashes.md
NNNN-title-with-dashes.jsonl
```

Rules:

- `NNNN` is a zero-padded sequential number local to each directory.
- `ir/` and `exp/` use independent numbering.
- Slugs are lowercase ASCII with dash-separated words.
- Follow slug-only repository conventions when they already exist.

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

Sections to keep current during implementation:

- Summary
- Changes Made
- Validation and Evidence
- Risks or Follow-ups

Status guidance:

- Use `status: "in-progress"` while implementation is underway.
- Change to `completed` only after verification and review evidence is present.
- Change to `blocked` when work is paused for loopback or other explicit
  interruption.

## Experiment Log Events

Experiment Log files are JSONL.

- One line equals one event.
- `start` is optional at creation time.
- The normal update path is `append_experiment_event`.
- Exceptional correction uses `edit_experiment_log`.

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

## Index

Each directory uses `README.md` as its index.

### Implementation Records

Use `README.md` as the index under `docs/impl/ir/`. List records as a Markdown
table, in filename order, with these four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| IMPL-0001 | Implement checkout flow | completed | [0001-implement-checkout-flow.md](0001-implement-checkout-flow.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`, sourced from
  the front matter; the `File` column is a relative link within the index
  directory. Write `-` when a value is missing.
- Sort rows by filename in ascending order.
- Whenever a new Implementation Record is added, update the index in the same
  change.
- As entries grow, split the index into multiple headings, one table per
  heading, for readability.

### Experiment Logs

Use `README.md` as the index under `docs/impl/exp/`. Experiment Logs are JSONL
files with no front matter, so the index uses a single-column table of file
links, in filename order:

| File |
| --- |
| [0001-checkout-retry.jsonl](0001-checkout-retry.jsonl) |

The matching Implementation Record links to each log via `metadata.experiments`
and relations; the README provides a directory-level overview only.

Whenever a new Experiment Log is added, update the index in the same change.
