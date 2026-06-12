---
name: apm-instruction-component-judge
description: Evaluate individual instruction or rule components for scoped activation, applyTo/glob precision, non-generic behavioral value, contradiction risk, hierarchy fit, context cost, and cross-harness portability. Use only when reviewing .apm/instructions/*.instructions.md, rules, coding standards, guardrails, or always-on context files inside an APM semantic review.
license: MIT

---

# APM Instruction Component Judge

Evaluate individual instruction/rule components. Do not synthesize package-level quality.

An instruction is scope-attached behavior. It is valuable when it narrows agent behavior for a known file/domain context. It is harmful when it is broad, generic, contradictory, or always consumes context without adding decision value.

## Trigger contract

Use this judge for:

- `.apm/instructions/*.instructions.md`
- rules files, coding standards, guardrails, path-specific behavior
- compiled instruction files for harnesses
- CLAUDE.md/AGENTS.md-style rules only when they are part of the APM package being reviewed

Do not use this judge for callable workflows; those are prompts or skills.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| I1 Scope & Trigger Precision | 20 | `description` and `applyTo`/glob scope are specific and justified. |
| I2 Behavioral Value Delta | 20 | Rules are project/domain-specific, not generic best practices. |
| I3 Normative Clarity | 15 | Uses clear MUST/SHOULD/NEVER language where appropriate. |
| I4 Conflict Resistance | 15 | Avoids contradictions and defines precedence/escalation when overlap is likely. |
| I5 Freedom Calibration | 10 | Constraint strength matches consequence of mistakes. |
| I6 Context Efficiency | 15 | Short enough for always-on use; removes boilerplate and tutorials. |
| I7 Cross-Harness Portability | 10 | Avoids assumptions that break when compiled to other targets. |
| I8 Examples & Edge Cases | 15 | Includes minimal examples, exceptions, and failure cases for non-obvious rules. |

## Cap rules

- Missing or over-broad scope for always-on instructions: max C and I1 <= 10.
- Generic rules like “write clean code” dominate: max D and I2 <= 8.
- Contradicts another instruction in the same package/dependency graph: max C; if safety-relevant, max D.
- Long tutorial content in instructions: I6 <= 6.
- Instructions claim to override user/system/developer constraints: max F.


## Shared evaluation protocol

1. Read the component completely before scoring. If the file references nearby resources, inspect only resources needed to judge activation, output contract, safety boundaries, or workflow viability.
2. Mark evidence as one of:
   - Expert: non-obvious knowledge, decision criteria, trade-offs, edge cases, constraints, or anti-patterns.
   - Activation: short reminders that help the agent select the right workflow.
   - Redundant: generic advice the base model almost certainly already knows.
3. Score each dimension from evidence. Do not award points for professional formatting alone.
4. Apply cap rules after adding the raw score.
5. Return concrete fixes that improve activation, expert knowledge density, safety boundaries, or runtime usability.

## Grade scale

| Grade | Percentage | Meaning |
|---|---:|---|
| A | 90-100% | Excellent, production-ready for this component type. |
| B | 80-89% | Good, minor targeted fixes. |
| C | 70-79% | Usable but needs meaningful improvement. |
| D | 60-69% | Significant quality or safety problems. |
| F | <60% | Fundamentally weak, unsafe, or not useful. |

## Report requirements

Every finding must name a path and cite a short excerpt or observable property when available. If evidence is missing, lower confidence rather than guessing.

## Output

```markdown
## Component Semantic Review: <path>
- Type: instruction
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Scope: <glob/applyTo/unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Scope Assessment
- Applies to:
- Should not apply to:
- Likely overlaps:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
