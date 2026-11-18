---
name: implementation-flow
description: "Orchestrates code implementation by discovering and routing to available skills. Use when: executing task-doc entries, starting implementation work, coordinating multiple skills. Generates .sdp/implementation-flow-default/implementation-flow-profile.json. Keywords: implementation, task-doc, skill stack, code changes."
license: MIT
---

# Implementation Flow

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task with explicit
skill instructions, skip this meta skill and follow your dispatch instructions.
</SUBAGENT-STOP>

Orchestrates code implementation by dynamically discovering and routing to the
skills that the active profile marks as applicable in the current environment.
This is the **implementation phase orchestrator** — it determines which skills
apply, configures the skill stack per task, and enforces verification before
progression.

This is a **meta skill**: it produces no code directly. Instead it governs
skill discovery, configuration, sequencing, and the verification loop that
connects implementation back to upstream documents.

Under Document Registry 3 `task` is execution-bound (`persistence:
ephemeral`) — `task-doc` creation steps below describe Execution Store
records, not durable Git documents. The `impl-doc` Implementation Record
and Experiment Log formats are legacy migration-only types:
`new_impl_record.js` / `new_experiment_log.js` refuse at the registry gate,
and the phases that mention them describe the pre-v3 evidence contract that
migration tooling reads. Durable verification evidence is recorded by
`verification-doc` under `docs/verification`; durable findings consolidate
conditionally through `knowledge-doc`.

## When to Use

- Executing approved `task-doc` entries that require code changes.
- Implementing a plan where multiple skills must coordinate.
- As implementation delegate when invoked from `doc-driven-dev-graph`.
- Standalone when documents already exist and implementation guidance is needed.
- Starting implementation work that needs profile-based routing or multiple
  skills.

## The Rule

**Before writing any code, complete the Assess and Configure phases below.**
Complete the profile-based assessment and configuration first. Treat
profile-selected skills as the default routing policy, allow explicit user
overrides, and record a one-line reason for any non-default routing decision.

---

## Flow Phases

```text
Phase A: Assess  →  Phase B: Configure  →  Phase C0: Implementation Documentation (conditional)  →  Phase C: Execute  →  Phase D: Verify  →  Phase E: Review
```

| Phase | Purpose | Output |
| ----- | ------- | ------ |
| A. Assess | Understand task, check for `.sdp/implementation-flow-default/implementation-flow-profile.json` | Task characteristics identified |
| B. Configure | Discover skills, build/load skill stack for this task | Active skill stack declared |
| C0. Implementation Documentation | Conditional documentation path — no forced pre-change record under Registry 3 | Documentation decision recorded |
| C. Execute | Apply skills in priority order | Code changes implemented |
| D. Verify | Confirm task passes verification conditions | Evidence of correctness |
| E. Review | Submit for review, address feedback | Review complete |

---

## Phase A: Assess

For each task unit:

1. **Read the task** — understand requirements, constraints, and verification conditions. When the task links test specs via `relations.verified-by`, read them: they record the guarantees the implementation must preserve.
2. **Classify the task** — identify characteristics:
   - Is this a bug fix or test failure?
   - Does this involve a framework or library?
   - Does this touch multiple files or systems?
   - Are there non-trivial architectural decisions?
   - Can subtasks run in parallel?
   - Can subtasks be delegated to fresh subagents with isolated context?
   - Is any task simple, mechanical, low-risk, and suitable for a lower-cost execution path when the current harness exposes one?
   - What language/platform is involved?
   - Is the approach uncertain or exploratory — multiple viable solutions to compare?

**Task Characteristics → Skill Activation Mapping:**

| If the task... | Then activate... | Category |
| -------------- | ---------------- | -------- |
| Is a bug fix or test failure | Debugging/diagnosis skills | Process |
| Involves framework/library APIs | Official docs verification skills | Verify |
| Has multiple alternative approaches | Adversarial review skills | Verify |
| Touches multiple files | Incremental implementation skills | Build |
| Can be broken into independent subtasks | Parallel dispatch skills | Build |
| Can be delegated to isolated subagents | Subagent dispatch skills | Build |
| Is simple, mechanical, low-risk work | Cost-optimization guidance skills | Tooling |
| Involves specific language/platform | Language-specific conventions | Domain |
| Requires git operations or CI | Tool-specific workflow skills | Tooling |
| Is ready for completion | Code review skills | Review |

This mapping is a general framework. The invocation resolution in `.sdp/implementation-flow-default/implementation-flow-profile.json` is
the repository-specific instantiation of this mapping, specifying concrete skill names and conditions.

**Check for Profile:** Check for `.sdp/implementation-flow-default/implementation-flow-profile.json` under the repository `.sdp` directory.

> **What is `.sdp/implementation-flow-default/implementation-flow-profile.json`?**
> A repository-specific configuration file that lists all available skills,
> assigns them to categories, defines which are always-on vs conditional,
> and specifies the flow stack plus invocation resolution. Generated and
> refreshed through the `skill-discovery-protocol` skill using this flow's
> adapter file, then updated when skills change.

- If it exists and is valid → go to Phase B (Configuration from Profile).
- If it does not exist → invoke `skill-discovery-protocol` and pass the adapter path `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`.
- If it exists but is corrupted, stale, or missing required inference fields → invoke `skill-discovery-protocol` again with the same adapter path to regenerate it.

---

## Skill Discovery Protocol

Profile generation and validation is handled by the `skill-discovery-protocol` skill.

When invoking it from this flow, provide:

- Adapter path: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Expected profile path: `.sdp/implementation-flow-default/implementation-flow-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`

After the skill creates or refreshes the artifacts, inspect
`.sdp/skill-reference-inferences.json` against the scan list. If `provides` or
`uses` are incomplete for task routing, re-invoke `skill-discovery-protocol`
with the same adapter path and request an inference update before using the
profile.

See [skill-discovery-protocol](../skill-discovery-protocol/SKILL.md) for full details.

If you need to refresh or compare the repository-specific profile skeleton, load
[`assets/templates/implementation-profile-template.md`](assets/templates/implementation-profile-template.md)
before editing template-driven sections. Do not load it for normal execution.

**Staged loading:** resolve the profile first, then load `SKILL.md` bodies only
for skills the profile marks applicable, then load references and scripts only
when the active step needs them — see
[progressive-loading-contract](../skill-discovery-protocol/references/progressive-loading-contract.md).

---

## Phase B: Configure

With `.sdp/implementation-flow-default/implementation-flow-profile.json` available:

1. **Load flow stack**: use `skill-discovery-protocol` to read `flow-stack` from `.sdp/implementation-flow-default/implementation-flow-profile.json`
2. **Check resolution**: use `skill-discovery-protocol` to read `resolution` from `.sdp/implementation-flow-default/implementation-flow-profile.json`
3. **Check execution policy**: use `skill-discovery-protocol` to read `execution-policy` for each candidate skill from `.sdp/implementation-flow-default/implementation-flow-profile.json`
4. **Read runtime guidance**: use `skill-discovery-protocol` to read structured `runtime_guidance` after policy checks; treat it as a soft ranking signal, not a hard gate
5. **Evaluate capability slots**:
   - `subagent_utilization`: activate when independent subtasks can run with isolated context and clear acceptance checks.
   - `cost_optimization`: activate when the task is simple, mechanical, low-risk, and a lower-cost model or delegation path can still use the required tools.
   - Treat both as routing guidance. They do not override user instructions, hard gates, required tools, or verification evidence.
6. **Resolve conflicts** — multiple skills in same category activated:
   - More specific condition wins over general (e.g., "TypeScript file" > "any file").
   - Explicit profile rule wins over inferred activation.
   - If still tied, apply both (skills layer, they don't exclude).
7. **Add Domain/Tooling skills** — based on language, framework, platform detected in task.
   - **If no resolution overrides match:** Proceed with flow stack defaults only. Announce "Additional skills: none".
   - **If `GraphRoute.commitGate` is true:** a commit-capable Tooling skill
     (for example `git-commit`) is mandatory in the active stack; record the
     selection in the announced stack.
8. **Announce the active skill stack:**

```text
ACTIVE SKILL STACK FOR THIS TASK:
1. [Category] skill-name — reason
2. [Capability Slot] subagent_utilization — reason or "not active"
3. [Capability Slot] cost_optimization — reason or "not active"
4. [Category] skill-name — reason
→ Proceeding with this configuration.
```

**Priority order for execution:**

| Priority | Category | Rationale |
| -------- | -------- | --------- |
| 1 | Process | Must diagnose/plan before building |
| 2 | Build | Structures the implementation work |
| 3 | Domain | Language/framework constraints apply during build |
| 4 | Verify | Validates against authoritative sources |
| 5 | Tooling | Tool-specific steps integrate into workflow |
| 6 | Review | Post-implementation quality gate |

**Category examples:**

- **Process**: `debugging-and-error-recovery`, `planning-and-task-breakdown`
- **Build**: `test-driven-development`, `incremental-implementation`
- **Domain**: `typescript-conventions`, `react-patterns`
- **Verify**: `source-driven-development`, `api-and-interface-design`
- **Tooling**: `git-commit`, `ci-cd-automation`
- **Review**: `requesting-code-review`, `code-review-and-quality`

For detailed category definitions, see the adapter's `classification.taxonomy` in `assets/adapters/implementation-adapter.yaml`.

---

## Phase C0: Implementation Documentation (conditional)

Under Registry 3 the always-on generation contract is abolished: **no
Implementation Record or Experiment Log is opened before code changes** —
`new_impl_record.js` / `new_experiment_log.js` refuse at the registry gate,
and a normal implementation change completes with no IR, no EXP, and no
forced Knowledge document.

1. Run no documentation step by default — execution notes live in the run's
   Execution Store records and diagnostic trace, not in durable Git docs.
2. When the task surfaces durable findings (why-designed-so, recurrence
   prevention, confirmed constraints, confirmed properties), consolidate
   them through `knowledge-doc` before close-out — the assess→decision→apply
   contract is in the **Implementation Documentation** section below;
   `none` is a valid outcome.
3. Unorganized important findings — conflicts unreviewed, or durable
   knowledge identified but not persisted — are reported to the run's exit
   gate, not silently dropped.

The pre-v3 evidence contract this phase used to describe (one in-progress
ir per task, opened before the first code change) is the migration-readable
corpus shape documented in `impl-doc`; it is not a creation instruction for
normal runs.

---

## Phase C: Execute

### Graph handoff contract

When `doc-driven-dev-graph` delegates a Task Graph, treat that projection as
the authoritative handoff:

- Always fail closed without dispatch when `taskGraph.issues` is non-empty.
- When `GraphRoute.condition` is `tasks-active`, consume exactly
  `taskGraph.resumableActive`; fail closed if it is empty, and never start or
  resume an `active` task absent from that list.
- When `GraphRoute.condition` is `tasks-runnable`, consume `taskGraph.runnable`
  even if unresolved active work exists, without changing that active task's ID
  or status.
- Preserve stable task IDs and statuses; do not rewrite either to manufacture
  eligibility.
- Use `taskGraph.edges` to order dependent work, and parallelize only work that
  those dependency edges show is independent.

**Parallel delegation**: dependency independence is necessary but not
sufficient for parallel dispatch. Parallelize slices only when the `scope`
fields on their Execution Store task records are verifiably disjoint — see
[references/parallel-delegation-contract.md](references/parallel-delegation-contract.md)
for eligibility, isolation, merge-verification, and fallback rules. Serial
execution is always the default fallback; never guess a scope. The slice's
own task record and its declared evidence in the run's Execution Store need
no scope declaration; another task's record is never writable.

Apply each skill in the active stack according to its priority:

1. Follow each skill's own process (read the skill's SKILL.md).
2. Check the skill's **execution mode** from the profile:
   - **Rigid skills**: Follow exactly; do not skip or reorder steps.
     Example: `git-commit` (conventional commit format must be followed)
   - **Flexible skills**: Apply the spirit; adapt to context.
   Example: `code-review-and-quality` (review depth can be prioritized per task)

   Use `skill-discovery-protocol` to inspect `execution-policy` for the skill in the generated profile.
3. Skills layer — they are not exclusive. Multiple skills apply simultaneously.
4. Working notes live in the run's Execution Store records — not in a durable
   document. Only when durable findings emerge do they pass to `knowledge-doc`
   through the consolidation path described below.

---

## Phase D: Verify

A task is NOT complete until verification passes:

1. Confirm the task passes its defined verification conditions.
2. Satisfy Hard Gate #1 (EVIDENCE requirement) — record evidence before proceeding.
3. Record evidence in the run's Execution Store trace and close out any
   durable findings through `knowledge-doc` consolidation (see
   **Implementation Documentation** below).
4. If verification fails → diagnose using Process-category skills, fix, re-verify.

---

## Phase E: Review

**Review Gate Contract**: See [references/review-gate-contract.md](references/review-gate-contract.md) for canonical review skill binding.

1. Submit implementation for review using the canonical review skill: `requesting-code-review` (see contract).
2. Address feedback systematically.
3. Record any new constraints discovered during review.

---

## Implementation Documentation

Under Registry 3 the implementation phase is not required to produce any
downstream document. IR/EXP creation is no longer part of the flow — the
pre-v3 `docs/impl/` corpus is a migration input only (see `impl-doc`).
What a run produced is a diagnostic trace in the Execution Store, and a
normal fix completes with zero new durable documents.

Durable findings are extracted conditionally through `knowledge-doc` —
Knowledge is not used as a replacement impl-log. Consolidate only when the
run yielded lasting knowledge: why something was designed or fixed a certain
way, recurrence prevention, confirmed constraints, or confirmed properties
from investigation. Timelines, command logs, and chat-like work records are
never extracted.

When findings qualify:

```bash
node ../knowledge-doc/scripts/consolidate_knowledge.js assess --title "<finding>" --kind codebase
```

1. `assess` screens existing Knowledge plus Spec/Design/ADR and reports
   candidates and conflicts (the relative script path resolves against the
   installed skill directory).
2. Exactly one decision applies — `integrate` into an existing Knowledge
   document (preferred), `route` to the owning spec/design/ADR skill,
   `create` after explicit conflict acknowledgement, or `none`.
3. Every persist path records extraction source (`--from`) and evidence
   basis (`--basis`); unverified guesses stay `draft`, never `confirmed`.

Unorganized important findings — durable knowledge identified but not
persisted, or unreviewed conflicts — are surfaced to the run's exit gate
rather than silently dropped.

See the [`knowledge-doc` SKILL](../knowledge-doc/SKILL.md) and its
[extraction contract](../knowledge-doc/references/knowledge-extraction.md)
for the full decision contract, and the
[`impl-doc` SKILL](../impl-doc/SKILL.md) for the legacy corpus contract that
migration tooling reads.

---

## Hard Gates

The following are **invariants active throughout all phases**.
When a violation is detected, STOP immediately and address it.

<HARD-GATE>
Verification requires EVIDENCE, not confidence. Acceptable evidence:
- Test suite passes (show command + output)
- Build completes (show command + exit code)
- Runtime behavior verified (show data/screenshot/log)
"It works" without evidence is NOT verification.
Do not proceed to the next task until evidence is recorded.
</HARD-GATE>

<HARD-GATE>
If implementation reveals errors or gaps in spec or design, suspend
implementation and feed back to the appropriate upstream document.
Record the loopback with a one-line reason.
</HARD-GATE>

<HARD-GATE>
Do not skip profile-based configuration when implementation work depends on
skill routing.
- If profile does not exist → invoke `skill-discovery-protocol` with `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`.
- If profile exists → load it and follow its configuration.
"This is simple enough to skip" and "I know what to do" are the most common
failure patterns. They defeat systematic skill routing.
</HARD-GATE>

<HARD-GATE>
Documentation is never forced by this flow — but consolidation decisions are
explicit, not silent.
- No Implementation Record or Experiment Log is opened; `impl`/`exp` mutators
  refuse at the registry gate.
- When durable findings exist, run
  `node ../knowledge-doc/scripts/consolidate_knowledge.js assess` and apply
  exactly one decision before close-out; `none` is valid only when nothing
  qualifies.
- Important findings left unorganized (unreviewed conflicts, knowledge
  identified but not persisted) are reported to the exit gate.
</HARD-GATE>

<HARD-GATE>
Treat profile-selected skills as the default routing policy. If the active
skill stack includes a skill, follow that skill's process unless the user
explicitly overrides the routing decision. Record a one-line reason for any
dispatch-specific override, emergency override, or other non-default routing.
</HARD-GATE>

<HARD-GATE>
When the dispatching `GraphRoute` declares `commitGate`, a task slice is not
`completed` while its logical changes remain uncommitted. Commit through the
resolved commit tooling (`git-commit` when selected by the profile, otherwise
the repository's commit conventions); if committing is outside granted
authority, return `yield`/`commit-required` instead of `completed`.
</HARD-GATE>

---

## Anti-patterns

These thoughts and behaviors signal failure — STOP when you notice them:

| Anti-pattern | Why it fails |
| ------------ | ------------ |
| "Too simple for skill configuration" | Configuration prevents unanticipated mistakes |
| "I already know how to do this" | The profile ensures nothing is missed |
| "I'll configure after I start" | Configuration BEFORE execution. Always |
| "This skill doesn't apply here" | If profile says it applies, treat it as the default unless an override is recorded |
| "I'll clean up adjacent code" | Stay within task boundaries. File separate task |
| "Verification is obvious" | Show evidence: tests, build output, runtime data |
| "No review needed for small change" | Every task gets Review-category skills. No exceptions |
| "Let me do it all at once" | Incremental execution. One slice at a time |
| Big-bang implementation | Change many files at once → unverifiable. Each slice must be independent |
| Assumption-driven coding | Implement from memory → verify against upstream docs instead |
| Silent reinterpretation | Implementing differently without feeding back discrepancy |
| Over-engineering | Building what task doesn't require |
| Ignoring loopback signals | Continuing when spec/design gaps are apparent |
| Confidence without evidence | "It works" without passing tests or verified data |
| "Missing task scope is fine" | Undeclared write scope forces serial — parallel scope is never guessed |

---

## Entry Conditions

- Task units with defined verification conditions exist (`task-doc` or equivalent).
- When invoked from `doc-driven-dev-graph`, the planning node is complete and its tasks are approved.

## Completion Conditions

- All task units are implemented.
- Each task passes its defined verification conditions.
- New constraints discovered during implementation are reflected in upstream documents.
- Review-category skills have been applied (code review complete).
- The consolidation decision for implementation findings is explicit:
  durable knowledge is integrated/created with recorded source and evidence,
  routed to the owning document skill, or consciously `none`; important
  unorganized findings are surfaced to the exit gate.
- No `impl`/`exp` documents are created — they are legacy migration-only
  formats under Registry 3.
- Close-out regenerated the owning directory indexes in the same change
  (`doc_maintenance.js index plan|apply`): settled rows move to the
  `## Settled` tier; `doc_status lint` reports stale indexes until then.

## Loopback Rules

- Task reveals spec insufficiency → feed back to spec/design owner; suspend that task.
- Test failure unresolvable within task scope → invoke Process-category skills.
- Multiple independent tasks are blocked → consider parallel execution skills.
- Implementation contradicts ADR constraints → update ADR or change approach.
- Record each loopback with a one-line reason.

---

## Instruction Priority

1. **User's explicit instructions** (AGENTS.md, direct requests) — highest priority.
2. **This skill and invoked workflow skills** — override default behaviors.
3. **Default system prompt** — lowest priority.

If the user says "skip configuration for this task", follow the user and
record that override. The user has authority. Without an override, use the
profile-selected routing as the default.

## Graph Effect Outcome

When `doc-driven-dev-graph` invokes this skill, return exactly the
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.md)
after each audit or delegate effect; do not create a local partial variant.

Use `completed` only for a verified task slice whose logical changes are
committed and whose consolidation decision was explicit (persist, route, or
`none`), `retry` for declared spec/design/constraint repair, `yield` with
`commit-required` when the slice produced changes that cannot be committed
within granted authority, `yield` with `authority-required` for an
irreversible effect without permission, and `yield` with
`unrecoverable-blocker` when no declared safe repair exists. The required
`edgeId`, stage, effect identity, authoritative input scope, and proof
fields are defined by that footer.
