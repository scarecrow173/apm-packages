---
name: apm-package-synthesis-judge
description: Synthesize specialist component-review reports plus dependency/provenance/semantic-interaction/capability-graph findings into an overall semantic quality evaluation of an APM package. Use after component reviewers and dependency graph reviewer have produced reports.
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
---

# APM Package Synthesis Judge

Synthesize component reports and graph findings into package-level semantic quality. This skill is not a component reviewer and does not perform mechanical audit.

## Inputs

- component inventory
- specialist reviewer reports
- dependency graph JSON or graph review report
- package docs and manifest excerpts, if available
- known target harnesses

## Package rubric: 160 points

| Dimension | Max | Meaning |
|---|---:|---|
| P1 Package Intent & Value Delta | 20 | The whole package has clear, non-generic value. |
| P2 Component Coverage & Role Separation | 20 | Components cover necessary roles without duplication. |
| P3 Activation Architecture | 20 | Users and agents can predict which component activates. |
| P4 Cross-Component Coherence | 20 | Components compose without contradictions. |
| P5 Semantic Safety & Trust Boundaries | 20 | The package avoids unsafe emergent behavior and surprise capabilities. |
| P6 Context Efficiency | 20 | Context cost and dependency-induced bloat are justified and minimized. |
| P7 Runtime Usefulness | 20 | The package improves realistic tasks. |
| P8 Maintainability & Evolvability | 20 | Structure, provenance, graph clarity, tests, ownership, and docs support updates. |

## Synthesis rules

Do not compute the score as a raw average.

Use graph findings to adjust component findings. A weak graph can reveal package-level issues even when each component looks acceptable in isolation.

Cap rules:

- Any critical semantic safety blocker: max grade D.
- Undisclosed state-changing MCP/hook/command/script: P5 <= 8 and max grade D.
- Undisclosed transitive MCP/tool/capability: P5 <= 10.
- Multiple activation collisions affecting normal use: P3 <= 10 and max grade C.
- Contradictory instructions in overlapping scopes: P4 <= 10 and max grade C.
- Prompt or command bypasses intended skill/agent safety path: P4 <= 12 and P5 <= 12.
- Dependency graph shows transitive component dominance without documentation: P1 <= 12 and P8 <= 14.
- Dependency graph is unavailable or too incomplete for a dependency-using package: confidence cannot be high.
- Package lacks a clear purpose: P1 <= 8 and max grade C.
- Most components are generic: P1 <= 10 and P6 <= 10.
- No runtime eval tasks possible: P7 <= 10.
- Component coverage incomplete due to missing files: confidence cannot be high.

## Required synthesis sections

- graph summary
- component coverage matrix
- cross-component conflict matrix
- dependency/provenance findings
- capability exposure findings
- emergent safety risks
- context efficiency assessment
- top package-level fixes
- final recommendation

## Output

Use the package report template from `references/package-report.schema.json` when structured output is requested.
