# Delegate Execution-Mode Policy

This contract defines how a caller selects the execution mode for every
dispatched effect — audit or delegate — in the
[execution contract](execution-contract.md) loop. Programmatic callers inside
this repository use `scripts/lib/delegate_policy.ts` (`selectDelegateMode`,
`toExecutionMode`, `buildDelegateHandoff`); agent callers apply the same
selection order and handoff contract. The policy is deterministic: it maps
dispatch facts to a mode plus recorded reasons and never spawns anything
itself — dispatch remains the caller's responsibility, and the selected mode
is an *input to dispatch*: the caller hands it to the dispatcher as
`requestedMode` together with the `DelegateHandoff` for delegated modes.

## Dispatch facts

The selection consumes `PolicyFacts`: `effectId` and `stage` identify the
dispatched effect for correlation; the decision itself reads `sharedJudgment`,
`independentScope`, `parallelCandidate`, `contextCost` (`"low" | "high"`),
`hostCapabilities` (the modes the host can execute), and an optional `override`
(`{ mode, reason }`).

## Modes and selection

| Mode | Selected when | Dispatch handoff | Trace `executionMode` | Example delegates |
| --- | --- | --- | --- | --- |
| `same-context` | Shared judgment material — caller and effect read or edit the same canonical documents, serial dependencies, frequent iteration. **The default.** | None — the effect runs in the caller's context | `same-context` | named audits (`spec`, `task`, `test-spec`), `build_task_graph` |
| `subagent-as-tool` | Independent research or black-box review, a bounded return value, or `contextCost: "high"` — keeping raw material out of the caller's context | `DelegateHandoff` | `tool` | bounded discovery/research delegates, black-box document review |
| `isolated-subagent` | Independent write scope **and** parallel candidacy — the delegate owns a disjoint write scope and can run alongside other work | `DelegateHandoff` | `subagent` | delegates writing disjoint artifacts, such as `implementation-flow` on an independent task |

Type or document-kind differences alone never justify delegation. The mode is
selected per dispatch from the facts above, never bound to a skill name: the
same delegate may run `same-context` in one run and `isolated-subagent` in
another.

`subagent-as-tool` traces as `tool` because a subagent invoked as a bounded
tool call shares the scripted/tool dispatch envelope; `isolated-subagent`
traces as `subagent` to mark true independent-context delegation. A caller
that runs no policy keeps its declared `executionMode` (default `unknown`)
and records no `modeReason`.

## Selection order

`selectDelegateMode` evaluates the facts in a fixed order — first match wins:

1. **Explicit override.** When `override` is present and the host supports
   `override.mode`, return it with reason `override:<reason>`. When the host
   does not support it, refuse the override: return `same-context` with
   reasons `host-unsupported:<mode>` and `override-refused`, and set
   `fallbackFrom` to the refused mode.
2. **Shared judgment.** `sharedJudgment` → `same-context`, reason
   `shared-judgment`.
3. **Independent parallel candidate.** `independentScope && parallelCandidate`
   → `isolated-subagent`, reasons `independent-scope`, `parallel-candidate`.
4. **Independent scope.** `independentScope` → `subagent-as-tool`, reason
   `independent-scope`.
5. **High context cost.** `contextCost === "high"` → `subagent-as-tool`,
   reason `context-cost`.
6. **Default.** → `same-context`, reason `default`.

A delegated mode selected at steps 3–5 that the host does not support falls
back to `same-context` with `host-unsupported:<mode>` appended to the reasons
and `fallbackFrom` set — the policy never silently switches modes.
`same-context` is assumed always host-available and is never itself gated.

## Minimum handoff contract

Every dispatched delegate effect — `subagent-as-tool` or `isolated-subagent` —
receives a `DelegateHandoff`, assembled by `buildDelegateHandoff` and
JSON-serializable:

| Field | Content |
| --- | --- |
| `executionMode` | the trace `ExecutionMode` the dispatch was requested under (`tool`/`subagent`) — the handoff pins it, so a delegate cannot run under a different mode than the one the runner recorded |
| `focus` | repo-relative paths the delegate concentrates on |
| `authoritativeInputs` | live canonical references the outcome must echo verbatim |
| `sourceRefs` | additional live canonical references supplied for context |
| `acceptanceCriteria` | the delegate's completion conditions |
| `permissions` | `{ read, write }` repo-relative scopes the delegate may touch |
| `toolLimits` | tool identifiers the delegate may use |
| `budget` | `{ maxHops }` hop bound — default `1`; expand explicitly for multi-hop delegate flows |
| `completion` | the required completion sentence — a completed `EffectOutcome` with canonical evidence |

Canonical references identify artifacts by `path`, `id`, and `fingerprint`.
Never substitute verification-relevant information with lossy summaries: the
handoff carries live references and the delegate resolves their current
content. The `completion` field declares the `EffectOutcome` footer as the
completion shape — the delegate finishes by emitting that footer.

## Dispatch observation boundary

`requestedMode` is a dispatch input, not a trace label. The dispatcher —
host adapter or deterministic scripted dispatcher — must either honor it or
decline, and it reports what it *actually* executed through a
`DispatchResult`: the `EffectOutcome` plus one or more
`DispatchObservation` records `{ target, requested, actual, method }`:

- Exactly one **self-observation** (`target` equal to the dispatched
  effect's id) whose `requested` echoes `requestedMode` and whose `actual`
  names the mode the dispatch ran as.
- Zero or more **internal observations** (`target` naming adapter-internal
  work — e.g. `spec-doc`, `adr-doc`, or `research` inside `briefing-flow`)
  that expose a composite delegate's real execution path. `method` names
  the mechanism the adapter used — `scripted`, `inline-skill`,
  `subagent-spawn`, `tool-call`, or `not-executed` for a declined dispatch.

The caller records every observation as a `dispatch-observed` trace event
(see [run-trace-contract.md](run-trace-contract.md)) and enforces the
boundary before the outcome is accepted:

- A self-observation whose `actual` contradicts `requested` rejects the
  dispatch like any malformed outcome — a mode report is evidence, and a
  dishonest one is a contract breach.
- A dispatch that cannot honor the mode — capability or authorization —
  declines with `method: "not-executed"` and a `yield` outcome; it never
  silently switches to `same-context`.
- Internal observations are the adapter's own report and are not re-checked
  by the runner; they are how a trace proves an independent subagent spawn
  happened rather than a same-context audit relabelled as research.

## Return contract

The compact return is normalized to the `EffectOutcome` defined in
[execution-outcome-contract.md](execution-outcome-contract.md): `completed`,
`retry`, or `yield`, each carrying canonical `authoritativeInputs` and
`evidence`.

The same `assertEffectOutcome` validation applies regardless of execution
mode. A mismatched `edgeId`, `stage`, or effect identity; `authoritativeInputs`
that drift from the resolved input set; evidence whose fingerprints no longer
resolve current canonical content (stale evidence); and missing or forbidden
per-status fields are rejected identically whether the effect ran in-context,
as a tool, or as an isolated subagent. Mode never relaxes the contract: a
write outside `permissions.write` remains a handoff violation, and an
undeclared edge or wrong focus fails the same outcome checks.

## Fallback and override rules

- **Host capability gate before dispatch.** Every non-`same-context`
  selection is checked against `hostCapabilities` before the effect is
  invoked; the gate is part of selection, not a post-dispatch correction.
- **Never silently switch modes.** An unsupported mode returns `same-context`
  with `host-unsupported:<mode>` appended to the reasons and `fallbackFrom`
  recording the refused mode.
- **Overrides require a recorded reason.** An honored override reports
  `override:<reason>`; a host-unsupported override is refused with
  `override-refused` rather than silently applied.
- **Decisions are traceable.** The decision's reasons are `;`-joined onto the
  trace `effect-dispatched` event as `modeReason` — see
  [run-trace-contract.md](run-trace-contract.md).
- **Evaluation may pin the mode.** A deterministic evaluation harness may
  supply `override` to pin a mode; the pin is still gated by host capabilities
  and still recorded.

## Non-goals

- No model-quality evaluation — the policy maps dispatch facts to a mode, it
  does not judge which model or agent performs better; `dispatch-observed`
  records *what mechanism ran*, never how well.
- No token, cost, or latency comparison — the observation boundary carries
  no fields for them and the trace schema never will (see the trace
  non-goals).
- No provider-specific subagent API requirement — the contract is the mode,
  the handoff, the return, and the observation; each host maps them to its
  own mechanisms (a real adapter spawns a subagent; the deterministic
  scripted dispatcher records the same truthfully).
- No edge proliferation — execution mode never changes graph topology; do not
  add edges, delegates, or conditions to express a mode. Internal
  observations describe work inside one dispatched effect, never new graph
  effects.
