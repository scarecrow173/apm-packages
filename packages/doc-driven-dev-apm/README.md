# Doc-Driven Dev APM Package

This package provides reusable skills for spec-driven and document-driven
development. Documents created by these skills use YAML front matter plus
Markdown so agents can track lifecycle status, source evidence, and semantic
relations between ADRs, specs, designs, plans, and tasks.

The package follows a dual-track model where spec and ADR are created in
parallel from the same discovery output:

- `idea-refine`: turn rough ideas into options, assumptions, and questions.
- `deep-dive`: interrogate intent, constraints, and decision axes through codebase-aware, one-question-at-a-time dialogue.
- `brainstorming`: clarify intent and route to spec + ADR (parallel).
- `spec-doc`: define what to build before implementation starts.
- `adr-doc`: propose, draft, and maintain Architecture Decision Records.
- `design-doc`: capture overview-first design artifacts before planning.
- `plan-doc`: turn approved spec + ADR + design into an implementation plan.
- `task-doc`: track implementation slices and dependencies.
- `impl-doc`: record implemented outcomes and machine-readable implementation experiments.
- `doc-status`: list and audit document status, indexes, and relations.

## Definitions

### doc-driven-dev mainline

The document flow that every piece of work follows:

```text
idea-refine OR deep-dive OR brainstorming
  → spec-doc + adr-doc   (parallel: created from the same discovery output)
  → design-doc           (overview + detailed design docs)
  → plan-doc             (derives from spec, ADR, and approved design)
  → task-doc
```

- **Spec** answers WHAT, WHY, and SCOPE.
- **ADR** answers HOW and records every technical decision with alternatives
  considered and rationale.
- **Parallel creation**: when brainstorming produces enough context, both spec
  and ADR can be written simultaneously since they address different facets of
  the same work.
- **Design gate before planning**: `plan-doc` requires approved `design-doc`
  input and uses spec for requirements plus ADR for technical constraints.

Skills on the mainline: `idea-refine`, `deep-dive`, `brainstorming`, `spec-doc`, `adr-doc`,
`design-doc`, `plan-doc`, `task-doc`.

### doc-driven-dev parallel track

Spec and ADR form a **parallel track** — two documents derived from the same
upstream discovery artifact, addressing complementary concerns:

- `spec-doc`: answers What / Why / Scope, triggers on any feature or change, blocks planning until the spec is approved, and produces acceptance criteria.
- `adr-doc`: answers How / Which / Why-this-over-that, triggers on technical decisions with alternatives, constrains planning through accepted ADRs, and produces implementation constraints.

- When brainstorming reveals both product requirements and technical decisions,
  write spec and ADR in parallel.
- When the work is purely product (no architecture choice), spec alone suffices.
- When the decision is purely cross-cutting (no single feature), ADR alone
  suffices.
- All decisions — including those that seem obvious — are recorded as ADRs so
  future agents understand rationale.

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
are written. It creates artifacts under `docs/discovery/` and routes to
`spec-doc` + `adr-doc` in parallel.

### `deep-dive`

Use this skill when the request needs deeper interrogation before downstream
documents are trustworthy. It clarifies the real outcome, the binding
constraints, and the decision axes through codebase-aware dialogue. The output
is a confirmed intent summary; it does not create a discovery artifact by
itself.

### `adr-doc`

Use this skill to propose, draft, and maintain MADR 4.0.0 ADRs. It keeps the
full ADR workflow, including repository scan, drafting, review, and maintenance
operations. When the decision itself still needs deeper interrogation, hand off
that clarification work to `deep-dive` and return once the intent is concrete.

- create a new ADR from a MADR template
- ask only ADR-specific gap-fill questions or emit missing-input requests when
  deeper clarification is still needed
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

### `design-doc`

Use this skill to create design artifacts under `docs/designs/`. It maintains
required `overview.md` plus detailed design docs and acts as a hard gate for
`plan-doc`.

### `plan-doc`

Use this skill to create implementation plans under `docs/plans/`. Plans link to
upstream specs with `relations.implements`, and to design/ADR inputs with
`relations.derives-from`.

### `task-doc`

Use this skill to create implementation tasks under `docs/tasks/`. Tasks link to
their plan with `relations.implements` and `relations.depends-on`, and use
task-specific lifecycle statuses.

### `impl-doc`

Use this skill to create implementation records under `docs/impl/ir/` and
experiment logs under `docs/impl/exp/`. It provides CLI-based creation and
auditing for Implementation Records, plus CLI-based creation, append, edit, and
audit flows for Experiment Logs.

### `doc-status`

Use this skill to list and audit generated documents. It validates required
front matter, status values, local relation targets, and index coverage while
allowing external source URLs in `relations.source`.

### Workflow Skills (Implementation Phase)

These skills activate during Phase 4b (Implementation) of the doc-driven-dev
flow. They are optional — use them when the task calls for coding, debugging,
or code review.

| Skill | Purpose |
| --- | --- |
| `implementation-flow` | Meta skill: routes tasks to workflow skills via discovery tree |
| `source-driven-development` | Ground implementation in official docs; cite sources |
| `incremental-implementation` | Ship in small, verified increments |
| `doubt-driven-development` | Adversarial self-review before committing decisions |
| `test-driven-development` | RED → GREEN → REFACTOR; tests before production code |
| `systematic-debugging` | Root-cause tracing with binary search and evidence |
| `subagent-driven-development` | Delegate implementation slices to sub-agents |
| `dispatching-parallel-agents` | Fan-out independent tasks to parallel agents |
| `requesting-code-review` | Prepare and submit code for reviewer agents |
| `receiving-code-review` | Respond to review feedback systematically |

Origin: `source-driven-development`, `incremental-implementation`, and
`doubt-driven-development` are adapted from
[addyosmani/agent-skills](https://github.com/nicepkg/agent-skills) (MIT).
The remaining six are adapted from
[obra/superpowers](https://github.com/obra/superpowers) (MIT).

## Shared Relations

New generated specs, designs, plans, and tasks use semantic relation fields:

```yaml
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
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
idea-refine OR deep-dive OR brainstorming
  -> spec-doc + adr-doc  (parallel: define what + record decisions)
  -> design-doc          (overview-first design gate)
  -> plan-doc            (derives from spec, ADR, and approved design)
  -> task-doc            (execution slices)
  -> impl-doc            (implementation records and experiment logs)
  -> implementation-flow (workflow skill orchestration per task)
  -> doc-status
```

The dual-track model: **spec + ADR (parallel) → design → plan → task**.
Specs define what should be built, why, scope, and acceptance criteria.
ADRs record every technical decision with alternatives and rationale.
When brainstorming or deep-dive produces enough context for both, they are written in
parallel. Design docs bridge into planning.
