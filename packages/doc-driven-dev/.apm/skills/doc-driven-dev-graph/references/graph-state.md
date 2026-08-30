# Graph State Contract

Graph State is projected afresh from canonical Markdown artifacts for every
route. It is derived state, not a second project database.

## State shape

The projection has `schemaVersion: 2`, `graphId`, absolute `cwd`, `taskDir`,
normalized `focus`, an `artifactGraph`, gate results, caller signals, sorted
`blockers`, and the selected `taskGraph` (or `null`). Artifact nodes retain
their canonical paths, IDs, types, statuses, and semantic relations.

## Focus

Pass one or more `--focus` paths or artifact IDs when the repository contains
multiple active chains. Focus resolution uses exact semantic IDs and canonical
relations. Missing, malformed, ambiguous, or conflicting focus is a blocker;
the projection never guesses from basenames, path proximity, or neighboring
files. A `focus-required` blocker authorizes no delegate until the caller gets
explicit authority and reruns the route.

Before a design exists, a valid SPEC and ADR form one briefing chain only when
exact typed lineage relates them directly or both derive from the same immediate
discovery. The discovery is also a valid focus for that chain. Multiple matching
pairs remain ambiguous and produce `focus-required`; basenames, path proximity,
and broader lineage-component membership never pair artifacts.

## Gates and signals

The projection evaluates bootstrap, briefing, design, planning,
implementation, follow-up triage, and exit-audit evidence. Gate failures and
broken graph/relation facts remain visible in deterministic sorted blockers.
Caller-provided signals are merged with only derived signals that the state
projector can establish from facts. The CLI accepts a signal only when its
value is listed in `runtimeSignals` or declared by a `kind: signal` condition
in the selected Graph Definition.

Implementation completion requires selected tasks to be graph-resolved (`done`
or `wont-do`) and
the caller to provide `implementation-verified`. Follow-up triage requires
exactly one typed follow-up signal. Exit audit requires `exit-audit-pass`.
Missing or conflicting evidence blocks routing rather than advancing silently.
