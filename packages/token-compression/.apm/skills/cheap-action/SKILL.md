---
name: cheap-action
description: Route simple, mechanically verifiable actions to the lowest-cost selectable model when the current harness supports model selection.
---

# Cheap Action

Use this skill when a user asks for a simple, bounded operation that can be completed and verified mechanically with little or no semantic reasoning.

## Purpose

Reduce model cost for low-risk work. If the current harness exposes a lower-cost model or low-cost delegation path that can still use the required tools, switch to that option for the bounded action. If the harness does not expose model selection, continue on the current model and keep the work mechanical.

This skill is advisory and cross-harness. Do not claim that a model switch happened unless the harness actually provides and confirms that switch.

## Cheap-Eligible Work

Use the cheapest available capable model for:

- Running a named command or script and reporting the result.
- Mechanical variable, function, file, import, or include renames where matches are scoped and detectable.
- Simple import or include resolution by matching existing local patterns.
- Simple type annotations inferred from immediate usage.
- Comment updates derived from function signatures or nearby behavior.
- Minor structured configuration edits in YAML, JSON, TOML, INI, or similar files.
- Routine Git operations such as status checks, diff summaries, staging, commits, and branch checks.
- Grep-style search and file listing.
- Straight syntax-level fixes with clear parser, compiler, or linter errors.
- File move or copy operations with mechanical import updates.

## Do Not Use Cheap Routing

Stay on the current/default reasoning model when the task needs:

- Architecture, product, security, legal, medical, financial, or policy judgment.
- Ambiguous intent inference across many files or natural-language requirements.
- Broad code comprehension before the action can be scoped.
- Destructive operations, permission changes, secret handling, publication, deployment, or external side effects.
- A plan, design, code review, threat model, or root-cause analysis.
- Any action where you cannot name a deterministic verification step before acting.

## Routing Procedure

Before acting, run this short check:

1. Name the bounded action.
2. Name the mechanical verification step.
3. Decide whether the action is cheap-eligible.
4. If cheap-eligible and the harness exposes a lower-cost capable model, switch or delegate to it.
5. If no lower-cost capable model is available, continue on the current model without pretending a switch happened.
6. Execute only the bounded action.
7. Verify the result mechanically.
8. Escalate back to the current/default reasoning model if verification fails, scope expands, or ambiguity appears.

## Communication

Keep user-facing text short. For routine actions, one sentence is enough:

`Cheap action: running the existing script and reporting the result.`

Do not explain model economics unless the user asks. Do not mention an unavailable model switch.

## Output Expectations

Report:

- What bounded action ran.
- Whether verification passed.
- Any exact output or file path the user needs.
- Any reason the task had to escalate out of cheap routing.
