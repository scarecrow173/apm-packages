# Graph-Aware Package Synthesis

Use dependency graph findings as package-level evidence. Do not treat them as another component report; graph findings describe emergent behavior created by composition.

## Graph inputs

Expected inputs:

- dependency graph JSON
- dependency graph semantic review report
- component review reports
- package inventory
- package docs or manifest excerpts

## How to use graph findings

### P1 Package Intent & Value Delta

Reduce P1 when:

- unrelated dependency branches introduce capabilities outside the package purpose
- transitive dependency provides the core value while root package docs do not explain the composition
- graph shows many support components but no clear center of gravity

### P2 Component Coverage & Role Separation

Reduce P2 when:

- multiple components play the same role
- provenance graph shows duplicate skills/instructions from different packages
- component responsibilities cannot be traced to package intent

### P3 Activation Architecture

Reduce P3 when:

- semantic interaction graph shows activation collisions
- multiple skills/agents/prompts target the same task without precedence
- prompts bypass intended skills or agents

### P4 Cross-Component Coherence

Reduce P4 when:

- instruction overlap edges are contradictory
- prompts, skills, and agents prescribe incompatible workflows
- local overrides shadow dependency behavior without documentation

### P5 Semantic Safety & Trust Boundaries

Reduce P5 when:

- capability exposure graph shows undisclosed MCP/tools/hooks/scripts
- state-changing capabilities appear through dependencies
- agents have broad tool access without package-level disclosure
- graph shows a path from a benign prompt to a mutating command or hook

### P6 Context Efficiency

Reduce P6 when:

- dependency graph adds broad always-on instructions
- many similar instructions or skills are loaded for the same domain
- root package includes transitive context not needed for the stated use case

### P7 Runtime Usefulness

Reduce P7 when:

- graph cannot identify clear task activation paths
- core runtime path requires many unrelated components
- representative tasks activate conflicting components

### P8 Maintainability & Evolvability

Reduce P8 when:

- provenance is ambiguous
- important behavior comes from deep dependencies
- graph has high fan-in/fan-out without documentation
- ownership boundaries are unclear

## Default cap rules

| Graph finding | Package impact |
|---|---|
| Critical surprise capability | max grade D; P5 <= 8 |
| Undisclosed transitive MCP/tool | P5 <= 10 |
| Runtime activation collision | P3 <= 10; max grade C |
| Contradictory overlapping instruction | P4 <= 10; max grade C |
| Prompt bypasses intended safety path | P4 <= 12 and P5 <= 12 |
| Deep dependency dominance without docs | P1 <= 12 and P8 <= 14 |
| Dependency-induced context bloat | P6 <= 12 |
| Provenance ambiguity for core behavior | confidence cannot be high |

## Reporting requirement

The final package report must include a `Dependency / Interaction Graph Findings` section even if the graph is partial. If no graph could be built, state why and lower confidence for dependency-using packages.
