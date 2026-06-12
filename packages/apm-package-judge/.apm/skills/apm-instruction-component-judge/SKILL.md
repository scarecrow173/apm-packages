---
name: apm-instruction-component-judge
description: Evaluate instruction/rules components for scope precision, conflict potential, behavioral clarity, priority hygiene, context cost, and portability across agent harnesses. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM Instruction Component Judge

Evaluate always-on or scoped instruction files.

## Scope

Review:

- `.instructions.md`
- `CLAUDE.md`-like files
- project rules
- coding standards injected into agent context
- path/glob-scoped instructions

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| I1 Scope Precision | 15 | Applies only where needed. |
| I2 Behavioral Clarity | 15 | Gives concrete constraints, not vague preferences. |
| I3 Non-Contradiction | 15 | Does not conflict with other rules in likely overlapping scope. |
| I4 Priority Hygiene | 10 | Does not try to override higher-priority instructions. |
| I5 Context Cost | 15 | Short enough for always-on use; no generic bloat. |
| I6 Portability | 10 | Does not assume unavailable harness behavior. |
| I7 Testability | 10 | Compliance can be checked from outputs or diffs. |
| I8 Failure Handling | 10 | Handles exceptions and edge cases. |

## Findings to detect

- global rules that should be scoped
- generic coding advice
- contradictory rules
- instruction injection patterns
- too much prose for always-on context
- unclear precedence
- target-specific assumptions not documented

## Output

Use the standard component report format with Type `instruction`.
