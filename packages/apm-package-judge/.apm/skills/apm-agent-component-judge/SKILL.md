---
name: apm-agent-component-judge
description: Evaluate individual custom agent or subagent components for delegation trigger quality, persona boundary, tool permissions, preloaded skills, output contract, isolation value, safety limits, and overlap with skills or instructions. Use only when reviewing .apm/agents/*.agent.md, Claude Code subagents, Copilot/Cursor/Codex agent files, or package agent personas inside an APM semantic review.
license: MIT

---

# APM Agent Component Judge

Evaluate individual custom agent/subagent components. Do not synthesize package-level quality.

An agent is valuable when it gives a model a well-bounded role, a clear delegation trigger, appropriate tools, and a return contract. It is weak when it is just a vague persona or duplicates a skill.

## Trigger contract

Use this judge for:

- `.apm/agents/*.agent.md`
- Claude Code custom subagents
- agent personas from plugins
- agent definitions transformed for Copilot, Cursor, Codex, OpenCode, or similar harnesses
- reviewer subagents that preload judge skills

Do not use this judge for reusable task instructions that should be skills or prompts instead.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| A1 Delegation Trigger | 20 | Description says exactly when to delegate and includes task/domain keywords. |
| A2 Role Boundary & Expertise | 15 | Persona is narrow, expert, and non-generic; responsibilities are explicit. |
| A3 Tool & Permission Calibration | 20 | Tools are least-privilege and match the task; dangerous capabilities are justified. |
| A4 Skill Preload & Knowledge Fit | 10 | Preloaded skills are necessary, not excessive, and aligned with the agent role. |
| A5 Workflow & Decision Protocol | 15 | Agent has a concrete review/decision workflow rather than vague behavior. |
| A6 Output Contract | 10 | Return format is clear, concise, and useful to the parent conversation. |
| A7 Isolation & Context Economy | 10 | Agent justifies separate context and prevents main-context flooding. |
| A8 Safety Boundaries & Non-Goals | 20 | Agent states what it must not do, when to escalate, and how to handle uncertainty. |

## Cap rules

- Missing description or unclear delegation trigger: max C and A1 <= 10.
- Broad tool access without justification: max C, or D if tools can mutate files/network/state.
- Agent duplicates an existing skill without a distinct isolation or tool-boundary reason: max C.
- Agent returns raw dumps instead of a useful summary: A6 <= 5 and A7 <= 6.
- Agent has authority-expanding language that overrides user/system/package rules: max F.


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
- Type: custom-agent
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger Assessment
- Delegate when:
- Do not delegate when:
- Potential collisions:

### Tool Boundary Assessment
- Allowed tools:
- Excessive or missing tools:
- Recommended change:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
