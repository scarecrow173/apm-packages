# Graph State Contract

Graph State is projected afresh from the Knowledge, Execution, and
Evidence stores for every route. It is derived state, not a second
project database.

## State shape

The projection has `schemaVersion: 3`, `graphId`, absolute `cwd`, a
`knowledge` section (`graph` — the Knowledge Graph nodes, edges, derived
edges, check edges, and issues — plus `documents`, the scanned durable
records), an `execution` section (`run` — the selected run's `runId`,
status, and focus — or `null`, and `taskGraph` or `null`), a
`verification` field (or `null`), normalized `focus`, gate results,
caller signals, sorted `blockers`, and sorted `hardBlockers`. Durable
nodes retain their canonical paths, IDs, types, statuses, and Knowledge
Relations v1 edges.

`execution.taskGraph` is not projected from Markdown: it is the Dynamic
Task Graph of one Execution Store run (see `task-graph-contract.md`),
selected by `--run`, by a run-id focus token, or by the
single-active-run-for-this-chain rule. When a run is selected the state's
`execution.run` carries its `runId` and manifest focus, and
run-selection or approval blockers surface here the same way knowledge
blockers do.

`verification` carries the Verification Summary the verification gate
consumes (Issue `#241`) plus `boundToHead` — whether the summary's target
subject digest equals this checkout's `HEAD` content identity: `true`
binds, `false` is a resolved HEAD and a different subject, and `null`
means HEAD itself could not be resolved (unborn branch, non-repo), which
fails closed but is never a target mismatch. The router auto-computes the
summary from the live Evidence Store against `HEAD`;
`--verification-summary <file>` supplies a caller-evaluated one.

## Focus

Pass one or more `--focus` paths, artifact IDs, claim references
(`DOC-ID::KEY`), or a run ID when the repository contains multiple active
chains. Focus resolution uses exact semantic IDs and canonical relations.
Missing, malformed, ambiguous, or conflicting focus is a blocker; the
projection never guesses from basenames, path proximity, or neighboring
files. A `focus-required` blocker authorizes no delegate until the caller
gets explicit authority and reruns the route.

Before a design exists, a valid SPEC and ADR form one briefing chain only when
exact typed lineage relates them directly or both derive from the same immediate
discovery. The discovery is also a valid focus for that chain. Pair evidence
does not depend on the ADR being unused: an ADR already claimed by a design
chain still joins a new spec's briefing pair and then belongs to both chains,
so focusing on the shared ADR alone stays ambiguous. Multiple matching
pairs remain ambiguous and produce `focus-required`; basenames, path proximity,
and broader lineage-component membership never pair artifacts. Under
Knowledge Relations v1 a design claims its upstream spec through `realizes`
and its upstream ADR through `decides-for`, so a claimed artifact belongs to
that design's chain instead of pairing elsewhere; the design gate requires
`realizes` for the design-to-spec relation and `decides-for` for the
design-to-ADR relation (`derives-from` satisfies the design-to-ADR leg only
inside migration-owned pre-v3 corpora).

## Gates and signals

The projection evaluates bootstrap, briefing, design, planning,
implementation, verification, knowledge-consolidation, and exit-audit
evidence. Gate failures and knowledge-graph/relation issues remain
visible in deterministic sorted `blockers`; `hardBlockers` carry the
fail-closed subset — `focus-required`, `focus-invalid`, `duplicate-id`,
every `knowledge:<code>` issue, and a non-passing `knowledge` gate.
Caller-provided signals are merged with only derived signals that the
state projector can establish from facts (`focus-required`,
`bootstrap-incomplete`, `graph-complete`). The CLI accepts a signal only
when its value is listed in `runtimeSignals` or declared by a
`kind: signal` condition in the selected Graph Definition.

Implementation completion requires every selected task in the run's
projected Task Graph to reach a terminal status (`done` or `wont-do`) —
the implementation gate measures the work itself and never folds
verification in. The verification gate's authority is a HEAD-bound
Verification Summary reporting `verdict: "verified"` (see
`verification-summary-contract.md`). A missing summary blocks on
`verification-summary`, an unresolvable HEAD on
`verification-summary-head-unreadable`, a summary targeting another
subject on `verification-summary-target-mismatch`, a non-verified verdict
on `verification-<verdict>` plus the summary's own reasons, and a
`verified` verdict over un-covered required coverage on
`verification-summary-inconsistent` — the gate reads actual evidence
assessments, never a caller-asserted signal. Knowledge consolidation
requires the `knowledge-consolidated` signal once the caller has honestly
taken the consolidation decision. Exit audit requires `exit-audit-pass`.
Missing or conflicting evidence blocks routing rather than advancing
silently.
