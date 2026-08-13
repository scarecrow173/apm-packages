# doc-driven-dev-lifecycle: Flow Contract

This document remains the normative human approval and evidence contract. The
runtime route is declared by [`graphs/lifecycle.yaml`](../graphs/lifecycle.yaml),
derived state by [`lifecycle-state.md`](lifecycle-state.md), and dispatch by
`route_lifecycle.js`; prose phase labels are compatibility context, not an
alternative router.

## Router handoff

At each phase boundary, probe the focused artifact chain, run the audits named by
the route, and record evidence before rerouting. `focus-required` is a hard
stop: obtain explicit focus instead of selecting a chain heuristically. The
planning/tasking phase uses `build_task_graph.js` as its composite step; its
fan-out/fan-in and fail-closed rules are defined in `references/graph-contract.md`.

This document defines the fixed sequence and decision rules that
`doc-driven-dev-lifecycle` uses to orchestrate existing skills.

## Phases Overview

| Phase | Name | Primary Skills | Gate |
| ----- | ---- | -------------- | ---- |
| -1 | Migration | `migrate_docs` | dry-run reviewed; apply creates canonical docs without deleting originals |
| 0 | Bootstrap | `scaffold_docs` | canonical `docs/` tree exists; existing files are preserved; `docs/designs/overview.md` is left to `design-doc` |
| 1 | Briefing | `briefing-flow` | briefing outputs ready: spec + ADR with acceptance criteria |
| 2 | Design | `design-doc` | approved design consistent with spec/ADR |
| 3 | Planning & Tasking | `plan-doc` + `task-doc` | approved plan; traceable tasks with verification |
| 4 | Implementation | `implementation-flow` | all selected tasks are lifecycle-resolved (`done` or `wont-do`); caller supplies `implementation-verified` |
| 5 | Exit | `doc-status` | front matter, relations, index integrity |

## Phase -1: Migration (Optional)

Purpose: Bring existing Markdown documentation into the canonical
doc-driven-dev tree before Bootstrap.

**Migration command:** `migrate_docs`

Phase -1 is only required for repositories that already have documentation.
Run dry-run first, review source-to-target mappings, then rerun with `--apply`
only when the mapping is acceptable. Original files are preserved and existing
canonical targets are not overwritten.

### Migration Completion Criteria

- `migrate_docs` dry-run report has been reviewed.
- Source-to-target mappings are accepted.
- `--apply` creates canonical docs without deleting originals.
- Existing canonical target files are not overwritten.
- `docs/designs/overview.md` remains owned by `design-doc`.

## Phase 0: Bootstrap

Purpose: Create the canonical docs tree before Briefing begins.

**Bootstrap command:** `scaffold_docs`

Phase 0 creates the repository’s baseline docs tree and preserves existing
files. It creates the canonical directories and index README files, but it does
**not** create `docs/designs/overview.md`; that file remains the responsibility
of `design-doc`.

### Bootstrap Completion Criteria

- `docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`,
  `docs/tasks`, `docs/adr`, `docs/impl/ir`, and `docs/impl/exp` exist.
- Each canonical directory has a `README.md`.
- Existing files in the target repo are not overwritten.
- `docs/designs/overview.md` is not created by the bootstrap step.

## Phase 1: Briefing

Purpose: Convert user requests, proposals, or issues into document-ready inputs.

**Delegated to:** [`briefing-flow`](../briefing-flow/SKILL.md)

Phase 1 is fully delegated to the `briefing-flow` meta skill.
`briefing-flow` manages:

- Entry Decision (A-1 through A-5) path selection
- Briefing Skill Discovery Protocol and `briefing-profile.md` generation
- Skill stack-based information gathering execution
- Phase D gate (spec-doc + adr-doc completion criteria)

### Briefing Completion Criteria

Complete when `briefing-flow` Phase D gate passes:

- `spec-doc` has acceptance criteria and status is `proposed` or above
  (`draft` must not advance to the next phase).
- `adr-doc` has key technical decisions with alternatives.
- Both documents reference the same issue context.
- Entry Decision selection is recorded.
- Open items classified as "pre-implementation blocker" or "manageable later".

The `spec-doc` and `adr-doc` produced here are the briefing outputs required to
enter Phase 2 (`design-doc`).

## Phase 2: Design

Purpose: Concretize design into implementable form, filling gaps from Briefing.

### Steps

- 2-1 Design Authoring: create `design-doc` covering structure, boundaries, data/process flow, non-functional concerns.
- 2-2 Consistency Check: verify `design-doc` does not contradict `spec-doc` requirements or `adr-doc` constraints.
- 2-3 Approval Gate Preparation: ensure design is in approvable state per existing gate rules.

### Design Completion Criteria

- `design-doc` derives from `spec-doc` and `adr-doc`.
- Design information required for `plan-doc` input is complete.

## Phase 3: Planning & Tasking

Purpose: Integrate spec, ADR, and design into an implementation plan.

### Steps

- 3-1 Plan Authoring: define dependency order, vertical slices, verification steps, checkpoints in `plan-doc`.
- 3-2 Planning Gate: respect existing gate (PLAN-DOC-GATE-001); refuse plan creation without approved design.
- 3-3 Plan Approval: review the plan and set `status: approved` before task creation.
- 3-4 Task Decomposition: create `task-doc` entries from the approved plan with explicit dependencies and verification conditions.

### Planning & Tasking Completion Criteria

- `plan-doc` references `spec-doc` / `adr-doc` / `design-doc` and has `status: approved`.
- All `task-doc` entries are traceable to plan sections.
- Each task has verification steps and documented dependencies.

## Phase 4: Implementation

Purpose: Execute task units by delegating to `implementation-flow`, which
dynamically discovers all available skills and configures the appropriate
skill stack per task via `implementation-profile.md`.

### Steps

- 4-1 Open implementation documentation: before code changes for each task, read
  `impl-doc` SKILL and `impl-doc` conventions, and open an `in-progress`
  Implementation Record.
- 4-2 Invoke `implementation-flow`: delegate per-task execution, skill
  discovery, configuration, verification, and in-flight documentation upkeep.
- 4-3 Constraint Feedback: if `implementation-flow` reports upstream gaps,
  update `adr-doc` / `design-doc` and record loopback.
- 4-4 Completion Check: confirm all selected tasks are lifecycle-resolved
  (`done` or `wont-do`), the caller supplies `implementation-verified`, and
  their Implementation Records are completed and audited before closure.

### Implementation Completion Criteria

- `implementation-flow` reports selected tasks as implemented (`done`) or intentionally not done (`wont-do`), and the caller supplies `implementation-verified`.
- New constraints discovered are reflected in upstream documents.
- Code review is complete.
- Each task opened an in-progress Implementation Record before code changes.
- Each Implementation Record was completed and audited before task closure.

## Phase 4 Exit Gate: Post-Implementation Review / Follow-up Triage

Purpose: verify implemented behavior against approved upstream documents before
the document set is allowed to exit.

Follow-up completion is typed, not a boolean. Emit exactly one route signal and
name that selected route in the user-visible follow-up report:

| Classification | Typed route | Required route and evidence |
| --- | --- | --- |
| `bug-fix` | `followup-bug-fix` | Create or update a task under the current approved plan; link it with `relations.depends-on` / `relations.blocks`. |
| `decision-required` (briefing) | `followup-decision-briefing` | Return to Phase 1 (`briefing-flow`) before creating implementation tasks. |
| `decision-required` (design) | `followup-decision-design` | Return to Phase 2 (`design-doc`) before creating implementation tasks. |
| `new-feature` | `followup-new-feature` | Return to Phase 1 (`briefing-flow`) for a new briefing; never attach it to the current approved plan. |
| `doc-only` | `followup-doc-only` | Operators record the document or implementation-record update; this route proceeds to `exit-audit` and then follows its declared audit route. |
| `defer` or `wont-do` | `followup-terminal` | Operators must record the deferral or reason (`status: wont-do` when represented as a task). In this version, `wont-do` is lifecycle-resolved unconditionally; the Lifecycle state projection and Router do not mechanically validate whether a reason is present or valid. It never satisfies another task's dependency. |

The six typed routes are mutually exclusive. An unclassified or conflicting
follow-up keeps `followup-triage` blocked and uses its declared
`followups-unclassified` retry edge. Operators must record the corresponding
follow-up evidence for `doc-only`, `defer`, and `wont-do`; this is a human
evidence requirement, not a Router condition. Route selection is not conditional
on verified or recorded evidence. In this version, `wont-do` is
lifecycle-resolved unconditionally and never satisfies another task's
dependency.

## Phase 5: Exit

Purpose: Confirm document integrity via `doc-status` audit after execution.

- Verify front matter required fields.
- Verify relations link integrity and index coverage.
- Return incomplete documents for correction and re-audit.

### Exit Completion Criteria

- front matter, relations, index are consistent.
- Implementation verification results are documented.
- Audit result confirms completable state.
