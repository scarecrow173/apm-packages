---
name: doc-driven-dev-flow
description: "Meta skill that orchestrates the full document-driven development lifecycle. Selects and sequences existing doc skills (idea-refine, brainstorming, spec-doc, adr-doc, design-doc, plan-doc, task-doc, doc-status) through a fixed 6-phase flow with explicit gates."
license: MIT
---

# Doc-Driven Dev Flow

Orchestrates the full document-driven development lifecycle by selecting and
sequencing existing doc skills through a 6-phase flow with explicit gates.

This is a **meta skill**: it contains no scripts and produces no artifacts
directly. Instead it decides *which* skill to invoke and *when*, enforcing
sequencing constraints and completion criteria defined in the Flow Contract.

## When to Use

- Starting a new feature, project, or significant change from scratch.
- Unsure which doc skill to begin with.
- Need end-to-end document orchestration from idea to execution.

## Flow Overview

```text
Phase 1: Briefing  →  Phase 2: Design  →  Phase 3: Planning  →  Phase 4: Execution Slice  →  Phase 5: Implementation  →  Phase 6: Exit
```

Each phase has a gate that must be satisfied before proceeding.
See `references/flow-contract.md` for the full specification.

## Phase Summary

| Phase | Purpose | Primary Skills | Gate |
| ----- | ------- | -------------- | ---- |
| 1 | Convert requests into document-ready inputs | `idea-refine`, `brainstorming`, `spec-doc`, `adr-doc` | spec + ADR with acceptance criteria |
| 2 | Concretize design into implementable form | `design-doc` | approved design consistent with spec/ADR |
| 3 | Integrate into implementation plan | `plan-doc` | PLAN-DOC-GATE-001 (approved design required) |
| 4 | Decompose plan into task units | `task-doc` | tasks traceable to plan with verification |
| 5 | Implement code guided by workflow skills | `implementation-flow` | all tasks pass verification |
| 6 | Confirm document integrity | `doc-status` | front matter, relations, index integrity |

## Entry Decision (Phase 1, Step 1-1)

Before starting, assess the current information state and select one route:

- **1-1-A. Problem Framing** — problem is vague → use `idea-refine`
- **1-1-B. Option Framing** — direction exists but trade-offs unclear → use `brainstorming`
- **1-1-C. Combined Skill Discovery** — multiple skills needed → combine through dialogue
- **1-1-D. Direct Documentation Start** — requirements clear → proceed to `spec-doc + adr-doc`

These are **choices**, not a sequence. Select based on information completeness.

## Hard Gates

<HARD-GATE>
Do not skip phases. Each phase gate must be satisfied before proceeding to the
next phase. If a gate cannot be satisfied, loop within the current phase or
return to a prior phase.
</HARD-GATE>

<HARD-GATE>
Do not create a plan-doc without an approved design-doc (PLAN-DOC-GATE-001).
Do not create task-doc entries without an approved plan-doc.
</HARD-GATE>

<HARD-GATE>
Even in emergency-fix scenarios, produce at minimum a spec-doc or adr-doc as
evidence before proceeding to implementation.
</HARD-GATE>

## Process

1. **Assess Entry** — determine which 1-1 route applies; record selection.
2. **Deepen Discovery** — iterate until stop conditions are met (see Flow Contract §1-2).
3. **Produce Briefing Outputs** — create `spec-doc` and `adr-doc` in parallel.
4. **Design** — invoke `design-doc`; verify consistency with spec and ADR.
5. **Plan** — invoke `plan-doc`; respect PLAN-DOC-GATE-001.
6. **Execute** — decompose into `task-doc` entries with verification steps.
7. **Implement** — apply workflow skills per-task; verify each task passes.
8. **Exit Audit** — invoke `doc-status` to validate document integrity.

## Loopback Rules

- If Phase 2 reveals spec gaps → return to Phase 1.
- If Phase 3 reveals design gaps → return to Phase 2.
- If Phase 4 surfaces new constraints → update ADR/design, then resume.
- If Phase 5 reveals spec/design gaps → return to Phase 1 or 2.
- Record every loopback with a one-line reason.

## Phase 5: Implementation

After task decomposition (Phase 4), invoke `implementation-flow` to orchestrate
code execution. It selects and sequences the appropriate workflow skills
per task unit, manages verification loops, and feeds back discovered constraints.

See `implementation-flow` SKILL for full details on skill selection,
recommended combinations, and per-task execution process.

### Entry Condition

Phase 5 begins when Phase 4 tasks are approved and ready for execution.

### Phase 5 Completion Criteria

- All `task-doc` entries have been implemented and verified.
- New constraints discovered during implementation are reflected in ADR/design.
- Code review is complete.

### Exit to Phase 6

After implementation completes, proceed to Phase 6 (`doc-status`) for final
document integrity verification.

## Phase 6: Exit

The flow is complete when Phase 6 `doc-status` audit passes with no blocking
findings, confirming that all documents are consistent and traceable.

## Reference

Full flow contract with detailed criteria: `references/flow-contract.md`
