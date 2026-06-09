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
