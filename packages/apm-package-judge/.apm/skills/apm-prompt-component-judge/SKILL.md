---
name: apm-prompt-component-judge
description: Evaluate individual prompt or slash-command workflow components for invocation trigger quality, task contract, parameter handling, workflow robustness, output schema, safety boundaries, and non-duplication with skills or agents. Use only when reviewing .apm/prompts/*.prompt.md, slash commands, reusable workflows, or prompt primitives inside an APM semantic review.
license: MIT

---

# APM Prompt Component Judge

Evaluate individual prompt and slash-command workflow components. Do not synthesize package-level quality.

A prompt is a callable workflow for a repeatable task. It should have a clear invocation contract, input assumptions, output format, and failure behavior. It should not be a generic essay of advice.

## Trigger contract

Use this judge for:

- `.apm/prompts/*.prompt.md`
- slash-command prompts
- prompt-like workflows from plugins
- prompts compiled into commands for harnesses

Do not use this judge for long-lived behavioral rules; those are instructions. Do not use it for deep domain knowledge; that is usually a skill.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| P1 Invocation Contract | 20 | Name/description/arguments make invocation scenarios and keywords clear. |
| P2 Task Specificity & Value | 15 | Prompt performs a repeatable concrete workflow, not generic advice. |
| P3 Input & Parameter Handling | 15 | Required arguments, defaults, missing-input behavior, and assumptions are explicit. |
| P4 Workflow Robustness | 15 | Steps are ordered, conditional, and include checks/fallbacks where needed. |
| P5 Output Contract | 20 | Expected output format, sections, schemas, or examples are specified. |
| P6 Safety & Side-Effect Boundaries | 15 | Describes permission, command, write, network, or approval boundaries. |
| P7 Non-Duplication & Composition | 10 | Does not duplicate skills/agents/instructions; composes with them cleanly. |
| P8 Context Efficiency | 10 | Concise, no generic preamble, no irrelevant explanation. |

## Cap rules

- No clear invocation scenario: max C and P1 <= 10.
- No output contract for a workflow prompt: max C and P5 <= 10.
- Prompt instructs unsafe auto-execution or bypasses review/approval: max D or F.
- Prompt is merely generic instructions: max D and P2 <= 6.
- Prompt conflicts with package-level safety/instructions: max C and flag for synthesis.


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
- Type: prompt
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Invocation Assessment
- Invoke when:
- Required inputs:
- Missing-input behavior:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
