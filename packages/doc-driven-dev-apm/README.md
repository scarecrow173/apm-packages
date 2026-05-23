# Doc-Driven Dev APM Package

This package provides reusable skills for document-driven development.

The first shipped skill is `adr-doc`, a MADR 4.0.0-oriented workflow for
creating, auditing, indexing, and migration-planning architecture decision
records.

Future skills can be added beside it under `.apm/skills/`, for example:

- `rfc`
- `design`
- `spec`
- `task`
- `architecture`

## Install

From this monorepo:

```bash
apm install ./packages/doc-driven-dev-apm --target codex
```

From a consumer repository after publication:

```bash
apm install scarecrow173/apm-packages#v0.1.0
```

## Validate

```bash
apm compile --validate
apm compile --dry-run
node --test tests/*.test.js
```

## Included Skill

### `adr-doc`

Use this skill to work with MADR 4.0.0 ADRs:

- create a new ADR from a MADR template
- audit ADR structure and index consistency
- rebuild the ADR index
- produce migration reports without changing files
