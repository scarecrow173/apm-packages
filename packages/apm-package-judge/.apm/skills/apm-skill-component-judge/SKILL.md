---
name: apm-skill-component-judge
description: Evaluate individual Agent Skill components such as SKILL.md files for semantic quality, activation contract, progressive disclosure, expert knowledge delta, boundaries, workflow clarity, and practical usability. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM Skill Component Judge

Evaluate individual skill components only. Do not synthesize package-level quality.

## Scope

Review:

- `SKILL.md`
- skill frontmatter
- skill resources referenced by the skill
- examples belonging to the skill

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| S1 Activation Contract | 15 | `description` makes when-to-use clear and specific. |
| S2 Knowledge Delta | 15 | Adds expert or project-specific knowledge the base model likely lacks. |
| S3 Workflow Quality | 15 | Gives actionable procedure, not vague advice. |
| S4 Progressive Disclosure | 15 | Keeps main file concise and pushes detail into resources. |
| S5 Boundaries & Anti-Patterns | 10 | Says what not to do and when not to use the skill. |
| S6 Output Contracts | 10 | Defines expected outputs, formats, or examples. |
| S7 Context Efficiency | 10 | Avoids generic, duplicated, or always-loaded bloat. |
| S8 Practical Usability | 10 | Can be applied to realistic tasks with low ambiguity. |

## Findings to detect

- vague description
- generic best practices
- missing activation triggers
- bloated `SKILL.md`
- buried critical instructions
- no output format
- no failure handling
- redundant examples
- unsafe or over-broad instructions

## Output

For each skill, report:

```markdown
## Component Semantic Review: <path>
- Type: skill
- Score: <0-100>
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Findings
- ...

### Top Fixes
1. ...
```
