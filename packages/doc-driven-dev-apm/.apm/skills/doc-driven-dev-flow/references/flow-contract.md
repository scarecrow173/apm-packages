# doc-driven-dev-flow: Flow Contract

This document defines the fixed sequence and decision rules that
`doc-driven-dev-flow` uses to orchestrate existing skills.

## Phases Overview

| Phase | Name | Primary Skills | Gate |
| ----- | ---- | -------------- | ---- |
| 1 | Briefing | `idea-refine`, `brainstorming`, `spec-doc`, `adr-doc` | spec + ADR with acceptance criteria |
| 2 | Design | `design-doc` | approved design consistent with spec/ADR |
| 3 | Planning | `plan-doc` | PLAN-DOC-GATE-001 (approved design required) |
| 4 | Execution Slice | `task-doc` | tasks traceable to plan with verification |
| 5 | Implementation | `implementation-flow` | all tasks pass verification |
| 6 | Exit | `doc-status` | front matter, relations, index integrity |

## Phase 1: Briefing

Purpose: Convert user requests, proposals, or issues into document-ready inputs.

### 1-1 Entry Decision

Select one option based on current information state:

- **1-1-A. Problem Framing**
  - Use when: problem definition is vague, requirements scattered, purpose unclear.
  - Action: use `idea-refine` to clarify problem definition, value hypothesis, unknowns.
- **1-1-B. Option Framing**
  - Use when: direction exists but trade-off analysis is insufficient.
  - Action: use `brainstorming` to compare options and define evaluation criteria.
- **1-1-C. Combined Skill Discovery**
  - Use when: multiple skills are needed in combination to gather evidence.
  - Action: combine `idea-refine`, `brainstorming`, and other available skills through dialogue.
- **1-1-D. Direct Documentation Start**
  - Use when: requirements and constraints are sufficiently clear.
  - Action: proceed directly to `spec-doc + adr-doc` (record reason in one line).

Notes:

- A/B/C/D are options, not a sequence. No ordering between A and B.
- A/B/C may be combined when needed.
- Even in emergency-fix cases, leave at minimum a `spec-doc` or `adr-doc` as evidence.

### 1-2 Discovery Deepening

Purpose: Iteratively deepen information until implementation questions are minimized.

Procedure:

1. Inventory requirements, constraints, assumptions, non-goals, dependencies, open items.
2. Formulate missing information as explicit questions; resolve in priority order.
3. Reflect resolved items into briefing notes; revisit 1-1 route if needed.

Stop when:

- Major use cases can describe input, processing, and expected outcome.
- Critical constraints (technical, operational, timeline, quality) are stated.
- Open items are classified as "must resolve before implementation" or "manageable later".

### 1-3 Parallel Documentation Output

Create `spec-doc` and `adr-doc` from briefing output:

- `spec-doc`: purpose, scope, acceptance criteria, out-of-scope.
- `adr-doc`: chosen option, alternatives, rationale, impact scope.
- Both documents reference the same issue context with traceable relations.

### Briefing Completion Criteria

- `spec-doc` has acceptance criteria and status is `proposed` or above
  (`draft` must not advance to the next phase).
- `adr-doc` has key technical decisions with alternatives.
- Both documents reference the same issue context.
- Selected 1-1 route (A/B/C/D) is recorded.
- Open items classified as "pre-implementation blocker" or "manageable later".

## Phase 2: Design

Purpose: Concretize design into implementable form, filling gaps from Briefing.

### Steps

- 2-1 Design Authoring: create `design-doc` covering structure, boundaries, data/process flow, non-functional concerns.
- 2-2 Consistency Check: verify `design-doc` does not contradict `spec-doc` requirements or `adr-doc` constraints.
- 2-3 Approval Gate Preparation: ensure design is in approvable state per existing gate rules.

### Design Completion Criteria

- `design-doc` derives from `spec-doc` and `adr-doc`.
- Design information required for `plan-doc` input is complete.

## Phase 3: Planning

Purpose: Integrate spec, ADR, and design into an implementation plan.

### Steps

- 3-1 Plan Authoring: define dependency order, vertical slices, verification steps, checkpoints in `plan-doc`.
- 3-2 Planning Gate: respect existing gate (PLAN-DOC-GATE-001); refuse plan creation without approved design.
- 3-3 Execution Readiness: define implementation work at a granularity decomposable into `task-doc`.

### Planning Completion Criteria

- `plan-doc` references `spec-doc` / `adr-doc` / `design-doc`.
- Implementation order and verification conditions directly feed into `task-doc`.

## Phase 4: Execution Slice

Purpose: Decompose plan into implementation units and connect to execution.

- Create `task-doc` entries from plan, with explicit dependencies.
- Each task has: implementation steps + verification conditions + completion criteria.
- If new constraints surface during implementation, update `adr-doc` / `design-doc` as needed.

### Execution Slice Completion Criteria

- `task-doc` entries are traceable to plan.
- Each task has verification steps.

## Phase 5: Implementation

Purpose: Execute task units by delegating to `implementation-flow`, which
dynamically discovers all available skills and configures the appropriate
skill stack per task via `implementation-profile.md`.

### Steps

- 5-1 Invoke `implementation-flow`: delegate per-task execution, skill discovery, configuration, and verification.
- 5-2 Constraint Feedback: if `implementation-flow` reports upstream gaps, update `adr-doc` / `design-doc` and record loopback.
- 5-3 Completion Check: confirm all tasks pass verification via `implementation-flow` completion criteria.

### Implementation Completion Criteria

- `implementation-flow` reports all tasks implemented and verified.
- New constraints discovered are reflected in upstream documents.
- Code review is complete.

## Phase 6: Exit

Purpose: Confirm document integrity via `doc-status` audit after execution.

- Verify front matter required fields.
- Verify relations link integrity and index coverage.
- Return incomplete documents for correction and re-audit.

### Exit Completion Criteria

- front matter, relations, index are consistent.
- Implementation verification results are documented.
- Audit result confirms completable state.
