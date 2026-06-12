---
name: apm-mcp-component-judge
description: Evaluate MCP server, tool, resource, and prompt declarations for semantic tool quality, capability disclosure, input/output schemas, trust boundary, side effects, annotations, and agent selection risk. Use only when reviewing MCP dependencies or MCP configuration inside an APM semantic package review.
license: MIT

---

# APM MCP Component Judge

Evaluate MCP-related components. Do not synthesize package-level quality.

An MCP component is not just configuration. It changes what tools and data the agent can discover and call. Quality depends on clear tool semantics, schemas, side-effect disclosure, and trust boundaries.

## Trigger contract

Use this judge for:

- `dependencies.mcp` entries in `apm.yml`
- MCP server declarations and per-harness MCP configs
- MCP tools, resources, prompts, transport/config snippets
- transitive MCP capability exposure discovered in the graph

Do not use this judge for ordinary prompts or hooks unless they invoke MCP tools as part of their behavior.


## Calibration reference

Before assigning any score, read `../../../references/judge-calibration-guide.md`. Use it to normalize trigger-quality expectations, evidence classification, score percentages, cap-rule severity, and the distinction between expert value, activation reminders, and redundant content.

## Rubric: 120 points

| Dimension | Max | Evaluation focus |
|---|---:|---|
| M1 Capability Disclosure | 20 | Server/tool purpose, data access, and side effects are visible to users/reviewers. |
| M2 Tool Description Quality | 20 | Tool descriptions are precise enough for safe selection and argument generation. |
| M3 Input/Output Schema Quality | 15 | Schemas constrain parameters and outputs; required fields and errors are clear. |
| M4 Trust Boundary & Provenance | 15 | Source, transport, credentials, and deployment boundary are understandable. |
| M5 Side-Effect & Permission Calibration | 20 | Read/write/network/destructive operations are bounded and justified. |
| M6 Agent Misuse Resistance | 10 | Naming/descriptions avoid over-triggering, ambiguity, or prompt-injection surface. |
| M7 Composition with Package | 10 | MCP capabilities align with package purpose and do not surprise via dependencies. |
| M8 Operational Usability | 10 | Setup assumptions, auth, failure modes, and safe test paths are documented. |

## Cap rules

- Undisclosed write/destructive/network capability: max D and M5 <= 8.
- Tool descriptions are vague enough to cause wrong tool selection: max C and M2 <= 10.
- Missing schema for meaningful parameters: max C and M3 <= 8.
- Credentials/secrets handling unclear: max D.
- Transitive MCP appears without top-level disclosure: max C; if state-changing, max D.
- Tool or resource content includes priority-inverting instructions: max F.


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
## Component Semantic Review: <path-or-server>
- Type: MCP
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Capability class: <read-only|write|network|destructive|unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Capability Disclosure
- Exposed tools/resources/prompts:
- Side effects:
- Credentials/auth assumptions:
- Trust boundary:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
