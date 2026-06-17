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

Relation fields are shared with the other document skills. Choose the field by
the meaning of the link, not by the target document type.

| Field | Meaning |
| --- | --- |
| `source` | External primary evidence, requirements, issue links, or source material for the decision. |
| `references` | Supplementary context that informed the ADR but is not the source of truth. |
| `implements` | Specs, plans, or other docs this ADR implements, when the ADR operationalizes a prior document. |
| `implemented-by` | Plans, tasks, or code-focused docs that implement this ADR. |
| `depends-on` | Documents or decisions that must remain valid for this ADR to hold. |
| `blocks` | Documents, plans, or tasks blocked until this ADR is accepted. |
| `supersedes` | Older ADRs replaced by this ADR. |
| `superseded-by` | Newer ADRs that replace this ADR. |
| `related` | ADRs with relevant context but no directional dependency. |
| `refines` | ADRs clarified or narrowed by this ADR. |
| `refined-by` | ADRs or specs that clarify or narrow this ADR. |
| `derives-from` | Brainstorming notes, specs, ADRs, or upstream docs that produced this ADR. |
| `derived-by` | Specs, plans, tasks, or ADRs derived from this ADR. |
| `verifies` | Documents, checks, or criteria this ADR verifies, when applicable. |
| `verified-by` | Test plans, review notes, or tasks that verify this ADR. |

Use file-relative links for internal documents. Use URLs for external sources.

```yaml
relations:
  source:
    - "https://example.com/source"
  implemented-by:
    - "../plans/0002-implement-event-driven-architecture.md"
  supersedes:
    - "0003-use-rest-api.md"
  superseded-by: []
  related:
    - "0007-adopt-event-driven-architecture.md"
  refines:
    - "0005-service-boundaries.md"
  references:
    - "https://example.com/background"
```

For replacement decisions, link both ways when possible:

- New ADR: `relations.supersedes` points to the old ADR.
- Old ADR: `relations.superseded-by` points to the new ADR.

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

### Category grouping

For large repositories, ADRs may be split into subdirectories by technical
area or team:

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

### Feature grouping

Subdirectories also work for feature-level grouping, when a feature produces
multiple related architectural decisions:

```text
docs/adr/
  checkout/
    0001-payment-provider-selection.md
    0002-checkout-session-storage.md
```

Use this pattern when the decisions are tightly scoped to one feature and are
best reviewed together. Keep numbering local to the feature directory.
