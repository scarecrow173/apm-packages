---
name: apm-prompt-component-judge
description: Evaluate prompt and slash-command prompt components for task specificity, variable contract, expected outputs, assumptions, safety boundaries, composability with skills/agents, and failure behavior. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM Prompt Component Judge

Evaluate prompts as reusable task entrypoints.

## Scope

Review:

- prompt files
- slash command prompts
- command descriptions if natural-language driven
- argument placeholders
- expected output definitions

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| PR1 Task Specificity | 15 | Prompt has a focused task, not a generic roleplay. |
| PR2 Input Contract | 15 | Variables, assumptions, and prerequisites are clear. |
| PR3 Output Contract | 15 | Expected output format and decision criteria are clear. |
| PR4 Workflow Adequacy | 15 | Steps are sufficient but not over-prescriptive. |
| PR5 Safety & Authorization | 10 | Does not bypass review, permissions, or user intent. |
| PR6 Composability | 10 | Works with related skills/agents instead of duplicating or bypassing them. |
| PR7 Error Handling | 10 | Handles missing, invalid, or ambiguous inputs. |
| PR8 Context Efficiency | 10 | Concise; avoids embedding large generic instructions. |

## Findings to detect

- prompt asks for broad unsafeguarded changes
- no input variables documented
- no expected output
- contradicts instructions or skills
- duplicates a skill workflow
- hides side effects
- too generic to be reusable

## Output

Use the standard component report format with Type `prompt`.
