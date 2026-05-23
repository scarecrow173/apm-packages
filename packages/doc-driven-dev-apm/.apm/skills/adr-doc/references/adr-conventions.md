# ADR Conventions

These conventions define how the `adr-doc` skill creates, audits, indexes, and
reports on Architecture Decision Records. They are adapted for this package's
MADR 4.0.0 templates and `relations` front matter extension.

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

When multiple candidates exist, prefer the directory with numbered ADR files and
an index file.

## Filenames

Default filename pattern:

```text
NNNN-title-with-dashes.md
```

Rules:

- `NNNN` is a zero-padded sequential number local to the ADR directory.
- The title slug is lowercase ASCII with words separated by dashes.
- Prefer a short present-tense verb phrase.
- Examples: `0001-adopt-adrs.md`, `0002-use-postgresql.md`.

If a repository already uses slug-only filenames, follow that convention instead
of introducing numbering.

## Required Front Matter

Every new ADR created by this package includes YAML front matter:

```yaml
---
status: "proposed"
date: "YYYY-MM-DD"
decision-makers: []
consulted: []
informed: []
relations:
  supersedes: []
  superseded-by: []
  related: []
  refines: []
---
```

Required fields:

| Field | Required | Description |
| --- | --- | --- |
| `status` | Yes | Current lifecycle state. |
| `date` | Yes | Date of the current status in `YYYY-MM-DD` format. |
| `decision-makers` | Yes | People or groups that own the decision. |
| `consulted` | Yes | Subject-matter experts consulted before or during the decision. |
| `informed` | Yes | Stakeholders informed about the decision. |

`consulted` and `informed` follow the RACI communication distinction:
consulted is two-way input; informed is one-way notification.

## Template Selection

Use `minimal` by default. It captures the core MADR decision record while
keeping new ADRs concise enough for routine use.

Choose a template based on the amount of decision context that must be captured:

| Template | Use when |
| --- | --- |
| `minimal` | The decision is routine or moderate in scope, and context, options, and outcome are enough. |
| `full` | The decision is high-impact, cross-team, risky, compliance-relevant, or likely to need detailed review later. |
| `bare-minimal` | The repository already has strict ADR wording, and only the minimal MADR section structure should be inserted. |
| `bare` | The repository already has strict ADR wording, but the full MADR section structure is still useful. |

Prefer `full` when there is meaningful uncertainty, a controversial trade-off,
multiple viable options, or expected future audit needs.

Prefer `bare` or `bare-minimal` only when an existing repository convention
already defines the prose guidance. Do not use bare templates just to make ADRs
shorter.

## Status Values

Use these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| `proposed` | Under discussion and not yet active. |
| `accepted` | Active and expected to be followed. |
| `rejected` | Considered but explicitly not adopted. |
| `deprecated` | Accepted in the past but no longer recommended. |
| `superseded` | Replaced by a newer ADR. |

Keep `status` focused on lifecycle state. Use `relations.superseded-by` to point
to the replacing ADR.

## Relations Extension

`relations` is a package extension, not an upstream MADR 4.0.0 field. It exists
so tooling can build ADR graphs and validate links.

Relation fields:

| Field | Meaning |
| --- | --- |
| `supersedes` | Older ADRs replaced by this ADR. |
| `superseded-by` | Newer ADRs that replace this ADR. |
| `related` | ADRs with relevant context but no directional dependency. |
| `refines` | ADRs clarified or narrowed by this ADR. |

Use file-relative links:

```yaml
relations:
  supersedes:
    - "0003-use-rest-api.md"
  superseded-by: []
  related:
    - "0007-adopt-event-driven-architecture.md"
  refines:
    - "0005-service-boundaries.md"
```

For replacement decisions, link both ways when possible:

- New ADR: `relations.supersedes` points to the old ADR.
- Old ADR: `relations.superseded-by` points to the new ADR.

## Minimal MADR Content

At minimum, every ADR should clearly answer:

1. **Context and Problem Statement**: why the decision exists now.
2. **Considered Options**: which meaningful alternatives were considered.
3. **Decision Outcome**: what was chosen and why.

For fuller ADRs, also capture:

- Decision drivers.
- Consequences.
- Confirmation approach.
- Pros and cons of options.
- More information and source links.

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

The index should list ADRs in filename order and should preserve enough context
for readers to scan decisions quickly.

## Categories

For large repositories, ADRs may be split into subdirectories, for example:

```text
docs/adr/
  backend/
    0001-use-postgresql.md
  frontend/
    0001-use-react.md
  infrastructure/
    0001-use-terraform.md
```

Numbers are local to each category. Document the categorization scheme in the
index before the structure grows.
