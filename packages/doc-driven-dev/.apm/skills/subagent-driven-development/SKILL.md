---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session. Dispatches fresh subagent per task with two-stage review (spec compliance, then code quality).
license: MIT
origin: obra/superpowers (MIT)
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration.

**Continuous execution:** Do not pause to check in with your user between tasks. Execute all tasks from the plan without stopping. The only reasons to stop are: BLOCKED status you cannot resolve, ambiguity that genuinely prevents progress, or all tasks complete.

## When to Use

**Use when:**
- You have an implementation plan with independent tasks
- Tasks are mostly independent (can be worked on in isolation)
- You want to stay in the current session (vs. parallel sessions)

**Don't use when:**
- No implementation plan exists yet (create one first with `plan-doc`)
- Tasks are tightly coupled (need shared context across tasks)

## The Process

```
Read plan → Extract all tasks → Create todo list
    ↓
For each task:
    ↓
Dispatch implementer subagent
    ↓
Implementer asks questions? → Answer, re-dispatch
    ↓
Implementer implements, tests, commits, self-reviews
    ↓
Dispatch spec reviewer subagent
    ↓
Spec compliant? → No → Implementer fixes → Re-review
    ↓ Yes
Dispatch code quality reviewer subagent
    ↓
Quality approved? → No → Implementer fixes → Re-review
    ↓ Yes
Mark task complete → Next task
    ↓
All tasks done → Final review → Done
```

## Model Selection

Use the least powerful model that can handle each role to conserve cost and increase speed.

**Mechanical implementation tasks** (isolated functions, clear specs, 1-2 files): use a fast, cheap model.

**Integration and judgment tasks** (multi-file coordination, pattern matching, debugging): use a standard model.

**Architecture, design, and review tasks**: use the most capable available model.

**Task complexity signals:**
- Touches 1-2 files with a complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment or broad codebase understanding → most capable model

## Handling Implementer Status

Implementer subagents report one of four statuses:

**DONE:** Proceed to spec compliance review.

**DONE_WITH_CONCERNS:** Read the concerns before proceeding. If about correctness or scope, address before review. If observations, note and proceed.

**NEEDS_CONTEXT:** Provide the missing context and re-dispatch.

**BLOCKED:** Assess the blocker:
1. Context problem → provide more context, re-dispatch same model
2. Requires more reasoning → re-dispatch with more capable model
3. Task too large → break into smaller pieces
4. Plan itself is wrong → escalate to user

**Never** ignore an escalation or force the same model to retry without changes.

## Prompt Templates

Use the templates in `assets/templates/`:
- `implementer-prompt.md` — Dispatch implementer subagent
- `spec-reviewer-prompt.md` — Dispatch spec compliance reviewer subagent
- `code-quality-reviewer-prompt.md` — Dispatch code quality reviewer subagent

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)

**Quality gates:**
- Self-review catches issues before handoff
- Two-stage review: spec compliance, then code quality
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building

**Cost:**
- More subagent invocations (implementer + 2 reviewers per task)
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance
- Skip review loops (reviewer found issues = implementer fixes = review again)
- **Start code quality review before spec compliance is ✅** (wrong order)
- Move to next task while either review has open issues

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**
- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)

## Integration

**Related skills:**
- **plan-doc** — Creates the plan this skill executes
- **requesting-code-review** — Code review template for reviewer subagents
- **test-driven-development** — Subagents follow TDD for each task
- **dispatching-parallel-agents** — For truly independent parallel work
