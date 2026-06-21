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

## When to Use

- Executing approved `task-doc` entries that require code changes.
- Implementing a plan where multiple skills must coordinate.
- As implementation phase delegate when invoked from `doc-driven-dev-lifecycle`.
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
Phase A: Assess  →  Phase B: Configure  →  Phase C0: Open Implementation Documentation  →  Phase C: Execute  →  Phase D: Verify  →  Phase E: Review
```

| Phase | Purpose | Output |
| ----- | ------- | ------ |
| A. Assess | Understand task, check for `.sdp/implementation-flow-default/implementation-flow-profile.json` | Task characteristics identified |
| B. Configure | Discover skills, build/load skill stack for this task | Active skill stack declared |
| C0. Open Implementation Documentation | Open the Implementation Record before code changes begin | In-progress implementation documentation |
| C. Execute | Apply skills in priority order | Code changes implemented |
| D. Verify | Confirm task passes verification conditions | Evidence of correctness |
| E. Review | Submit for review, address feedback | Review complete |

---

## Phase A: Assess

For each task unit:

1. **Read the task** — understand requirements, constraints, and verification conditions.
2. **Classify the task** — identify characteristics:
   - Is this a bug fix or test failure?
   - Does this involve a framework or library?
   - Does this touch multiple files or systems?
   - Are there non-trivial architectural decisions?
   - Can subtasks run in parallel?
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

---

## Phase B: Configure

With `.sdp/implementation-flow-default/implementation-flow-profile.json` available:

1. **Load flow stack**: use `skill-discovery-protocol` to read `flow-stack` from `.sdp/implementation-flow-default/implementation-flow-profile.json`
2. **Check resolution**: use `skill-discovery-protocol` to read `resolution` from `.sdp/implementation-flow-default/implementation-flow-profile.json`
3. **Check execution policy**: use `skill-discovery-protocol` to read `execution-policy` for each candidate skill from `.sdp/implementation-flow-default/implementation-flow-profile.json`
4. **Read runtime guidance**: use `skill-discovery-protocol` to read structured `runtime_guidance` after policy checks; treat it as a soft ranking signal, not a hard gate
5. **Resolve conflicts** — if multiple skills in the same category are activated:
   - More specific condition wins over general (e.g., "TypeScript file" > "any file").
   - Explicit profile rule wins over inferred activation.
   - If still tied, apply both (skills layer, they don't exclude).
6. **Add Domain/Tooling skills** — based on language, framework, platform detected in task.
   - **If no resolution overrides match:** Proceed with flow stack defaults only. Announce "Additional skills: none".
7. **Announce the active skill stack:**

```text
ACTIVE SKILL STACK FOR THIS TASK:
1. [Category] skill-name — reason
2. [Category] skill-name — reason
3. [Category] skill-name — reason
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

## Phase C0: Open Implementation Documentation

Before the first code change for each task, open implementation documentation
through `impl-doc`.

1. Create or reuse an in-progress Implementation Record for the task unit.
2. Use `impl-doc` conventions and title/task linkage so downstream audits can
   trace the work.
3. If Phase A marked the approach as exploratory, also create an Experiment Log
   before the relevant experiment starts.
4. Record the Implementation Record path in your working notes or status stream
   before editing code.

Example command:

```bash
node scripts/new_impl_record.js --title "Wire checkout button" --task docs/tasks/0001-wire-checkout-button.md --status "in-progress"
```

Known-solution work does not skip this phase. The Implementation Record is
opened before code changes begin; only the Experiment Log remains optional when
the task is mechanical.

---

## Phase C: Execute

Apply each skill in the active stack according to its priority:

1. Follow each skill's own process (read the skill's SKILL.md).
2. Check the skill's **execution mode** from the profile:
   - **Rigid skills**: Follow exactly; do not skip or reorder steps.
     Example: `git-commit` (conventional commit format must be followed)
   - **Flexible skills**: Apply the spirit; adapt to context.
   Example: `code-review-and-quality` (review depth can be prioritized per task)

   Use `skill-discovery-protocol` to inspect `execution-policy` for the skill in the generated profile.
3. Skills layer — they are not exclusive. Multiple skills apply simultaneously.
4. Keep the in-progress Implementation Record current while implementation is
   underway. Capture key decisions, scope adjustments, and links to any
   experiment evidence as the task evolves instead of reconstructing them after
   the fact.
5. **If the approach is exploratory**, capture hypotheses, observations, and
   rejected attempts in an Experiment Log *as they happen* via `impl-doc` (see the
   **Implementation Documentation** section).

---

## Phase D: Verify

A task is NOT complete until verification passes:

1. Confirm the task passes its defined verification conditions.
2. Satisfy Hard Gate #1 (EVIDENCE requirement) — record evidence before proceeding.
3. Add verification evidence and final status notes to the Implementation
   Record before closing the task.
4. If verification fails → diagnose using Process-category skills, fix, re-verify.

---

## Phase E: Review

**Review Gate Contract**: See [references/review-gate-contract.md](references/review-gate-contract.md) for canonical review skill binding.

1. Submit implementation for review using the canonical review skill: `requesting-code-review` (see contract).
2. Address feedback systematically.
3. Record any new constraints discovered during review.

---

## Implementation Documentation

The implementation phase produces two downstream documents through the `impl-doc`
skill. Recording them is part of the flow, not an optional add-on. When this flow
runs under `doc-driven-dev-lifecycle`, `docs/impl/ir/` and `docs/impl/exp/` already
exist (bootstrap contract); securing these records is a completion duty.

- **Experiment Log (`docs/impl/exp/`)** — create when Phase A flagged the approach
  as uncertain or exploratory. Capture hypotheses, observations, and rejected
  attempts *as they happen* during Phase C. Skip it for mechanical tasks with a
  known solution.
- **Implementation Record (`docs/impl/ir/`)** — create or reuse one per task
  unit in Phase C0 before the first code change. Keep it in `in-progress`
  status during Phase C, then complete and audit it during Phase D/E. Record
  what was implemented, decisions made during implementation, verification
  evidence, and which experiments were adopted or rejected. When an Experiment
  Log exists, the record MUST reference it.

See the [`impl-doc` SKILL](../impl-doc/SKILL.md) for creation commands, conventions,
and the audit steps to run before reporting completion.

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
Code changes cannot start until Phase C0 opens implementation documentation.
Implementation Record is opened before code changes begin.
- Create or reuse the Implementation Record through `impl-doc`.
- Keep it `in-progress` while implementing.
- Complete and audit it before task closure.
Even when the solution is already known, the Implementation Record is required;
only the Experiment Log may be skipped.
</HARD-GATE>

<HARD-GATE>
Treat profile-selected skills as the default routing policy. If the active
skill stack includes a skill, follow that skill's process unless the user
explicitly overrides the routing decision. Record a one-line reason for any
dispatch-specific override, emergency override, or other non-default routing.
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

---

## Entry Conditions

- Task units with defined verification conditions exist (`task-doc` or equivalent).
- When invoked from `doc-driven-dev-lifecycle`, Phase 4 tasks are approved.

## Completion Conditions

- All task units are implemented.
- Each task passes its defined verification conditions.
- New constraints discovered during implementation are reflected in upstream documents.
- Review-category skills have been applied (code review complete).
- An Implementation Record (`impl-doc` ir) is opened before code changes begin
  for each task unit.
- Each Implementation Record is completed and audited before task closure,
  referencing and auditing any Experiment Logs (exp) created during
  implementation.

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
