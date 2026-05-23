---
name: adr-doc
description: Use this skill when creating, consulting, auditing, indexing, or migration-planning Architecture Decision Records for coding agents using MADR 4.0.0. Use when an implementation decision needs enough context, constraints, implementation guidance, and verification criteria for an agent to execute without extra explanation.
license: MIT
---

# ADR Documentation Skill

Use this skill for Architecture Decision Records written as executable
specifications for coding agents.

Human reviewers approve the decision. Coding agents implement it. The ADR must
therefore contain enough context, constraints, affected areas, implementation
guidance, and verification criteria for an agent to act without follow-up
questions.

## Philosophy

- Write decisions as implementation guidance, not just historical notes.
- Make constraints explicit and measurable where possible.
- State non-goals so agents do not expand scope.
- Tie decisions to concrete files, directories, interfaces, dependencies, and
  patterns when known.
- Include verification criteria that an agent can check with tests, commands,
  review steps, or observable behavior.
- Preserve decision history. Do not rewrite old rationale just to fit a newer
  template.

## When to Write an ADR

Write or propose an ADR when a decision:

- Changes how the system is built, integrated, deployed, operated, or extended.
- Introduces a dependency, architectural pattern, API convention, data model,
  infrastructure choice, or cross-cutting rule.
- Is hard to reverse after code has been written against it.
- Affects future humans or agents working in the codebase.
- Has real alternatives whose trade-offs should survive the implementation.
- Contradicts, supersedes, or refines an existing accepted ADR.

Do not create a new ADR for routine implementation choices inside an existing
pattern, small bug fixes, typo corrections, formatter or linter preferences, or
decisions already covered by an active ADR.

If a future coding agent would need to know why a choice was made before safely
changing the code, capture the decision as an ADR.

## Proactive Agent Triggers

When coding, stop and propose an ADR before continuing if you are about to:

- Add a dependency that is not already part of the project.
- Establish a new pattern that other code will need to follow.
- Choose between multiple realistic options with non-obvious trade-offs.
- Implement something that conflicts with an accepted ADR.
- Write a long code comment explaining architectural "why" rather than local
  mechanics.

When proposing the ADR, state the decision encountered, why it matters, and what
implementation work it would govern.

## Creation Workflow

### Phase 0: Scan First

Before asking the user questions or drafting an ADR:

1. Find existing ADRs using the directory rules in
   `references/adr-conventions.md`.
2. Read relevant accepted ADRs and note decisions that constrain, relate to, or
   may be superseded by the new decision.
3. Inspect the project stack and dependency manifests relevant to the decision.
4. Scan related code for existing files, interfaces, tests, and patterns the ADR
   should govern.
5. Search for existing ADR references in code, docs, and PR notes.

Carry this context into the intent questions. Do not draft an ADR from abstract
requirements when concrete repository evidence is available.

### Phase 1: Capture Intent

Ask focused questions one at a time. Skip questions already answered by the
codebase scan.

Capture:

- The decision title as a short verb phrase.
- Why the decision is needed now.
- Constraints from the stack, codebase, timeline, operations, compliance, or
  team workflow.
- Success criteria and failure signals.
- Real options considered and the trade-off of each option.
- The current preferred option and why.
- Decision-makers, consulted experts, and informed stakeholders.
- Non-goals and explicitly rejected scope.
- Affected files, directories, interfaces, dependencies, configuration, tests,
  and patterns.
- Verification steps that prove the implementation follows the decision.

Before drafting, summarize the captured intent and ask the user to confirm or
correct it. Do not write the ADR if you would need to invent the implementation
plan, constraints, or verification criteria.

### Phase 2: Draft the ADR

1. Choose the ADR directory and filename using `references/adr-conventions.md`.
2. Choose the template using `references/template-variants.md`.
3. Prefer the `full` template unless the decision is simple, local, and unlikely
   to be misread.
4. Fill the ADR with concrete content from the confirmed intent summary.
5. Include an Implementation Plan naming affected paths, patterns to follow,
   patterns to avoid, dependencies, configuration, migration work, and
   compatibility concerns when relevant.
6. Include Verification criteria as checkboxes. Each item must be testable by an
   agent.
7. Use `relations` front matter to connect superseding, superseded, related, or
   refining ADRs.

Preferred script:

```bash
node scripts/new_adr.ts --title "Adopt MADR"
node scripts/new_adr.ts --title "Use PostgreSQL" --template full --dir docs/decisions
```

### Phase 3: Review for Agent Readiness

Review drafted ADRs with `references/review-checklist.md`.

Report review results as a short summary:

- What is solid enough for an agent to implement.
- What gaps would force an agent to ask follow-up questions.
- Whether to finalize, revise specific gaps, or return to intent capture.

If the ADR cannot tell a coding agent what to change, what to preserve, what to
avoid, and how to verify completion, fix those gaps before finalizing unless the
user explicitly accepts them.

## Consulting Existing ADRs

Use this skill before implementation when a task touches architecture, data
flow, APIs, infrastructure, dependencies, or cross-cutting conventions.

1. Locate the ADR directory and index.
2. Read relevant accepted ADRs fully, including implementation and verification
   sections.
3. Follow active decisions when modifying governed code.
4. If code and ADRs disagree, report the conflict instead of silently choosing
   one.
5. If a change should replace an active decision, create a new ADR and connect
   it with `relations`.

Helpful commands:

```bash
node scripts/list_adrs.ts --dir docs/adr
node scripts/audit_adr.ts --dir docs/adr
node scripts/review_adr.ts --dir docs/adr
node scripts/check_code_links.ts --dir docs/adr
node scripts/update_index.ts --dir docs/adr --write
node scripts/relate_adr.ts --from 0002-new.md --to 0001-old.md --relation supersedes --write
node scripts/migrate_report.ts --dir docs/adr
```

## Code and ADR Links

ADRs should name the code they govern in the Implementation Plan. Code that is
directly governed by an ADR may include a lightweight comment pointing back to
the ADR at the main entry point for that decision.

Keep code references sparse. The goal is discoverability for future agents, not
noise on every line.

## Maintenance Rules

- Treat `references/adr-conventions.md` as the authoritative ADR convention.
- Use `references/adr-maintenance.md` for tool-specific safety behavior and
  review focus.
- Treat MADR 4.0.0 as the ADR-specific baseline for this skill.
- Do not apply MADR rules to future non-ADR document skills.
- Prefer explicit user confirmation before using `--write` in a repository with
  existing ADRs.
- For status changes, superseding decisions, and migration reports, preserve
  history and append context instead of replacing old rationale.
