# Graph Effect Outcome Contract

This is the caller-facing contract for a graph-invoked audit or delegate. It is
documentation, not a public TypeScript schema or a new Graph State object.
Each invoked effect returns exactly one `EffectOutcome` footer; a caller returns
one `GraphRunResult` when it yields.

## EffectOutcome footer

Every footer has this scope. Record canonical paths, IDs, and fingerprints, not
prose claims that work was completed.

```yaml
status: completed | retry | yield
edgeId: <declared GraphRoute.edgeId>
stage: audit | delegate
effect:
  kind: audit | delegate
  id: <required audit ID or declared delegate ID>
authoritativeInputs:
  - path: <canonical Markdown path>
    id: <canonical artifact ID when present>
    fingerprint: <canonical input fingerprint>
evidence:
  - path: <canonical Markdown path>
    id: <canonical evidence ID when present>
    fingerprint: <canonical evidence fingerprint>
```

The status variant adds these required and forbidden fields:

| Status | Required | Forbidden |
| --- | --- | --- |
| `completed` | exactly one `proof.canonicalEvidence` (`path`, `id` when present, `fingerprint`) or `proof.providerIdempotency` (`provider`, `key`) | `reason`, `retry` |
| `retry` | `retry.changedEvidence` with the changed canonical path/ID/fingerprint | `proof`, `reason` |
| `yield` | `reason`: `approval-required`, `input-required`, `authority-required`, or `unrecoverable-blocker` | `proof`, `retry` |

`evidence` records the canonical checkpoint for every outcome. A `completed`
outcome additionally proves this particular effect: either canonical evidence
proves it or the external provider idempotency key proves it. Do not use a
route fingerprint as the proof.

## Existing delegate meanings

This contract renders existing semantics; it does not add workflow states.

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate passes | recoverable document gap | `input-required` for an unresolved user-only requirement |
| `design-doc` | design is approved | — | `approval-required` for its designated reviewer; `input-required` for an upstream user decision |
| `implementation-flow` | task slice is verified and its Implementation Record is complete | declared spec/design/constraint repair | `authority-required` for an irreversible effect without permission; `unrecoverable-blocker` when no declared safe repair exists |
| `doc-status` | documents are Completable | Returned with declared repair evidence | `unrecoverable-blocker` when Returned has no safe repair |

## Exact caller evaluation

The caller first evaluates terminal or blocked `GraphRoute` results and its
hop/repetition budgets under the [execution contract](execution-contract.md).
It then matches `EffectOutcome.status` and, for `yield`, `reason` exactly; it
does not infer a result from free-form delegate prose.

- `completed` may skip only this scoped audit or delegate stage after its input
  scope and proof validate.
- `retry` is auto-continuable only after its canonical changed evidence is
  re-projected and a fresh route selects a declared edge.
- `yield` stops with its exact reason.

At yield, the caller records a `GraphRunResult` handoff containing the complete
`GraphRoute`, ordered `EffectOutcome` footers, bounded counters/trace, and the
final yield reason. The retained route supports topology, terminal/blocked,
and budget evaluation. Receipt validity binds only `edgeId`, stage, effect,
authoritative inputs, evidence, and proof; it never requires byte-equivalent
complete `GraphRoute` objects.

## Resume and duplicate effects

Re-project canonical Markdown before comparing a saved receipt. Skip a saved
`completed` stage only when its `edgeId`, stage, effect identity, every
authoritative input path/ID/fingerprint, and its canonical-evidence or
provider-idempotency proof match the fresh scope. Missing proof yields
`authority-required` rather than replaying an irreversible effect.

For example, an `implementation-flow` receipt scoped to Task Graph A cannot
skip that delegate after canonical Markdown projects Task Graph B. It becomes
eligible only if its authoritative-input scope still matches the fresh graph.
