---
name: implementation-flow
description: "Meta skill that orchestrates code implementation by routing tasks to the appropriate workflow skills. Provides skill discovery, priority ordering, core behaviors, and verification loops for the implementation phase."
license: MIT
---

# Implementation Flow

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task with explicit
skill instructions, skip this meta skill and follow your dispatch instructions.
</SUBAGENT-STOP>

Orchestrates code implementation by discovering and routing to the appropriate
workflow skills per task unit. This is the **implementation phase dispatcher** —
it determines *which* skill to invoke, in *what order*, and enforces
verification before progression.

This is a **meta skill**: it produces no code directly. Instead it governs
skill selection, sequencing, and the verification loop that connects
implementation back to upstream documents.

## When to Use

- Executing approved `task-doc` entries that require code changes.
- Implementing a plan where multiple workflow skills must coordinate.
- As Phase 5 delegate when invoked from `doc-driven-dev-flow`.
- Standalone when documents already exist and implementation guidance is needed.
- Starting any implementation work — invoke this skill FIRST to route correctly.

## The Rule

**Before writing any code, route through Skill Discovery below.** If a workflow
skill applies to what you are about to do, you must use it. This is not
optional. You cannot rationalize your way out of this.

---

## Skill Discovery

When a task arrives for implementation, route through this decision tree:

```text
Task arrives for implementation
    │
    ├── Bug fix or test failure? ───────────→ systematic-debugging (FIRST)
    │       then → test-driven-development (guard against regression)
    │
    ├── Multiple independent tasks/failures? → dispatching-parallel-agents
    │       (fan out, then each subtask re-enters this tree)
    │
    ├── Delegating to subagents? ───────────→ subagent-driven-development
    │       (subagents receive explicit skill instructions)
    │
    └── Direct code implementation? ────────→ LAYER STACK (apply all that match):
            │
            ├─ [ALWAYS] test-driven-development
            │     RED → GREEN → REFACTOR for every change
            │
            ├─ [IF multi-file] incremental-implementation
            │     thin vertical slices, verify each before expanding
            │
            ├─ [IF framework/library] source-driven-development
            │     verify against official docs before implementing
            │
            ├─ [IF non-trivial decision] doubt-driven-development
            │     adversarial review before committing the approach
            │
            └─ [AFTER task complete] requesting-code-review
                  then receiving-code-review if feedback arrives
```

**Key principle:** Skills are layered, not exclusive. A single task typically
activates 2-4 skills simultaneously (e.g., `incremental-implementation` +
`test-driven-development` + `source-driven-development`).

---

## Skill Priority

When multiple skills apply, invoke them in this order:

| Priority | Category | Skills | Rationale |
| -------- | -------- | ------ | --------- |
| 1 | Process | `systematic-debugging` | Must diagnose before fixing |
| 2 | Process | `test-driven-development` | Tests define correctness |
| 3 | Implementation | `incremental-implementation` | Structures the work |
| 3-alt | Implementation | `subagent-driven-development`, `dispatching-parallel-agents` | Alternative execution modes |
| 4 | Verification | `source-driven-development` | Validates against authority |
| 5 | Verification | `doubt-driven-development` | Challenges decisions |
| 6 | Review | `requesting-code-review` | Post-implementation |
| 7 | Review | `receiving-code-review` | Response to feedback |

Process skills determine HOW to approach. Implementation skills structure
execution. Verification skills validate correctness. Review skills close the
loop.

---

## Skill Types

| Skill | Type | Meaning |
| ----- | ---- | ------- |
| `test-driven-development` | **Rigid** | Follow exactly. Never skip RED phase. |
| `systematic-debugging` | **Rigid** | Follow 4-phase process exactly. No guessing. |
| `incremental-implementation` | **Rigid** | Follow 5 rules exactly. No big-bang changes. |
| `requesting-code-review` | **Rigid** | Follow checklist exactly before submitting. |
| `receiving-code-review` | **Rigid** | Follow response pattern exactly. |
| `source-driven-development` | **Flexible** | Adapt DETECT→FETCH→IMPLEMENT→CITE to context. |
| `doubt-driven-development` | **Flexible** | Scale depth of doubt cycle to stakes. |
| `subagent-driven-development` | **Flexible** | Adapt dispatch patterns to task shape. |
| `dispatching-parallel-agents` | **Flexible** | Adapt parallelism to available resources. |

**Rigid skills:** Follow the process step-by-step. Do not skip steps. Do not
adapt away discipline. These encode hard-won practices.

**Flexible skills:** Apply the principles and adapt the specific steps to
context. The spirit matters more than the letter.

---

## Core Behaviors

These behaviors apply throughout implementation. They are non-negotiable.

### 1. Verify Against Upstream Documents

Before implementing, confirm the task-doc requirements and ADR constraints
match your understanding. If they don't, STOP and clarify — don't silently
reinterpret.

### 2. Surface Assumptions

Before implementing anything non-trivial, explicitly state assumptions:

```text
ASSUMPTIONS FOR THIS TASK:
1. [assumption about scope from task-doc]
2. [assumption about constraints from ADR]
3. [assumption about interface from design-doc]
→ Correct me now or I'll proceed with these.
```

### 3. Respect Task Boundaries

Implement exactly what the task-doc specifies. Do NOT:

- "Clean up" adjacent code as a side effect
- Add features not in the task scope
- Refactor beyond what the task requires
- Delete code that seems unused without explicit approval

Your job is surgical precision within the task boundary.

### 4. Manage Confusion Actively

When code conflicts with spec, design contradicts ADR, or implementation
reveals gaps:

1. **STOP.** Do not proceed with a guess.
2. Name the specific conflict.
3. Feed back to upstream document owner.
4. Record the loopback with a one-line reason.
5. Wait for resolution before continuing.

### 5. Enforce Simplicity

Before finishing any implementation:

- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Does the solution match the design-doc's intent, not exceed it?

If 100 lines would suffice, do not write 1000.

### 6. Verify, Don't Assume

A task is NOT complete until verification passes. "Seems right" is never
sufficient. Evidence required: passing tests, build output, or runtime data.

---

## Process

For each task unit:

1. **Select Task** — pick the next ready task from `task-doc` (respect dependency order).
2. **Route** — walk the Skill Discovery tree; identify all applicable skills.
3. **Announce** — state which skills you are applying and why.
4. **Execute** — apply selected skills in priority order; follow each skill's process.
5. **Verify** — confirm the task passes its defined verification conditions.
6. **Feed Back** — if new constraints are discovered, update `adr-doc` / `design-doc`.
7. **Review** — invoke `requesting-code-review`; address feedback via `receiving-code-review`.
8. **Repeat** — return to step 1 until all tasks are complete.

---

## Recommended Combinations

| Scenario | Skills | Notes |
| -------- | ------ | ----- |
| Standard implementation | `incremental-implementation` + `test-driven-development` + `requesting-code-review` | Default for most tasks |
| Framework-heavy work | + `source-driven-development` | Add official-docs verification |
| High-stakes / unfamiliar | + `doubt-driven-development` + `source-driven-development` | Maximum verification |
| Autonomous multi-task | `subagent-driven-development` | Includes TDD and review internally |
| Multi-failure debugging | `systematic-debugging` + `dispatching-parallel-agents` | Parallel root-cause tracing |
| Bug fix | `systematic-debugging` → `test-driven-development` | Diagnose, then guard |

---

## Hard Gates

<HARD-GATE>
Every task must pass its verification conditions before marking complete.
Do not proceed to the next task if the current one has failing tests or
unresolved verification criteria.
</HARD-GATE>

<HARD-GATE>
If implementation reveals that the spec or design is incorrect or incomplete,
stop implementation and feed back to the appropriate upstream document before
continuing. Record the loopback with a one-line reason.
</HARD-GATE>

<HARD-GATE>
Do not skip Skill Discovery routing. If a skill applies, you must use it.
"This is simple enough to skip" is the most common failure mode.
</HARD-GATE>

---

## Red Flags

These thoughts mean STOP — you are rationalizing a skill skip:

| Thought | Reality |
| ------- | ------- |
| "This is a simple change, I don't need TDD" | TDD is non-negotiable. Write the failing test first. |
| "I'll write tests after the code works" | That's not TDD. RED comes before GREEN. Always. |
| "I know this library well enough" | Check official docs anyway (`source-driven-development`). |
| "This decision is obvious" | If alternatives exist, use `doubt-driven-development`. |
| "I'll clean up adjacent code while I'm here" | Stay within `task-doc` scope. Open a new task for cleanup. |
| "I'll skip review for this small fix" | All tasks get `requesting-code-review`. No exceptions. |
| "I can fix all these at once" | One slice at a time (`incremental-implementation`). |
| "The skill process is overkill for this" | Rigid skills exist because shortcuts cause bugs. Use it. |
| "I'll just do this one thing first" | Route through Skill Discovery BEFORE doing anything. |
| "This feels productive" | Undisciplined action without skill routing wastes time. |

---

## Failure Modes

Common implementation failures this skill prevents:

1. **Skipping TDD** — writing code without a failing test first, then retrofitting tests.
2. **Big-bang implementation** — changing 10 files at once instead of incremental slices.
3. **Assumption-driven coding** — implementing based on memory instead of verifying against docs.
4. **Scope creep** — "improving" code outside the task boundary during implementation.
5. **Guess-and-check debugging** — randomly changing code instead of systematic root-cause tracing.
6. **Skipping review** — marking tasks complete without code review submission.
7. **Silent reinterpretation** — implementing something different from what task-doc specifies without feeding back.
8. **Over-engineering** — building abstractions and infrastructure the task doesn't require.
9. **Ignoring loopback signals** — continuing implementation when spec/design gaps are apparent.
10. **Confidence without evidence** — "it works" without passing tests or verified output.

---

## Entry Condition

- Task units exist (from `task-doc` or equivalent) with defined verification conditions.
- When invoked from `doc-driven-dev-flow`, Phase 4 tasks must be approved.

## Completion Criteria

- All task units have been implemented.
- Each task passes its defined verification conditions.
- New constraints discovered during implementation are reflected in upstream documents.
- Code review is complete (via `requesting-code-review` / `receiving-code-review`).

## Loopback Rules

- If a task reveals spec gaps → feed back to spec/design owner; pause that task.
- If a test failure cannot be resolved within the task scope → invoke `systematic-debugging`.
- If multiple independent tasks are blocked → consider `dispatching-parallel-agents`.
- If implementation contradicts ADR constraints → update ADR or change approach.
- Record every loopback with a one-line reason.

---

## Instruction Priority

1. **User's explicit instructions** (AGENTS.md, direct requests) — highest priority.
2. **This skill and invoked workflow skills** — override default behavior.
3. **Default system prompt** — lowest priority.

If the user says "skip TDD for this task," follow the user. The user is in
control. But if no override exists, skills are mandatory.
