# Doc-Driven Dev APM Package

This package provides reusable skills for spec-driven and document-driven
development. Documents created by these skills use YAML front matter plus
Markdown so agents can track lifecycle status, source evidence, and semantic
relations between ADRs, specs, plans, and tasks.

The package keeps `adr-doc` as the architecture decision workflow and provides
a document lifecycle that starts with idea refinement and brainstorming:

- `idea-refine`: turn rough ideas into options, assumptions, and questions.
- `brainstorming`: clarify intent and route to ADR, spec, plan, or task.
- `spec-doc`: define what to build before implementation starts.
- `plan-doc`: turn an approved spec or ADR into an implementation plan.
- `task-doc`: track implementation slices and dependencies.
- `doc-status`: list and audit document status, indexes, and relations.

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
tsx --test tests/*.test.ts
```

## Included Skills

### `idea-refine`

Use this skill when work starts as a rough concept, opportunity, complaint, or
solution idea. It creates artifacts under `docs/ideas/` and captures raw ideas,
problem signals, options, assumptions, and next questions before routing.

### `brainstorming`

Use this skill to clarify intent through dialogue before downstream documents
are written. It creates artifacts under `docs/discovery/` and records document
routing decisions for ADR, spec, plan, or task work.

### `adr-doc`

Use this skill to work with MADR 4.0.0 ADRs:

- create a new ADR from a MADR template
- write implementation plans and verification criteria for coding agents
- list ADRs and review agent-readiness
- audit ADR structure and index consistency
- check Implementation Plan code links and manage ADR relations
- rebuild the ADR index
- produce migration reports without changing files

### `spec-doc`

Use this skill to create YAML-front-matter specs under `docs/specs/`. Specs
capture intent, scope, requirements, acceptance criteria, and source evidence
before implementation planning starts.

### `plan-doc`

Use this skill to create implementation plans under `docs/plans/`. Plans link to
upstream specs or ADRs with `relations.implements` and
`relations.derives-from`.

### `task-doc`

Use this skill to create implementation tasks under `docs/tasks/`. Tasks link to
their plan with `relations.implements` and `relations.depends-on`, and use
task-specific lifecycle statuses.

### `doc-status`

Use this skill to list and audit generated documents. It validates required
front matter, status values, local relation targets, and index coverage while
allowing external source URLs in `relations.source`.

## Shared Relations

New generated specs, plans, and tasks use semantic relation fields:

```yaml
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
```

Use `source` for external evidence and primary sources. Use `references` for
supplementary material. Use the remaining fields to describe the meaning of
internal document links rather than the type of the linked document.

## Recommended Lifecycle

```text
idea-refine
  -> brainstorming
  -> ADR / spec routing
  -> plan-doc
  -> task-doc
  -> implementation
  -> doc-status
```

ADRs are recommended when the work requires a technical decision with
alternatives or long-lived consequences. Specs are recommended when what should
be built, why it is needed, who it serves, scope, implementation-facing
behavior, and acceptance criteria need to be explicit.
