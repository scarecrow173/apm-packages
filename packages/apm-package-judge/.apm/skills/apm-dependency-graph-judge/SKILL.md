---
name: apm-dependency-graph-judge
description: Evaluate an APM semantic dependency graph for capability surprise, provenance ambiguity, activation collisions, instruction overlap, transitive MCP or hook exposure, context bloat, cohesion risk, and synthesis-impacting graph findings. Use after apm-dependency-graph-builder has produced graph evidence.
license: MIT

---

# APM Dependency Graph Judge

Evaluate graph-level semantic quality. Do not judge individual component content except through graph relationships.

## Trigger contract

Use this judge after graph construction when package synthesis needs structural findings from:

- package dependency graph
- component provenance graph
- semantic interaction graph
- capability exposure graph


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| G1 Graph Coverage & Evidence Quality | 15 | Graph includes enough nodes/edges/provenance to support conclusions. |
| G2 Dependency Depth & Cohesion | 15 | Dependency depth and package relationships align with package purpose. |
| G3 Provenance Clarity | 15 | Core behavior can be traced to local/direct/transitive sources. |
| G4 Activation Collision Risk | 15 | Skills, agents, prompts, and instructions do not compete for the same trigger domain. |
| G5 Instruction/Rule Overlap Risk | 15 | applyTo/glob overlaps are intentional and non-contradictory. |
| G6 Capability Surprise | 20 | MCP/tools/hooks/scripts/commands are disclosed and not introduced unexpectedly. |
| G7 Context Bloat & Always-On Load | 10 | Dependency composition does not add excessive always-on context. |
| G8 Synthesis Usefulness | 15 | Findings are concrete enough to constrain package-level scoring. |

## Cap rules

- Undisclosed transitive MCP/tool exposure: max C; if write/destructive/network-sensitive, max D.
- State-changing hook/command from dependency without top-level disclosure: max D.
- Conflicting instructions on the same scope: max C; safety-relevant conflict max D.
- Core package behavior has unknown provenance: confidence cannot be high.
- No usable graph evidence: max D and G1 <= 5.


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
## Dependency Graph Semantic Review Report
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Graph coverage: <high|medium|low>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Graph Summary
- Package nodes:
- Component nodes by type:
- Capability nodes:
- Max dependency depth:
- Unknown provenance:

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Synthesis Constraints
- ...

### Graph Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
