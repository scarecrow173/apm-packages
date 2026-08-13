# doc-driven-dev-lifecycle: Lifecycle State Contract

`route_lifecycle.js` derives a fresh `LifecycleState` from canonical Markdown
artifacts and caller-provided signals. It does not persist mutable runtime state.
The state contract is normative for focus selection, gate evaluation, typed
loopbacks, and fail-closed routing.

## State shape

The JSON state uses `schemaVersion: 1` and includes:

- `cwd`: repository root used for all relative paths;
- `focus`: normalized repository-relative focus paths;
- `artifacts`: typed documents with `id`, `path`, `type`, `status`, and semantic
  `relations`;
- `gates`: `bootstrap`, `briefing`, `design`, `planning`, `implementation`,
  `followup-triage`, and `exit-audit`, each `pass`, `fail`, or `blocked` with
  deterministic `reasons`;
- `signals`: caller-observed `LifecycleSignal` values;
- `blockers`: sorted, deduplicated fail-closed blockers.

Canonical directories and Markdown front matter are read on every probe.
Relations retain raw front-matter values; resolution is unique exact artifact ID first, then owner-relative/repository-relative path; external URLs are not broken local relations. The shared lineage relation set includes
`implements`, `implemented-by`, `derives-from`, `derived-by`, `refines`, and
`refined-by`. Contextual, evidence, and task-dependency fields are excluded from
lineage selection, including `relates-to`, `related`, `references`, `source`,
`depends-on`, and `blocks`. Broken local relations, invalid relation shapes,
duplicate IDs, and malformed focus values become blockers rather than inferred
links.

## Focus contract

Focus is explicit whenever more than one active artifact chain exists. A plan,
design, spec, ADR, or task path/ID may be supplied repeatedly with `--focus`.
The router normalizes paths and rejects missing or ambiguous targets.

With no focus:

- an empty repository may continue to the bootstrap/briefing decision;
- active chains produce `focus-required`;
- duplicate IDs or ambiguous spec/ADR/design chains produce `focus-required`.

`focus-required` authorizes no dispatch. The caller must ask for user authority
and rerun with an explicit focus. The router never selects a neighboring chain
by basename or path proximity.

## Gate and signal behavior

Document-derived gates check the existing lifecycle evidence:

| Gate | Derived evidence |
| --- | --- |
| bootstrap | Every canonical directory and `README.md` index exists. |
| briefing | Focused spec has required acceptance criteria and acceptable status; focused ADR has considered options and acceptable status. |
| design | Approved design relates to the focused spec and ADR. |
| planning | Approved plan relates to design; selected tasks form a valid Task DAG. |
| implementation | Selected tasks are `done` and caller supplies `implementation-verified`. |

Follow-up triage and exit audit are evidence-backed typed gates. They pass only
with `followups-classified` and `exit-audit-pass`, respectively. Signals such as
`spec-gap`, `design-gap`, `constraint-gap`, `task-graph-retry`, and
`implementation-incomplete` are loopback observations; they do not mutate
documents or silently advance a phase.

Lifecycle completion requires every gate to pass: `bootstrap`, `briefing`,
`design`, `planning`, `implementation`, `followup-triage`, and `exit-audit`.
Passing only the exit-audit gate never authorizes completion.

Planning Task DAG issues (`missing-task-reference`, `task-cycle`, duplicate IDs,
or no tasks) make planning `blocked`, add `task-graph-invalid`, and produce no
runnable task. This is deliberate fail-closed behavior.

## Runtime loop

Probe state, run every required audit, dispatch the route's delegate, record
evidence in Markdown, then rerun the probe with the returned node and typed
signal. Preserve the route's blockers and reasons in the handoff. Stop only at
`complete` or a blocker that requires user authority; do not invent state,
signals, edges, or task readiness.
