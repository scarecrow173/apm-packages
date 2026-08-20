# Package Agent Guide

This directory is the distributed `doc-driven-dev` APM package. Keep its
English and Japanese documents synchronized in structure and meaning.

## Public entrypoint

Use `doc-driven-dev-graph` for graph routing. Its Graph Definition is the
normative execution authority; phase labels are conceptual mapping only.
The runtime contract is:

`Graph Definition -> Graph State -> one declared route -> delegate/audit ->
Markdown evidence -> re-project`.

The package has four layers:

- **Execution Graph** — declared nodes, edges, conditions, priorities, and
  delegate/audit bindings in `.apm/skills/doc-driven-dev-graph/graphs/`.
- **Artifact Graph** — canonical Markdown IDs, types, statuses, and relations.
- **Graph State** — fresh projection with focus, gates, signals, blockers, and
  selected evidence.
- **Dynamic Task Graph** — deterministic projection of focused task relations.

## Condition and route rules

The generic condition DSL supports `signal`, `gate` (`pass` / `not-pass`), and
`task-graph` (`runnable` / `invalid`) predicates. Unknown signals and malformed
definitions fail closed. Eligible outgoing edges are ordered by ascending
`priority`, then stable edge ID. Each invocation returns exactly one of a
declared edge transition, a same-node blocked result with no edge, or a terminal
result with no edge. The caller runs all returned audits, dispatches only the
returned delegate, records Markdown evidence, and re-enters at `next`.

`focus-required` blocks dispatch until explicit focus is supplied. A terminal
route is idempotent. A blocked route never guesses from filenames, path
proximity, or an adjacent node.

## Delegate bindings

The Graph Definition declares these bindings:

- `migrate_docs` and `scaffold_docs` for optional migration/bootstrap;
- `briefing-flow` and `design-doc` for discovery and design;
- `build_task_graph`, executed by `build_task_graph.js`, for planning;
- `implementation-flow` for implementation;
- `doc-status` for exit audit.

Delegates own their briefing or implementation subgraphs. Do not duplicate a
delegate's work in the router or invent an unlisted transition.

## Task Graph invariant

Task documents and their canonical relations remain authoritative. A task is
runnable only when every predecessor is `done`; `wont-do` never satisfies a
dependency. Duplicate IDs, unresolved references, cycles, malformed relations,
or an empty selection produce blockers and no runnable tasks.

## Persistence boundary

Markdown is durable project history and status authority. Graph State and the
Dynamic Task Graph are per-turn projections. Do not add a parallel runtime
database or mutable lifecycle store.

## Skills and ownership

Document-generation skills (`idea-doc`, `deep-dive`, `briefing-flow`,
`discovery-doc`, `adr-doc`, `spec-doc`, `design-doc`, `plan-doc`, `task-doc`,
`impl-doc`, and `doc-status`) own their document contracts. The orchestration
skills are `doc-driven-dev-graph`, `implementation-flow`, and
`skill-discovery-protocol`.

Only one orchestration skill should be active for a user request. Explicit
implementation requests use `implementation-flow`; explicit discovery and
decision capture use `briefing-flow`; graph-wide routing uses
`doc-driven-dev-graph`. Delegation is explicit and must not create activation
loops.

## Source and distributed assets

Runtime TypeScript source is under `scripts/doc-driven-dev/src/skills/`.
Distributed Markdown, graph YAML, references, and generated scripts are under
`.apm/skills/`. Edit source first for runtime behavior, then run the package
build to regenerate JavaScript. Edit distributed `SKILL.md`, references, and
graph assets directly when changing their public contract.

Do not hand-edit generated JavaScript for formatting-only changes. Keep source
and distributed outputs aligned when a runtime change is intentionally made.

## Validation

From the repository root:

```bash
pnpm --dir scripts/doc-driven-dev test
pnpm --dir scripts/doc-driven-dev run lint:md
```

Before submitting a documentation change, run the public residue and contract
tests in `scripts/doc-driven-dev/tests/doc-suite.test.ts`, then inspect
`git diff --check`.
