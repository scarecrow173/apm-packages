# ADR Agent-Readiness Checklist

Use this checklist before finalizing an ADR.

The core question is: can a coding agent read this ADR and implement the
decision without asking clarifying questions?

## Context

- The trigger explains what changed, broke, or will break without a decision.
- Required domain terms, acronyms, systems, and constraints are explicit.
- Related issues, PRs, ADRs, files, or existing patterns are linked when known.

## Decision

- The decision is specific enough to act on.
- Scope is bounded, including what is out of scope.
- Constraints are measurable where possible.
- Rejected alternatives explain why they were not chosen.

## Implementation Plan

- Affected files, directories, modules, or interfaces are named.
- Dependencies to add, remove, or avoid are listed.
- Patterns to follow are tied to existing code when possible.
- Patterns to avoid are explicit.
- Configuration, migration, data, or compatibility steps are listed when needed.

## Verification

- Verification criteria are checkboxes.
- Each criterion is testable by a command, test, review step, or observable
  behavior.
- Criteria cover both functional behavior and architectural fit.
- Vague claims such as "works well" or "improves performance" are replaced by
  measurable checks.

## Common Gaps

| Gap | Fix |
| --- | --- |
| Implementation plan says only "update the code" | Name files, modules, interfaces, and patterns. |
| Verification says only "it works" | State the command, test, metric, or review check. |
| Only one option is listed | Record real alternatives or explain why alternatives were rejected. |
| Context assumes tribal knowledge | Define the system, trigger, constraints, and links. |
| Consequences are all positive | Add risks, costs, migration work, and follow-up tasks. |
