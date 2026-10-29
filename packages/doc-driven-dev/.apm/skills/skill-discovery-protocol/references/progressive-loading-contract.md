# Skill Discovery Protocol — Progressive Loading Contract

Version: 1.0.0

This document defines how agents load skill instructions in stages when they
run flows that use the Skill Discovery Protocol: front-matter metadata first,
the flow profile second, applicable `SKILL.md` bodies third, and step-scoped
references, scripts, and adapters last. It is an instruction-level loading
discipline — it narrows which instruction text an agent reads, never which
gates, evidence, or routing decisions apply.

---

## 1. Staged Loading Model

| Stage | Surface | Loaded when |
| ----- | ------- | ----------- |
| 0 | `name` + `description` front matter | Always available — the skill selection surface |
| 1 | Flow profile under `.sdp/<adapter-id>/` | Once per flow run, before any routing decision |
| 2 | `SKILL.md` body | Only for skills the resolved profile marks applicable |
| 3 | `references/*.md`, `scripts/*.js`, `assets/adapters/*.yaml` | Only when the active step names them |

Stages are strictly ordered: a later stage never substitutes for an earlier
one, and no stage loads content "for completeness".

### Stage 0 — Selection Surface

Every installed skill's `name` and `description` front matter is always
available and is the only always-on selection surface. It stays tiny:
descriptions carry trigger and scope signals, not procedures. Agents choose
candidate skills from this surface; nothing else is loaded at this stage.
The load inventory counts front-matter `description` text as stage-0 loaded
text for exactly this reason.

### Stage 1 — Profile Resolution

Before routing, the flow resolves its adapter-scoped profile:
`.sdp/<adapter-id>/<flow_profile>`, where the adapter supplies both the
`<adapter-id>` directory and the `flow_profile` filename
(`artifacts.protocol.flow_profile`). Examples:
`.sdp/briefing-flow-default/briefing-profile.json` for briefing-flow and
`.sdp/implementation-flow-default/implementation-flow-profile.json` for
implementation-flow.

- Missing, corrupt, or stale → regenerate by invoking
  `skill-discovery-protocol` with the flow's adapter
  (`assets/adapters/*-adapter.yaml`). This regeneration path is the hard
  gate and is preserved unchanged.
- What counts as corrupt or stale is defined by the validation gates in
  [gate-spec.md](gate-spec.md); this contract references those semantics
  and does not restate them.
- A missing or invalid profile never defaults to "all skills applicable".
  Resolution without a valid profile yields no applicability decision —
  fail closed, regenerate, then proceed.
- `sdp query` subcommands (`flow-stack`, `resolution`, `execution-policy`,
  `runtime-guidance`, and the others in `cli-reference.md`) are the read
  channel into the profile. Loading raw `.sdp` JSON into context is not a
  substitute for them.

### Stage 2 — Applicable Skill Bodies

Load a `SKILL.md` body only for skills the resolved profile marks
applicable — skills selected through `flow_stack.slots[]`,
`resolved_invocations`, and the flow's documented configure procedure.
The body is the always-on instruction surface for an applicable skill (the
inventory's `alwaysOnChars`); the profile's `execution_policy` governs how
rigidly its steps apply, and `runtime_guidance` is read after policy checks
as a soft ranking signal, not a hard gate.

### Stage 3 — On-Demand Step Resources

Within an applicable skill, load a `references/*.md` file, a `scripts/*.js`
tool, or an `assets/adapters/*.yaml` only when the active step names it —
the conditional-load lines the inventory flags as `optional` ("if needed",
"as needed", "see also", conditional bullets). A skill's own reference
loading guide decides which references are MANDATORY for the task type and
which stay unloaded.

---

## 2. Loading Rules

- **Explicit invocation paths only.** Loads follow declared profile
  applicability plus active-step need. Never "activate all skills", never
  bulk-load every `SKILL.md`, never read references to be thorough.
- **Profile is the hard gate.** No stage-2 body load happens without a
  valid resolved profile; regenerate on missing, corrupt, or stale first.
- **Declared relations, not guesses.** Applicability comes from the
  profile's declared classification, slots, and resolutions — not from
  filename proximity, directory adjacency, or recollection.
- **en/ja parity.** `SKILL.md`/`SKILL.ja.md` and `*.md`/`*.ja.md` siblings
  stay synchronized in structure and meaning. The English file is the
  authoritative instruction surface the inventory measures; loading the
  localized sibling instead is a host-language choice, not a content
  difference.
- **Portability.** The discipline needs only the skill filesystem, `.sdp`
  artifacts, and the `sdp` CLI — no vendor-specific required dependencies.

---

## 3. Preserved Gates and Evidence

Staged loading reduces instruction text, never obligations. These normative
gates remain in force under this contract:

- spec-doc and adr-doc acceptance at the briefing gate
- planning approval — `approval-required` yields while plan review is pending
- the Implementation Record opened before code changes begin
- verification EVIDENCE recorded before a task is treated as complete
- the review gate before task closure
- `commitGate` commit requirements declared by the route

A skill body that was not loaded because the profile marked the skill
non-applicable cannot waive a gate the flow itself declares.

---

## 4. Deterministic Measurement

The deterministic measurement channel is the skill load inventory
(`scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/load_inventory.ts`
in this repository):
files referenced, bytes, instruction characters (`skillBytes`,
`alwaysOnChars`), and load-directive counts classified by kind
(`reference`, `script`, `sdp-artifact`, `skill-invoke`, `adapter`) and by
the `optional` flag described in §1.

This contract does not measure or claim improvements in tokens, model
latency, semantic firing rate, or how a model interprets natural language.
Those are explicit non-goals (§6).

---

## 5. Boundary and Relationship to Context Retrieval

This contract governs SKILL/instruction loading — which skill files an
agent reads while executing a flow. Document-body retrieval — canonical
Markdown artifacts handed to delegates — is governed by the
[context retrieval contract](../../doc-driven-dev-graph/references/context-retrieval-contract.md)
in `doc-driven-dev-graph`: its L0–L3 levels, typed-relation traversal, and
fail-closed findings apply to artifact content, not to skill instructions.

The two contracts apply the same discipline at different layers: explicit
selection over proximity guessing, declared relations over inference,
fail-closed over silent drops, and deterministic file/byte/count
measurement over model metrics. Router and graph invariants are unchanged —
`doc-driven-dev-graph` routing, `GraphRoute` delegation, and task-graph
semantics are unaffected by this contract.

---

## 6. Non-goals

- No token, cost, model-latency, or firing-rate evaluation.
- No change to router, graph, or task-graph invariants.
- No change to the profile schema or the sdp pipeline — this contract
  consumes the pipeline's outputs.
- No document-body retrieval rules — those belong to the context retrieval
  contract.
- No vendor-specific required dependencies.
