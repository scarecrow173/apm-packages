---
name: apm-agent-component-judge
description: Evaluate custom agent or subagent components for role boundary, delegation criteria, tool scope, permission assumptions, skill preload strategy, output contracts, isolation, and maintainability. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM Agent Component Judge

Evaluate custom agents and subagents as specialized workers.

## Scope

Review:

- `.apm/agents/*.agent.md`
- `.apm/agents/*.agent.md`
- agent frontmatter
- agent body prompt
- tool declarations
- skill preload declarations
- MCP declarations if scoped to the agent

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| A1 Role Boundary | 15 | Agent has one clear responsibility. |
| A2 Delegation Criteria | 15 | Clear when to invoke it and when not to. |
| A3 Tool & Permission Scope | 15 | Tools are minimal and justified. |
| A4 Skill Preload Strategy | 10 | Preloaded skills are necessary and not bloated. |
| A5 Output Contract | 15 | Return format is concise and useful to parent. |
| A6 Isolation & Context Hygiene | 10 | Avoids flooding parent with raw search/log output. |
| A7 Safety Boundaries | 10 | Handles destructive, network, secret, or write actions safely. |
| A8 Maintainability | 10 | Easy to modify, test, and reason about. |

## Findings to detect

- role overlaps with another agent or skill
- no explicit delegation trigger
- broad tool access without purpose
- permission bypass expectation
- loads many skills unnecessarily
- returns verbose raw data instead of conclusions
- lacks refusal/uncertainty rules
- depends on hidden parent context

## Output

Use the standard component report format with Type `custom-agent`.
