# ADR Conventions

These conventions define how the `adr-doc` skill creates, audits, indexes, and
reports on Architecture Decision Records. They are adapted for this package's
MADR 4.0.0 templates and `relations` front matter extension.

`adr-doc` ADRs are written for coding agents. A reader should be able to execute
the decision from the ADR itself, without asking for additional explanation.

## Directory

If a repository already has an ADR directory, keep it. Do not move existing ADRs
just to match this package's defaults.

When no ADR directory exists, use `docs/adr/` by default. This keeps ADRs near
other project documentation while making the directory name explicit.

Detection order used by scripts:

1. `docs/adr/`
2. `docs/decisions/`
3. `adr/`
4. `docs/adrs/`
5. `decisions/`

When multiple candidates exist, prefer the directory that already contains ADR
files and an index file.

## Filenames

Default filename pattern:

```text
title-with-dashes.md
```

Rules:

- Filenames are slug-only: lowercase ASCII words separated by dashes.
- Prefer a short present-tense verb phrase.
- Examples: `adopt-adrs.md`, `use-postgresql.md`.

Document identity lives in the front matter `id`, not in the filename or its
sort position. Existing `NNNN-<slug>.md` filenames remain valid, but new
documents always use slug-only names. Run `migrate_ids.js` under `doc-maintenance/scripts` to upgrade existing files.

## Required Front Matter

Every new ADR created by this package includes YAML front matter:

```yaml
---
id: "ADR-1AbCdEfGhIjKlMnOpQrStU"
type: "adr"
status: "proposed"
lifecycle: "draft"
title: "Decision title"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
  decides-for: []
  supersedes: []
metadata:
  adr:
    decision-makers: []
    consulted: []
    informed: []
---
```

Required fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable document identifier in `ADR-<22-char Base62>` form (UUIDv7-derived; legacy `ADR-NNNN` remains valid). |
| `type` | Yes | Shared document type. Use `adr` for ADRs. |
| `status` | Yes | Type-specific workflow state (see Status Values). |
| `lifecycle` | Yes | Registry 3 durability axis: `draft`, `current`, `superseded`, or `retired`. New documents default to `draft`; unknown values are invalid and are never inferred from `status`. |
| `title` | Yes | Human-readable ADR title matching the decision. |
| `created` | Yes | Creation date in `YYYY-MM-DD` format. |
| `updated` | Yes | Last substantive update date in `YYYY-MM-DD` format. |
| `owners` | Yes | People or groups accountable for maintaining the document. |
| `relations` | Yes | Shared meaning-based document graph links. |
| `metadata.adr.decision-makers` | ADR governance | People or groups that own the decision. |
| `metadata.adr.consulted` | ADR governance | Subject-matter experts consulted before or during the decision. |
| `metadata.adr.informed` | ADR governance | Stakeholders informed about the decision. |

ADR-specific governance belongs under `metadata.adr`, not top-level
`decision-makers`, `consulted`, or `informed`. `consulted` and `informed`
follow the RACI communication distinction: consulted is two-way input; informed
is one-way notification.

## Status Values

`status` and `lifecycle` are separate axes: `status` is the type-specific
workflow state below; `lifecycle` (`draft` → `current` →
`superseded`/`retired`) is the Registry 3 durability axis that drives
index tiers. Use these statuses:

| Status | Meaning |
| --- | --- |
| `proposed` | Under discussion and not yet active. |
| `accepted` | Active and expected to be followed. |
| `rejected` | Considered but explicitly not adopted. |
| `deprecated` | Accepted in the past but no longer recommended. |
| `superseded` | Replaced by a newer ADR. |

Keep `status` focused on workflow state; record `lifecycle` separately
(`superseded` when the ADR is replaced). Under Knowledge Relations v1 the
*replacing* ADR stores `relations.supersedes` source→target at the ADR it
replaces; the replaced ADR stores nothing — `superseded-by` is the derived
inverse projection, never written by `relate_adr` or by hand.

## Relations Extension

`relations` is a package extension, not an upstream MADR 4.0.0 field. It exists
so tooling can build ADR graphs and validate links.

Under Knowledge Relations v1 an ADR stores only its declared forward fields
plus `relations.source` provenance — there is no shared free-form vocabulary:

| Field | Targets | Meaning |
| --- | --- | --- |
| `decides-for` | spec, design | The spec or design this decision is made for — the canonical spec↔ADR pair and the design-gate edge. |
| `supersedes` | adr | The older ADR this one replaces. |

Inverse names (`decided-by`, `superseded-by`) are derived projections —
consistent by construction, never stored. `relations.source` carries external
provenance (URLs, issue links, source material); `relations.changes` is the
provenance change-set, not a document link.

Pre-v3 keys (`implements`, `implemented-by`, `depends-on`, `blocks`,
`superseded-by`, `related`, `refines`, `refined-by`, `derives-from`,
`derived-by`, `verifies`, `verified-by`, `references`, `defers`,
`deferred-by`) are migration-domain input only: `doc-status` reports them as
`legacy-relation-field` findings, migration tooling owns their conversion,
and they are never resolved or walked as current graph edges.

Use file-relative links or document IDs for internal documents. Use URLs for
external sources.

```yaml
relations:
  source:
    - "https://example.com/source"
  decides-for:
    - "SPEC-0001"
  supersedes:
    - "use-rest-api.md"
```

For replacement decisions, store the forward edge only:

- New ADR: `relations.supersedes` points to the old ADR — the `superseded-by`
  view on the old ADR is derived, never written.
- Re-point or close in-flight dependents that still cite the replaced ADR.

## Minimal MADR Content

At minimum, every ADR should clearly answer:

1. **Context and Problem Statement**: why the decision exists now.
2. **Considered Options**: which meaningful alternatives were considered.
3. **Decision Outcome**: what was chosen and why.

For coding agents, every ADR should also make the implementation boundary clear:

- What the agent should change or preserve.
- Which constraints, interfaces, files, or behaviors are in scope.
- Which alternatives are explicitly not chosen.
- How the agent can recognize that the decision has been implemented correctly.

For fuller ADRs, also capture:

- Decision drivers.
- Consequences.
- Confirmation approach.
- Pros and cons of options.
- More information and source links.

Audit and review scripts resolve these section headings by canonical English
name plus declared localized template aliases (for example `背景と問題`
matches `Context and Problem Statement`); the canonical spelling wins when
both appear. The same alias rule applies to the fixed `Label:` bullets inside
`## Implementation Plan` (for example `影響するパス:` matches
`Affected paths:`). Status is read from front matter; a `## Status` body
section is not part of the MADR 4 contract.

## Mutability

ADR files are decision history.

- Do not rewrite historical rationale just to match a new template.
- Prefer appending dated notes over editing old context.
- If a decision is replaced, create a new ADR and connect it with `relations`.
- Status and relation updates are acceptable in-place edits.
- Audit and migration reports must not invent missing rationale, options, or
  outcomes.

## Index

Use `README.md` as the default ADR index. If a repository already uses
`index.md`, keep it.

List ADRs as a Markdown table, in filename order, with these four columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| ADR-1AbCdEfGhIjKlMnOpQrStU | Adopt ADRs | accepted | [adopt-adrs.md](adopt-adrs.md) |

Index rules:

- Use exactly these four columns: `ID`, `Title`, `Status`, `File`. Take `ID`,
  `Title`, and `Status` from front matter when present. If older ADRs lack
  `id` or `title`, derive `ID` from a legacy filename number (`ADR-NNNN`) and
  `Title` from the H1 heading. The `File` column is a relative link within the
  index directory. Write `—` when a value is missing.
- Sort rows by filename in ascending order within each tier. In-flight ADRs
  fill the main table; ADRs whose `lifecycle` is settled (`superseded` or
  `retired`) move to a `## Settled` table below it, also
  filename-ordered. Settled rows stay linked — the tier de-emphasizes
  history without hiding it. `accepted`/`proposed` ADRs stay in-flight: they
  are the normative baseline current work derives from.
- Update the index whenever a document is added or its `status` changes —
  materialization is explicit via `doc_maintenance.js index plan|apply`
  (creators never write indexes); `doc_status lint` reports the drift
  (`index-metadata-mismatch`, `index-ordering`) until it does.
- A managed index keeps exactly one in-flight table plus the optional
  `## Settled` tier — `doc_status lint` flags a second table in a tier or
  any table under another `##` heading as `index-unparseable`. As entries
  grow, split documents across owned directories, each with its own
  managed index, rather than adding headed tables inside one index.

## Subdirectory Grouping

### Category subdirectories

For large repositories, ADRs may be split into subdirectories by technical
area or team:

```text
docs/adr/
  backend/
    use-postgresql.md
  frontend/
    use-react.md
  infrastructure/
    use-terraform.md
```

Filenames need to be unique only within their directory. Document the
categorization scheme in the index before the structure grows.

### Feature subdirectories

Subdirectories also work for feature-level grouping, when a feature produces
multiple related architectural decisions:

```text
docs/adr/
  checkout/
    payment-provider-selection.md
    checkout-session-storage.md
```

Use this pattern when the decisions are tightly scoped to one feature and are
best reviewed together.
