---
name: apm-dependency-graph-judge
description: Evaluate an APM package dependency/provenance/interaction/capability graph for semantic package quality risks such as transitive capability surprise, instruction conflicts, activation collisions, context bloat, dependency-depth risk, provenance ambiguity, and unsafe tool/hook/MCP exposure. Use after apm-dependency-graph-builder.
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
---

# APM Dependency Graph Judge

Evaluate graph-derived semantic risk. This skill judges the graph as evidence for package-level semantic quality, not mechanical install integrity.

## Scope

Review graph data produced by `apm-dependency-graph-builder`:

- package dependency graph
- component provenance graph
- semantic interaction graph
- capability exposure graph
- Mermaid or tabular graph summaries
- component inventory, if provided

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| G1 Graph Coverage & Evidence Quality | 10 | Graph includes enough nodes, edges, evidence, and confidence notes. |
| G2 Dependency Clarity | 15 | Direct, transitive, local, plugin-like, and MCP dependencies are understandable. |
| G3 Provenance Attribution | 15 | Components can be traced to root or dependency package sources. |
| G4 Semantic Interaction Accuracy | 15 | Overlap, conflict, constraint, delegation, and bypass edges are useful and evidence-based. |
| G5 Capability Exposure Clarity | 15 | Tool, MCP, hook, command, script, and permission exposure is visible. |
| G6 Risk Detection | 15 | Graph reveals surprise capabilities, activation collisions, instruction conflicts, and unsafe paths. |
| G7 Synthesis Utility | 10 | Findings are actionable for package-level scoring and fixes. |
| G8 Visualization & Communication | 5 | Graph summary is readable enough for reviewers. |

## Findings to detect

### Transitive capability surprise

A dependency introduces MCP, hook, command, script, or tool permission behavior not disclosed by the root package.

Impact:

- P5 Semantic Safety should be capped at 10 or lower.
- If state-changing behavior is undisclosed, final grade should be capped at D.

### Activation collision

Two skills, prompts, or agents compete for the same user intent without precedence or delegation.

Impact:

- P3 Activation Architecture should be capped at 10 or lower when normal use is affected.

### Instruction conflict

Overlapping instruction scopes contain contradictory or mutually confusing requirements.

Impact:

- P4 Cross-Component Coherence should be capped at 10 or lower.

### Context bloat path

Dependency graph introduces always-on or broad-scope instructions that add significant context without clear package value.

Impact:

- P6 Context Efficiency should be capped at 12 or lower.

### Provenance ambiguity

A behavior-relevant component cannot be traced to root, direct dependency, or transitive dependency.

Impact:

- Confidence cannot be high.
- P8 Maintainability should be reduced.

### Deep dependency dominance

A transitive dependency, not the root package, provides the core package behavior.

Impact:

- P1 Package Intent and P2 Role Separation should be reduced unless the root package clearly documents that composition role.

### Safety path through hooks/commands/scripts

A prompt, agent, or skill leads to a hook, command, or script that mutates files, git state, network, or secrets without a clear user-facing trust boundary.

Impact:

- P5 should be capped at 8 or lower.
- Recommendation should be hold or block.

## Output

Produce a `Dependency Graph Semantic Review Report`:

```markdown
# Dependency Graph Semantic Review Report

## Summary
- Score: <0-100>
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

## Graph Coverage
| View | Status | Evidence | Unknowns |
|---|---|---|---|

## Graph Metrics
- Package nodes:
- Component nodes:
- Capability nodes:
- Edge count:
- Highest dependency depth:
- Highest-risk edge:

## Findings
| Severity | Finding | Evidence | Package synthesis impact | Fix |
|---|---|---|---|---|

## Cap Recommendations
List package-level score caps that the synthesizer should apply.

## Mermaid Overview
Optional compact graph.
```

Use `references/graph-report.schema.json` when structured output is requested.
