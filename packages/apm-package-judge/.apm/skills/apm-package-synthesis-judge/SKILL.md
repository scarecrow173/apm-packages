---
name: apm-package-synthesis-judge
description: Synthesize component judge reports and dependency graph reports into a package-level semantic quality verdict for APM packages. Evaluate package intent, activation architecture, cross-component coherence, semantic safety, context efficiency, portability, and runtime usefulness. Use only after component reviewers and dependency graph reviewers have produced reports, or when synthesizing supplied reports.
license: MIT

---

# APM Package Synthesis Judge

Synthesize package-level semantic quality from component reports and dependency graph reports.

Do not re-run component scoring unless reports are missing or obviously inconsistent. Do not perform mechanical audit checks.

## Trigger contract

Use this judge when the input includes:

- component semantic review reports
- dependency graph semantic review report
- package inventory plus component findings
- a request for final package-level verdict after modular review

Do not use as the entrypoint when no component/graph review has been performed; start with `apm-semantic-package-judge` instead.


## Calibration references

Before assigning any package-level score, read `../../../references/judge-calibration-guide.md` and `../../../references/graph-aware-synthesis.md`. Use the calibration guide for score normalization, evidence classification, score percentages, and cap-rule severity. Use the graph-aware guide for dependency, provenance, semantic interaction, and capability exposure findings.

## Rubric: 160 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| P1 Package Intent & Value Delta | 20 | Package has a coherent purpose and adds capability beyond generic context. |
| P2 Semantic Scope & Manifest Clarity | 20 | Package scope, primitives, dependencies, and target assumptions are understandable. |
| P3 Activation Architecture | 20 | Entrypoint skill, reviewer agents, component triggers, prompts, and instructions activate predictably. |
| P4 Cross-Component Coherence | 25 | Components reinforce each other; no harmful duplication, shadowing, or contradictions. |
| P5 Semantic Safety & Trust Boundaries | 25 | MCP/tools/hooks/scripts/agents disclose capabilities and respect boundaries. |
| P6 Context Efficiency & Progressive Disclosure | 20 | Package avoids always-on bloat and routes to resources/reviewers only when needed. |
| P7 Portability & Target Fit | 15 | APM primitives are placed correctly and target differences are acknowledged. |
| P8 Runtime Usefulness & Eval Readiness | 15 | Package can be validated by realistic tasks with clear success/failure signals. |

## Synthesis method

1. Normalize every component score to a percentage.
2. Group component findings by type and severity.
3. Read the graph report before making package-level conclusions.
4. Identify whether failures are isolated component issues or package-architecture issues.
5. Apply cap rules.
6. Produce final score, grade, verdict, and fixes.

Component scores are evidence, not a simple average. A package with mostly good components can still fail if graph synthesis shows hidden capability surprise, activation conflicts, or contradictory rules.

## Cap rules

- No clear entrypoint skill or package-level activation route: max C and P3 <= 10.
- Undisclosed transitive MCP/tool capability: P5 <= 10; max C, or D if write/destructive/network-sensitive.
- State-changing hook/command surprise: P5 <= 8 and max D.
- Activation collision affecting primary user tasks: P3 <= 10 and max C.
- Contradictory instruction overlap affecting package behavior: P4 <= 10 and max C.
- Package mostly contains generic advice: P1 <= 8 and max D.
- Always-on context grows substantially through dependencies without value: P6 <= 12.
- Core behavior has unknown provenance: confidence cannot be high.
- Component reviewers did not inspect required primitive types: confidence cannot be high.

## Output

```markdown
# APM Semantic Package Evaluation Report: <package>

## Summary
- Score: <0-160> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Recommended action: <approve|approve with fixes|hold|block|redesign>
- Confidence: <high|medium|low>

## Entrypoint and Trigger Architecture
- Entrypoint skill:
- Expected user trigger phrases:
- Reviewer dispatch path:
- Synthesis path:

## Evidence Reviewed
- Component reports:
- Graph report:
- Inventory coverage:
- Unknowns:

## Dimension Scores
| Dimension | Score | Max | Key evidence |
|---|---:|---:|---|

## Component Score Summary
| Type | Count | Median/Range | Main issue |
|---|---:|---|---|

## Graph-Derived Constraints
- ...

## Blockers
- ...

## High-Risk Findings
- ...

## Cross-Component Conflicts
- ...

## Context and Trigger Efficiency
- ...

## Top Improvements
1. ...
2. ...
3. ...

## Suggested Runtime Eval Tasks
| Task | Expected activation | Expected output | Failure signal |
|---|---|---|---|

## Final Recommendation
<clear conclusion>
```
