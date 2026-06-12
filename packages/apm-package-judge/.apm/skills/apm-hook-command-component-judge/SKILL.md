---
name: apm-hook-command-component-judge
description: Evaluate hook, command, and script components for lifecycle trigger precision, deterministic behavior, matcher scope, side effects, permission boundaries, idempotency, failure handling, and semantic fit. Use only when reviewing .apm/hooks/*.json, hook declarations, scripts, command-like automation, or lifecycle handlers inside an APM semantic package review.
license: MIT

---

# APM Hook/Command Component Judge

Evaluate hooks, command automation, and scripts. Do not synthesize package-level quality.

Hooks are high-risk because they run at lifecycle points rather than waiting for the model to choose them. Good hooks are narrow, deterministic, idempotent, observable, and explicit about side effects.

## Trigger contract

Use this judge for:

- `.apm/hooks/*.json`
- hook declarations embedded in agents, skills, settings, or plugin metadata
- scripts invoked by hooks or package workflows
- lifecycle commands and deterministic automation
- command-like files that mutate state or run tools

Do not use this judge for natural-language prompt workflows unless they run as lifecycle automation.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| H1 Lifecycle Trigger & Matcher Precision | 20 | Event, matcher, conditions, and scope are narrow and intentional. |
| H2 Determinism & Idempotency | 15 | Behavior is predictable, repeatable, and safe if run multiple times. |
| H3 Side-Effect Disclosure | 20 | File writes, command execution, network calls, approvals, and mutations are explicit. |
| H4 Permission & Safety Boundary | 20 | Least privilege, protected-file handling, confirmation/escalation, and secret safety. |
| H5 Failure Handling & Observability | 15 | Timeouts, nonzero exits, logs, and user-facing errors are clear. |
| H6 Semantic Fit | 10 | Hook solves a deterministic enforcement/automation problem, not an LLM judgment problem. |
| H7 Cross-Harness Portability | 10 | Shell/platform/target assumptions are explicit. |
| H8 Package Composition Risk | 10 | Does not surprise users via dependencies or conflict with prompts/agents/instructions. |

## Cap rules

- Broad matcher such as `.*` for permission or tool approval without strong justification: max D.
- Silent state mutation: max D and H3 <= 8.
- Reads or exposes secrets without explicit purpose and safeguards: max F.
- Multiple hooks modify the same input/order-sensitive data without determinism: max C.
- Long-running or network hook without timeout/error contract: max C.
- Lifecycle automation used for model judgment when a prompt/agent hook would be safer: H6 <= 5.


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
- Type: hook-command
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Lifecycle/event: <event|unknown>
- Capability class: <read|write|execute|network|approval|unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger and Side-Effect Assessment
- Event/matcher:
- Side effects:
- Failure behavior:
- Recommended scope change:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
