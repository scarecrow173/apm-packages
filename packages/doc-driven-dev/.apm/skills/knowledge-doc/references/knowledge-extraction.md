# Knowledge Extraction Contract

This contract defines when implementation work produces durable knowledge and
how that knowledge is persisted under Document Registry 3. It replaces the
legacy always-on `impl-doc` generation contract: a normal implementation
change completes **without** minting an Implementation Record, Experiment
Log, or Knowledge document. Persisting is a decision, not a default. The
execution evidence the IR/EXP used to carry now belongs to the run's
[Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.md)
records and [run trace](../../doc-driven-dev-graph/references/run-trace-contract.md).

Load this reference before consolidating findings from any implementation
run. `references/knowledge-conventions.md` defines the document format; this
file defines the judgment boundary — what is worth keeping, where it
belongs, and how provenance and conflicts are handled.

## What counts as durable knowledge

Extract a finding only when it stays true beyond the change that produced
it:

| Extract | Kind | Because |
| --- | --- | --- |
| Why the design or fix was shaped this way | `architecture` / `lesson` | Rationale survives the diff; the next change needs it |
| Recurrence prevention — the rule that stops the same failure | `lesson` | The run proved a durable constraint, not just an event |
| Constraints confirmed during implementation | `codebase` / `architecture` | Invariants future work must respect |
| Properties confirmed during investigation | `codebase` | Facts about the code that were non-obvious and verified |
| How to run, deploy, or recover something | `operation` | Operational procedure outlives the run |

| Never extract | Where it belongs instead |
| --- | --- |
| Success/failure timelines, attempt history | [Run trace](../../doc-driven-dev-graph/references/run-trace-contract.md) / [Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.md) — diagnostic, not knowledge |
| Command execution logs and their output | [Run trace](../../doc-driven-dev-graph/references/run-trace-contract.md) — transient evidence |
| Chat-like work records and narration | Nothing durable — conversational residue |
| Task state, progress, assignments | [Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.md) records |
| Verification outcomes | Evidence Store / Verification Design |
| Unverified guesses, hypotheses, speculation | Nowhere — or keep `status: draft` until verified |

Reducing record volume is not deleting verified findings: when knowledge is
durable, persist it — do not skip consolidation to keep the tree small.

## The consolidation decision (explicit, never default)

When durable knowledge exists, run
`scripts/consolidate_knowledge.js assess --title ... --kind ...` first.
Assess screens every durable directory (`docs/knowledge`, `docs/specs`,
`docs/designs`, `docs/adr`, `docs/discovery`, `docs/ideas`,
`docs/verification`) and reports each candidate with its `route`. Then
choose exactly one:

| Decision | When | Effect |
| --- | --- | --- |
| `integrate` | An existing knowledge document covers the topic | `--into` updates it: `relations.source` gains the origin, a dated basis entry lands in the Source/Provenance section, `updated` bumps |
| `route` | The finding changes a Spec / Design / ADR (or other durable type) | Consolidation writes nothing; apply the change through that type's owning skill (`spec-doc`, `design-doc`, `adr-doc`, …) |
| `create` | No existing document can carry it | New `docs/knowledge` document — refused while unacknowledged conflicts exist |
| `none` | Nothing durable resulted | Valid no-op completion; nothing is written |

The responsibility boundary is hard: `integrate` refuses a non-knowledge
target. A knowledge mutator never edits a spec, design, or ADR — those
changes route to their owning skills, which keep their own review contract.

## Provenance and basis (原典・根拠)

Every recorded extraction carries both:

- `--from` — the extraction source (原典): the Implementation Record, run,
  review, incident, or document the finding was learned from. Stored in
  `relations.source`; repeatable.
- `--basis` — the evidence basis (根拠): what makes the finding trustworthy
  (a passing test, a review, a reproduced behavior). Written as a dated
  bullet under the document's Source/Provenance section.

`--status confirmed` is the "verified and reviewed" mark. It always requires
recorded provenance — `new_knowledge.js --status confirmed` refuses without
`--from`, and `consolidate_knowledge.js` requires `--from` + `--basis` on
every `integrate` and `create`. An unverified guess is never persisted as
certain; it stays `draft`.

## Duplicates and contradictions

`assess` flags `conflicts`: non-settled knowledge documents that share the
kind plus terms, share multiple terms, or carry the same title. While
conflicts exist the gate is `review-required`, and
`apply --decision create` refuses until each conflict is passed through
`--acknowledge <id|path>` — the explicit review/approval step. Acknowledging
means a human (or the requesting agent) compared the records: integrate,
supersede, or create anyway, with the reason in `--note`.

Conflicts on settled documents — a settled `status` (`archived` /
`superseded` for knowledge) or a `superseded` / `retired` `lifecycle` —
never block: they are reported as candidates for context only.

## The run exit gate

Completing a run with no consolidation is a valid `none` outcome. But when
important findings remain unorganized — conflicts unreviewed, or durable
knowledge identified but not persisted — the caller reports that to the
run's exit gate instead of silently completing. `assess` exposes the signal:
`gate: "review-required"` means consolidation is not finished.

## Index

`docs/knowledge/README.md` stays a derived, materialized view — regenerate
explicitly via `doc_maintenance.js index plan|apply`. Creation and
integration never touch it.
