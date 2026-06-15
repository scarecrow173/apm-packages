---
name: doc-driven-dev-lifecycle
description: "Orchestrates the full document-driven development lifecycle through optional migration, a bootstrap phase, and a 6-phase flow with explicit gates. **Use when**: (1) Starting a new feature, project, or significant change from scratch, (2) Need to migrate existing docs into the canonical doc-driven-dev tree, (3) Need to bootstrap the canonical docs tree before briefing, (4) Unsure which doc skill to begin with, (5) Need end-to-end document orchestration from briefing to execution, (6) Must enforce sequencing constraints between doc creation phases. Sequences flow: migrate_docs (optional) -> scaffold_docs -> briefing-flow -> design-doc -> plan-doc -> task-doc -> implementation-flow -> doc-status. Keywords: document lifecycle, orchestration, migration, phase gates, meta skill."
license: MIT
---

# Doc-Driven Dev Lifecycle

Orchestrates the full document-driven development lifecycle by selecting and
sequencing existing doc skills through optional migration, a bootstrap phase,
and a 6-phase flow with explicit gates.

This is a **meta skill**: it contains no scripts and produces no artifacts
directly. Instead it decides *which* skill to invoke and *when*, enforcing
sequencing constraints and completion criteria defined in the Flow Contract.

## When to Use

- Starting a new feature, project, or significant change from scratch.
- Need to migrate existing Markdown docs into the canonical doc-driven-dev tree.
- Need to bootstrap the canonical docs tree before briefing.
- Unsure which doc skill to begin with.
- Need end-to-end document orchestration from idea to execution.

## Flow Overview

```text
Phase -1: Migration (optional)  ->  Phase 0: Bootstrap  ->  Phase 1: Briefing  ->  Phase 2: Design  ->  Phase 3: Planning  ->  Phase 4: Execution Slice  ->  Phase 5: Implementation  ->  Phase 6: Exit
```

Each phase has a gate that must be satisfied before proceeding.
See `references/flow-contract.md` for the full specification.

## Phase Summary

| Phase | Purpose | Primary Skills | Gate |
| ----- | ------- | -------------- | ---- |
| -1 | Migrate existing docs into canonical structure | `migrate_docs` | dry-run reviewed; apply creates canonical docs without deleting originals |
| 0 | Create the canonical docs tree before briefing | `scaffold_docs` | canonical `docs/` tree exists; existing files are preserved; `docs/designs/overview.md` is left to `design-doc` |
| 1 | Convert requests into document-ready inputs | `briefing-flow` | briefing outputs ready: spec + ADR with acceptance criteria |
| 2 | Concretize design into implementable form | `design-doc` | approved design consistent with spec/ADR |
| 3 | Integrate into implementation plan | `plan-doc` | PLAN-DOC-GATE-001 (approved design required) |
| 4 | Decompose plan into task units | `task-doc` | tasks traceable to plan with verification |
| 5 | Implement code guided by workflow skills | `implementation-flow` | all tasks pass verification |
| 6 | Confirm document integrity | `doc-status` | front matter, relations, index integrity |

**Key constraint resolution**: Optional Phase -1 migrates existing Markdown docs without deleting originals. Phase 0 creates the canonical docs tree but does not create `docs/designs/overview.md`; `design-doc` owns that file. Phase 1 (Briefing) explicitly permits spec + ADR parallel creation when derived from the same discovery context, as managed by `briefing-flow`. Later phases enforce sequential gates (Phase 2 requires Phase 1 complete, Phase 3 requires Phase 2 approved design, etc.).

## Phase Exit Checklists

### Phase -1 Exit

Only required for repositories with existing docs to migrate. Completion is
verified by the migration contract:
- [ ] `migrate_docs` dry-run report reviewed
- [ ] source-to-target mappings accepted
- [ ] `--apply` run creates canonical docs without deleting originals
- [ ] existing canonical target files are not overwritten

### Phase 1 Exit

Delegated to `briefing-flow`. Completion is verified by `briefing-flow` Phase D gate:
- [ ] spec-doc exists with `status:` ≥ `proposed`
- [ ] spec-doc has `acceptance_criteria:` with ≥1 item
- [ ] adr-doc exists with `alternatives:` ≥2
- [ ] Entry Decision selection recorded
- [ ] No open items classified as "pre-implementation blocker"

### Phase 0 Exit

Completion is verified by the bootstrap contract:
- [ ] canonical `docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`, `docs/tasks`, `docs/adr`, `docs/impl/ir`, and `docs/impl/exp` directories exist
- [ ] each canonical directory has a `README.md`
- [ ] existing files in the target repo remain untouched
- [ ] `docs/designs/overview.md` is not created by the bootstrap step

### Phase 2 Exit
- [ ] design-doc exists with `status:` = `approved`
- [ ] design-doc references spec-doc and adr-doc
- [ ] No conflicts between design and ADR constraints
- [ ] Implementation boundaries are clear

### Phase 3 Exit
- [ ] plan-doc exists with `status:` ≥ `proposed`
- [ ] plan-doc references design-doc
- [ ] PLAN-DOC-GATE-001 satisfied (approved design)
- [ ] Work decomposable into task-doc granularity

### Phase 4 Exit
- [ ] All task-doc entries created
- [ ] Each task has `verification:` conditions
- [ ] Tasks traceable to plan-doc sections
- [ ] Dependencies between tasks documented

## Entry Decision (Phase 1 → Delegated to `briefing-flow`)

Phase 1 is delegated to the [`briefing-flow`](../briefing-flow/SKILL.md) meta skill.
`briefing-flow` dynamically discovers and routes available skills, configures
an appropriate skill stack based on information state, and drives to spec-doc +
adr-doc completion.

**MANDATORY**: When entering Phase 1 (Briefing), read
[`briefing-flow` SKILL](../briefing-flow/SKILL.md) to understand:
- Entry Decision (A-1 through A-5) path selection
- Briefing Skill Discovery Protocol and profile configuration
- Skill stack-based information gathering execution
- Phase D gate (spec-doc + adr-doc completion criteria)

Phase 1 is considered complete when `briefing-flow` Phase D gate passes.
The resulting `spec-doc` and `adr-doc` are the completion artifacts required
to enter Phase 2 (`design-doc`).

## Phase 1 Skill Interface

Phase 1 is delegated to `briefing-flow`, which manages skill discovery,
configuration, and execution via the Briefing Skill Discovery Protocol and
`briefing-profile.md`.

Key skills managed by `briefing-flow`:

| Skill | Category | Expected Output | Completion Indicator |
|-------|----------|-----------------|----------------------|
| `deep-dive` | Frame | Confirmed intent summary with constraints and decision axes | Clear outcome, constraints, and open questions |
| `steer-web-research` | Discover | External information research results | Evidence-backed research report |
| `spec-doc` | Document | Formal specification document | `acceptance_criteria:` ≥3 items, `status: proposed` |
| `adr-doc` | Document | Architecture decision record | `alternatives:` ≥2, rationale documented |

**Note**: `briefing-flow` is not limited to these — it dynamically discovers all
available skills in the environment. See [`briefing-flow` SKILL](../briefing-flow/SKILL.md) for details.

## Hard Gates

<HARD-GATE>
Do not skip phases. Each phase gate must be satisfied before proceeding to the
next phase. If a gate cannot be satisfied, loop within the current phase or
return to a prior phase.

**Why:** Phase skipping is the #1 cause of project rework. Incomplete Phase 1
outputs cause 40% of Phase 3-4 redesigns. Each gate exists because downstream
phases assume upstream quality.
</HARD-GATE>

<HARD-GATE>
Do not create a plan-doc without an approved design-doc (PLAN-DOC-GATE-001).
Do not create task-doc entries without an approved plan-doc.

**Why:** Planning on unstable design causes 2-3x rework. Design changes after
planning require full task re-decomposition. The gate prevents "we'll figure
it out during implementation" syndrome.
</HARD-GATE>

<HARD-GATE>
Even in emergency-fix scenarios, produce at minimum a spec-doc or adr-doc as
evidence before proceeding to implementation.

**Why:** Undocumented emergency fixes become permanent technical debt. 6 months
later, no one knows why the fix exists or if it's still needed. Minimum evidence
takes 10 minutes; debugging mystery code takes hours.
</HARD-GATE>

## Process

For existing repositories, run `migrate_docs` as an optional Phase -1 before
Phase 0. Use dry-run first, review the planned source-to-target mappings, then
rerun with `--apply` only when the mapping is acceptable.

**Migration contract**: `migrate_docs` converts existing Markdown docs into the
canonical doc-driven-dev tree while preserving originals. See
`references/migration-contract.md`.

0. **Bootstrap** — run `scaffold_docs` to create the canonical docs tree.

**Bootstrap contract**: `scaffold_docs` creates the canonical `docs/` tree before
briefing begins. It preserves existing files and does not create
`docs/designs/overview.md`; `design-doc` owns that file.

1. **Briefing** — delegate to `briefing-flow`.

**MANDATORY**: When entering Phase 1 (Briefing), read
[`briefing-flow` SKILL](../briefing-flow/SKILL.md) to understand:
- Entry Decision (A-1 through A-5) path selection
- Briefing Skill Discovery Protocol and profile configuration
- Skill stack-based information gathering execution
- Phase D gate (spec-doc + adr-doc completion criteria)

**Do NOT Load** `briefing-flow` references are managed by `briefing-flow` itself at Phase 1 start.

2. **Design** — invoke `design-doc`; verify consistency with spec and ADR.

**MANDATORY**: Before entering Phase 3 (Planning), read
[`references/flow-contract.md`](references/flow-contract.md) §3-4 for detailed
gate criteria. Understand PLAN-DOC-GATE-001 requirements.

3. **Plan** — invoke `plan-doc`; respect PLAN-DOC-GATE-001.
4. **Execute** — decompose into `task-doc` entries with verification steps.

**MANDATORY**: Before entering Phase 5 (Implementation), read the
[`implementation-flow` SKILL](../implementation-flow/SKILL.md) to understand:
- Skill Discovery Protocol and profile configuration
- Per-task execution with skill stack
- Verification evidence requirements

**Do NOT Load** `implementation-flow` before Phase 4 completes — task decomposition
must finish before implementation configuration begins.

5. **Implement** — apply workflow skills per-task; verify each task passes.
6. **Exit Audit** — invoke `doc-status` to validate document integrity.

## Loopback Rules

### Phase 2 → Phase 1 (Spec Gap)
When design work reveals missing or unclear requirements:
1. Record gap in one-line reason: "spec-gap: [description]"
2. Identify affected spec-doc section(s)
3. Re-invoke `briefing-flow` (scope: discovered gap only)
4. Update spec-doc, set status back to `proposed` if needed

### Phase 3 → Phase 2 (Design Gap)
When planning reveals design insufficiency:
1. Record gap: "design-gap: [description]"
2. Identify missing design decision or boundary
3. Re-invoke `design-doc` for the affected component
4. Verify updated design against spec/ADR before resuming

### Phase 4 → ADR/Design Update (New Constraint)
When task decomposition surfaces new constraints:
1. Record constraint: "constraint: [description]"
2. Determine if ADR or design-doc needs update
3. Update the affected document with minimal scope change
4. Resume Phase 4 from the blocked task

### Phase 5 → Phase 1 or 2 (Implementation Discovery)
When implementation reveals fundamental gaps:
1. Record discovery: "impl-gap: [description]"
2. Assess severity: spec-level (→Phase 1) or design-level (→Phase 2)
3. Pause current task, return to appropriate phase
4. After upstream fix, resume from paused task

---

## Anti-patterns

These thoughts and behaviors signal failure — STOP when you notice them:

| Anti-pattern | Why it fails |
| ------------ | ------------ |
| "Emergency fix, skip to implementation" | Undocumented fixes become mystery code. Cost: 10min doc now vs 2+ hours debugging in 6 months |
| "Design is obvious, skip design-doc" | Implicit design contradicts itself mid-implementation. 2-3x rework vs 30min upfront design |
| "Plan can come later" | Design changes after planning require full task re-decomposition. Zero reuse |
| "Requirements are clear in my head" | Unwritten requirements are unverifiable. "I never said that" disputes guaranteed |
| "This phase gate is too strict" | Relaxed gates compound quality degradation downstream. Technical debt accrues interest |
| "I'll document after implementation" | Post-implementation docs drift from reality. Unmaintainable within 3 months |
| "Loopback is inefficient" | Skipped loopbacks amplify problems downstream. 1x cost at Phase 2 → 10x at Phase 5 |
| "Just one small change, no need for full flow" | Accumulated "small changes" rot architecture. Death by a thousand cuts |
| "ADR is bureaucracy" | Without decision records, future-you repeats the same debates. Time sink loops |
| "Parallel doc creation saves time" | **Allowed when independent**: spec + ADR created in parallel from same discovery (Phase 1: briefing-flow). **Prohibited when dependent**: creating task-doc before plan-doc approval, or design without spec consensus. Rule: parallel when docs address different questions from same data; sequential when later depends on earlier decision. |

---

## Common Issues

| Issue | Detection | Resolution |
| ----- | --------- | ---------- |
| Spec-doc stuck in draft | `status: draft` in front matter OR `acceptance_criteria:` empty/missing | Return to 1-2, identify missing acceptance criteria explicitly |
| Entry route unclear | Spent >5min deliberating; ask "Can I write acceptance criteria now?" | Yes→D, No→A or B |
| Design inconsistent with ADR | Design references constraint not in ADR, OR ADR constraint violated | Update ADR with new constraint OR revise design to comply |
| Plan-doc rejected at gate | `design_doc:` reference missing OR design-doc `status:` != `approved` | Confirm design-doc approval status first |
| Task decomposition too coarse | `grep verification:` returns empty for any task-doc entry | Break down until each task has testable completion criteria |
| Implementation reveals spec gap | Implementation requires behavior not in spec's acceptance criteria | Record gap reason, return to Phase 1, update spec before resuming |
| doc-status audit fails | `doc-status` output shows ERROR or WARN for any document | Fix specific issues listed in audit, re-run doc-status |

---

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
