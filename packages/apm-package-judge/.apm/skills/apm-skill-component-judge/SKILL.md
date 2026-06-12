---
name: apm-skill-component-judge
description: Evaluate individual Agent Skill components such as SKILL.md files for expert knowledge delta, activation description quality, progressive disclosure, anti-patterns, freedom calibration, output contracts, and practical usability. Use only when reviewing skill components inside an APM package or Claude-plugin-like bundle; trigger on SKILL.md, skill package, Agent Skill, progressive disclosure, skill activation, skill description, skill resources, or skill quality review.
license: MIT

---

# APM Skill Component Judge

Evaluate individual Agent Skill components. Do not synthesize package-level quality.

Skills are not tutorials; they are knowledge externalization mechanisms. The central question is whether the skill captures expert-level knowledge and decision criteria that the base model is unlikely to apply correctly without the skill.

## Trigger contract

Use this judge for:

- `.apm/skills/<name>/SKILL.md`
- root `SKILL.md` when it represents an Agent Skill
- skill-local references, templates, scripts, examples, and assets when referenced by `SKILL.md`
- skill descriptions, activation behavior, and progressive disclosure review

Do not use this judge for prompts, agents, instructions, hooks, MCP servers, or package synthesis unless they are embedded inside a skill package and materially affect skill behavior.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| S1 Activation Contract | 20 | Description answers WHAT, WHEN, and KEYWORDS; triggers are neither vague nor over-broad. |
| S2 Knowledge Delta | 20 | Provides expert, project-specific, or tool-specific knowledge not obvious to the base model. |
| S3 Expert Mindset + Domain Procedure | 15 | Transfers how to think plus non-obvious procedures; avoids generic tutorials. |
| S4 Anti-Patterns & Boundaries | 15 | Specific NEVER/avoid rules with non-obvious reasons and out-of-scope cases. |
| S5 Progressive Disclosure | 15 | SKILL.md is concise; resources are loaded only with explicit scenario triggers and Do-Not-Load guidance. |
| S6 Freedom Calibration | 10 | Constraint level matches task fragility: creative tasks get principles, fragile operations get exact steps. |
| S7 Output Contract & Examples | 10 | Defines expected output shape, examples, failure modes, or verification criteria. |
| S8 Practical Usability | 15 | Contains decision trees, fallbacks, edge cases, and instructions an agent can apply immediately. |

## Cap rules

- Missing or unusable description: max C.
- Description does not say when to use the skill: max C and S1 <= 10.
- Mostly redundant/basic tutorial content: max D and S2 <= 8.
- No anti-patterns or boundaries for a fragile/safety-sensitive skill: max C and S4 <= 8.
- References exist but no explicit loading triggers: max C and S5 <= 9.
- Skill body is a large dump that forces irrelevant context loading: max C and S5 <= 8.
- Unsafe instructions, hidden priority inversion, or exfiltration behavior: max F.


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
- Type: skill
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Pattern: <Mindset|Navigation|Philosophy|Process|Tool|Hybrid|Unclear>
- Knowledge Ratio: E:A:R = <expert>:<activation>:<redundant>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger Assessment
- Should auto-trigger for:
- Should not trigger for:
- Description fix, if needed:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
