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

## Gates and signals

The projection evaluates bootstrap, briefing, design, planning,
implementation, follow-up triage, and exit-audit evidence. Gate failures and
broken graph/relation facts remain visible in deterministic sorted blockers.
Caller-provided signals are merged with only derived signals that the state
projector can establish from facts. The CLI accepts a signal only when its
value is declared by the selected Graph Definition.

Implementation completion requires selected tasks to be graph-resolved (`done`
or `wont-do`) and
the caller to provide `implementation-verified`. Follow-up triage requires
exactly one typed follow-up signal. Exit audit requires `exit-audit-pass`.
Missing or conflicting evidence blocks routing rather than advancing silently.
