---
name: briefing-flow
description: "Use when starting initial information gathering for new features or changes, when requirements are ambiguous, or when you need to decide which skills to activate before writing spec-doc/adr-doc. Keywords: briefing, discovery, spec-doc, adr-doc, skill stack, entry decision."
license: MIT
---

# Briefing Flow

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task with explicit
skill instructions, skip this meta skill and follow your dispatch instructions.
</SUBAGENT-STOP>

Orchestrates information gathering and organization by dynamically discovering
and routing to ALL available skills in the environment. This is the **briefing
phase orchestrator** — it determines which skills apply, configures the skill
stack based on information state, and enforces spec-doc and adr-doc completion
before progression.

This is a **meta skill**: it produces no documents directly. Instead it governs
skill discovery, configuration, sequencing, and the gate loop that connects
information gathering to downstream document creation.

## When to Use

- Starting initial information gathering for new features, projects, or major changes.
- Requirements are ambiguous and it's unclear which skill to start with.
- As briefing phase delegate when invoked from `doc-driven-dev-flow`.
- Standalone when you want to organize information before writing spec-doc / adr-doc.
- Starting any information gathering work — invoke this skill FIRST to configure.

## The Rule

**Before writing spec-doc / adr-doc, complete the Assess and Configure phases below.**
If available skills apply to what you are about to do, you must use them.
This is not optional. You cannot rationalize your way out of this.

---

## Flow Phases

```text
Phase A: Assess  →  Phase B: Configure  →  Phase C: Gather & Generate  →  Phase D: Gate
```

| Phase | Purpose | Output |
| ----- | ------- | ------ |
| A. Assess | Understand the request, determine information state | Entry Decision recorded + characteristics identified |
| B. Configure | Discover skills, build/load skill stack for briefing | Active skill stack declared |
| C. Gather & Generate | Gather information and produce documents in parallel | spec-doc + adr-doc generated |
| D. Gate | Verify completion conditions, confirm readiness for next phase | Gate pass/fail decision |

---

## Phase A: Assess

Receive a request or problem and determine information state:

1. **Understand the request** — identify purpose, background, constraints, stakeholders.
2. **Classify information state** — use the Entry Decision table to determine path:

| Question | If Yes → | If No → |
| -------- | -------- | ------- |
| Can you clearly explain the problem in one sentence? | Continue | A-1 (Problem Framing) |
| Is there a direction but trade-off analysis is needed? | A-2 (Option Framing) | Continue |
| Can you write acceptance criteria right now? | A-4 (Direct Start) | A-1 or A-2 |
| Do multiple information sources need convergence? | A-3 (Combined Discovery) | Single path |
| Is external information research needed? | A-5 (Research Required) | Internal info sufficient |

1. **Record Entry Decision** — document the chosen path and reason in one line.

### Entry Decision Paths

- **A-1. Problem Framing** — Problem is ambiguous → use Frame-category skills to structure the problem definition.
- **A-2. Option Framing** — Direction exists but trade-offs unclear → use Frame-category skills to organize alternatives.
- **A-3. Combined Discovery** — Multiple skills needed → dynamically select from briefing-profile skill stack.
- **A-4. Direct Documentation Start** — Requirements are clear → fire Phase C dispatch triggers immediately (document one-line reason).
- **A-5. Research Required** — External research needed → prioritize Discover/Research-category skills.

These are **choices**, not a sequence. Select based on information sufficiency.
Even when A-4 is chosen, Phase B (Configure) is NOT skipped — Document-category skill configuration is still needed.

**Check for Profile:** Check for `.sdp/briefing-flow-default/briefing-profile.json` under the repository `.sdp` directory.

> **What is `.sdp/briefing-flow-default/briefing-profile.json`?**
> A repository-specific configuration file (JSON) that lists all skills available for
> briefing, assigns them to categories, defines flow stack slots and activation rules,
> and specifies invocation resolution. Generated and refreshed through the
> `skill-discovery-protocol` skill using this flow's adapter file, then
> validated as part of that workflow.

- If it exists and is valid → go to Phase B (Configuration from Profile).
- If it does not exist → invoke `skill-discovery-protocol` and pass the adapter path `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- If it exists but is stale/corrupted → invoke `skill-discovery-protocol` again with the same adapter path to regenerate it

---

## Skill Discovery Protocol

Profile generation and validation is handled by the `skill-discovery-protocol` skill.

When invoking it from this flow, provide:

- Adapter path: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- Expected profile path: `.sdp/briefing-flow-default/briefing-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`

After the skill creates or refreshes the artifacts, inspect
`.sdp/skill-reference-inferences.json` against the scan list. If `provides` or
`uses` are incomplete for task routing, re-invoke `skill-discovery-protocol`
with the same adapter path and request an inference update before using the
profile.

See [skill-discovery-protocol](../skill-discovery-protocol/SKILL.md) for full details.

---

## Phase B: Configure

With `.sdp/briefing-flow-default/briefing-profile.json` available:

1. **Load flow stack**: use `skill-discovery-protocol` to read `flow-stack` from `.sdp/briefing-flow-default/briefing-profile.json`
2. **Apply Entry Decision activation**: Based on Phase A path, prioritize categories:
   - A-1/A-2 → Prioritize frame-category skills
   - A-3 → Activate matching skills across categories
   - A-5 → Prioritize discover/research-category skills
   - **If no matching slots:** Proceed with default stack only.
3. **Check resolution**: use `skill-discovery-protocol` to read `resolution` from `.sdp/briefing-flow-default/briefing-profile.json`
4. **Check execution policy**: use `skill-discovery-protocol` to read `execution-policy` for each candidate skill from `.sdp/briefing-flow-default/briefing-profile.json`
5. **Read runtime guidance**: use `skill-discovery-protocol` to read structured `runtime_guidance` after policy checks; treat it as a soft ranking signal, not a hard gate
6. **Announce the active skill stack:**

```text
ACTIVE SKILL STACK FOR THIS BRIEFING:
1. [Category] skill-name — reason
2. [Category] skill-name — reason
3. [Category] skill-name — reason
→ Proceeding with this configuration.
```

**Priority order for execution:**

| Priority | Category | Rationale |
| -------- | -------- | --------- |
| 1 | Frame | Structure problem/options before gathering information |
| 2 | Discover | Explore and find external information |
| 3 | Research | Conduct deep-dive investigation |
| 4 | Validate | Verify accuracy and completeness of gathered information |
| 5 | Document | Formalize organized information into official documents |

For detailed category definitions, see the adapter's `classification.taxonomy` in `assets/adapters/briefing-adapter.yaml`.

---

## Phase C: Gather & Generate

Gather information and produce documents in parallel. Dispatch to sub-agents
immediately when sufficient information is gathered, preventing context freshness
(detail level) degradation.

### Information Gathering

Apply each skill in the active stack according to its priority:

1. Follow each skill's own process (read the skill's SKILL.md).
2. Check the skill's **execution mode** from the profile:
   - **Rigid skills**: Follow exactly; do not skip or reorder steps.
   - **Flexible skills**: Apply the spirit; adapt to context.
3. Skills layer — they are not exclusive. Multiple skills apply simultaneously.

### Dispatch Triggers

In parallel with information gathering, dispatch to sub-agents when conditions are met:

| Trigger | Fire Condition | Action |
| ------- | -------------- | ------ |
| spec-doc | Purpose, scope, acceptance criteria, and exclusions are available | Spawn sub-agent and delegate `spec-doc` skill |
| adr-doc | Chosen approach, alternatives, rationale, and impact are available | Spawn sub-agent and delegate `adr-doc` skill |

**Dispatch principles:**

- **Do not wait for both.** Fire whichever trigger is ready first.
- Information gathering continues after dispatch (non-blocking).
- Both skills can be dispatched independently — concurrent execution is fine.
- Information passed at dispatch must include **raw collection results at that point**. Do not degrade through summarization.
- Sub-agents follow each skill's workflow to produce the document.

### Stop Conditions

Phase C iterates until ALL of the following stop conditions are met:

- For key use cases, input/processing/expected results can be explained.
- Critical constraints (technical, operational, timeline, quality) are made explicit.
- Open items are classified as "pre-implementation blocker" or "manageable downstream".
- `spec-doc` has been generated (sub-agent has completed).
- `adr-doc` has been generated (sub-agent has completed).

If stop conditions are not met:

1. Articulate missing information as explicit questions.
2. Resolve using appropriate Discover/Research/Frame skills.
3. Reflect results and re-evaluate stop conditions.

### Late-arriving Information

If additional information is obtained after dispatch, reflect it as document supplements before Phase D (Gate).

---

## Phase D: Gate

Briefing is NOT complete until ALL of the following conditions are met:

### Completion Checklist

- [ ] `spec-doc` exists with `status:` ≥ `proposed` (`draft` cannot pass)
- [ ] `spec-doc` has at least 1 `acceptance_criteria:` entry
- [ ] `adr-doc` exists with at least 2 `alternatives:`
- [ ] Entry Decision (A-1/A-2/A-3/A-4/A-5) selection is recorded
- [ ] No open items classified as "pre-implementation blocker" remain unresolved
- [ ] Both documents reference the same problem context

### Actions on Gate Failure

- spec-doc incomplete → return to Phase C and re-fire dispatch trigger.
- Insufficient information to write spec → return to Phase C for additional gathering.
- adr-doc alternatives insufficient → return to Phase C using Frame/Discover skills to expand options.
- Gate passes → declare briefing complete and signal readiness for next phase (Design).

---

## Loopback Rules

### Phase C → Phase A (Information State Change)

If fundamental change in information state is discovered during execution:

1. Record: "info-shift: [description]"
2. Re-evaluate Entry Decision.
3. If needed, reconfigure skill stack (return to Phase B).

### Phase D → Phase C (Document Quality Gap)

If documents fail to meet gate criteria:

1. Record: "doc-gap: [description]"
2. If information is insufficient, re-run gathering and re-fire dispatch triggers.

---

## Hard Gates

The following are **invariants active throughout all phases**.
When a violation is detected, STOP immediately and address it.

<HARD-GATE>
Do not skip profile-based configuration.
- If profile does not exist → invoke `skill-discovery-protocol` with `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`.
- If profile exists → load it and follow its configuration.
"Requirements are clear enough to skip" and "I know this pattern" are the most
common failure patterns. They defeat systematic skill routing.
</HARD-GATE>

<HARD-GATE>
Do not declare briefing complete until spec-doc `status` is `proposed` or above.
Passing through with `draft` status is not allowed. A spec without acceptance
criteria cannot serve as a foundation for planning.

**Why:** Incomplete Phase 1 output causes 40% of Phase 3-4 redesigns.
</HARD-GATE>

<HARD-GATE>
Even in urgent fix scenarios, leave at minimum a spec-doc or adr-doc as
evidence before proceeding to the next phase.

**Why:** Urgent fixes without evidence become permanent technical debt.
Minimum evidence takes 10 minutes; debugging mystery code takes hours.
</HARD-GATE>

<HARD-GATE>
Do not skip using skills that the profile indicates should apply. If the active
skill stack includes a skill, you must follow that skill's process.
Override requires explicit user instruction.
</HARD-GATE>

---

## Anti-patterns

These thoughts and behaviors signal failure — STOP when you notice them:

| Anti-pattern | Why it fails |
| ------------ | ------------ |
| "Requirements are clear, no need to organize" | Implicit assumptions surface later as contradictions |
| "I already know how to do this" | The profile reveals overlooked information sources |
| "Research later, write first" | Spec from insufficient info causes rework during implementation |
| "This skill doesn't apply here" | If profile says it applies, follow it |
| "Acceptance criteria can be added later" | Spec without criteria produces unverifiable plans |
| "Alternatives are obvious" | ADR with only one option has no decision rationale |
| "Spending too much time on briefing" | Stop when stop conditions are met. Continue until they are |
| "It's urgent, skip the spec" | Minimum evidence is 10 minutes. Skipping costs hours to days |
