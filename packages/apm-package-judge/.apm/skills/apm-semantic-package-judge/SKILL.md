---
name: apm-semantic-package-judge
description: Orchestrate semantic evaluation of an APM package by inventorying components, building a dependency/provenance/interaction/capability graph, dispatching component types to specialist reviewer subagents, collecting component and graph reports, and synthesizing an overall package-quality verdict. Use when the user wants package-level semantic quality evaluation without apm audit or mechanical integrity checks.
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
---

# APM Semantic Package Judge

Evaluate an APM package as a composed agent capability bundle by combining component specialist reviews with dependency-graph-aware package synthesis.

Do not perform mechanical audit checks. Do not ask for or depend on `apm audit --ci`. This skill evaluates semantic quality only.

## Inputs

Accept any of:

- package root
- `apm.yml` excerpt
- `apm.lock.yaml` excerpt when available, only as evidence for dependency/provenance/depth
- directory tree
- package files
- `.apm/skills`, `.apm/prompts`, `.apm/instructions`, `.apm/agents`, hooks, commands, MCP declarations
- `apm_modules/` excerpts or dependency package trees
- Claude-plugin-like bundle
- prior component reports
- prior dependency graph report

If files are unavailable, evaluate only provided evidence and mark unknowns.

## Orchestration model

Use specialist reviewers when the environment supports subagents. The main agent remains responsible for dispatch and final synthesis.

Specialist mapping:

| Artifact | Reviewer subagent | Required skill |
|---|---|---|
| Dependency/provenance/interaction/capability graph | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` |
| Skill / `SKILL.md` | `apm-skill-reviewer` | `apm-skill-component-judge` |
| Custom agent / subagent | `apm-agent-reviewer` | `apm-agent-component-judge` |
| Prompt / slash command prompt | `apm-prompt-reviewer` | `apm-prompt-component-judge` |
| Instruction / rules file | `apm-instruction-reviewer` | `apm-instruction-component-judge` |
| MCP server/tool/resource/prompt declaration | `apm-mcp-reviewer` | `apm-mcp-component-judge` |
| Hook / command / script | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` |
| Package synthesis | `apm-package-synthesizer` | `apm-package-synthesis-judge` |

If subagents are unavailable, run the same specialist skills sequentially in the main conversation and label each report by review type.

## Workflow

### 1. Inventory

Create a component inventory from the package tree. Classify each item:

- package
- skill
- custom-agent
- prompt
- instruction
- MCP
- hook-command
- package-doc
- generated-output
- dependency-package
- unknown

For each component record:

- path
- type
- source: local, direct dependency, transitive dependency, generated, unknown
- likely activation trigger
- intended user task
- target harnesses
- safety-sensitive capabilities
- whether it should be reviewed

### 2. Build semantic dependency graph

Before component dispatch, create a graph report. Use `apm-dependency-graph-reviewer` where available.

The graph must not be limited to package edges. Build four views when evidence allows:

1. Package dependency graph: root package, direct dependencies, transitive dependencies, local dependencies, and declared MCP dependencies.
2. Component provenance graph: which package or dependency contributes each skill, agent, prompt, instruction, hook, command, MCP declaration, or generated output.
3. Semantic interaction graph: activation overlaps, instruction-scope overlaps, agent-skill handoffs, prompt bypasses, and component conflicts.
4. Capability exposure graph: tools, MCP servers, hooks, scripts, commands, network access, file writes, and other safety-sensitive capabilities.

If `apm.lock.yaml` is available, use it as evidence for dependency depth and resolved package provenance. Do not evaluate lock correctness or drift.

Require the graph reviewer to output:

- JSON graph according to `references/dependency-graph.schema.json`
- Mermaid overview where useful
- `Dependency Graph Semantic Review Report` according to `references/graph-report.schema.json`
- findings that can be consumed by package synthesis

### 3. Dispatch component reviews

Group files by component type and delegate them to the corresponding reviewer subagent.

When a dependency graph is available, include relevant graph context in each reviewer prompt:

- component provenance
- direct/transitive dependency source
- overlapping components
- capability exposure
- known interaction/conflict edges

Delegation prompt template:

```text
Review these <component-type> components for semantic quality only.
Use <required-skill-name>.
Use the dependency graph context only for provenance, overlap, and capability context.
Return one component report per component plus an aggregate type summary.
Do not evaluate lockfiles, hashes, hidden Unicode, install drift, or package authenticity.
Evidence must cite paths and excerpts when available.
```

Require each reviewer to output `Component Semantic Review Report` using `references/component-report.schema.json` where structured output is requested.

### 4. Collect reports

Normalize every component report into:

- component id/path
- component type
- package/provenance
- source depth if known
- score out of 100
- grade
- verdict
- activation quality
- output-contract quality
- safety-boundary quality
- context efficiency
- conflicts
- graph-related findings
- top fixes
- confidence

Normalize the graph report into:

- graph coverage
- node counts by type
- edge counts by type
- dependency depth summary
- capability exposure summary
- cross-component conflict findings
- surprise capability findings
- graph confidence

### 5. Synthesize

Use `apm-package-synthesis-judge` to produce package-level findings.

The synthesis must not simply average component scores. Penalize system-level issues discovered from reports and graph analysis:

- conflicting activation domains
- contradictory instructions
- duplicated responsibilities
- missing handoff between agents and skills
- prompts bypassing skills or agents
- MCP/tools introduced without semantic disclosure
- hooks/commands changing behavior invisibly
- transitive capability surprise
- deep or unexplained dependency chains that dominate package behavior
- context bloat from many always-on instructions
- package purpose fragmented across unrelated components

### 6. Final report

Produce:

```markdown
# APM Semantic Package Evaluation Report: <package>

## Summary
- Score: <0-160>
- Grade: <A-F>
- Recommendation: <approve | approve with fixes | hold | block | redesign>
- Confidence: <high | medium | low>
- Evaluation mode: specialist subagents | sequential specialist review | partial evidence

## Graph Summary
- Graph built: <yes | partial | no>
- Package nodes:
- Component nodes:
- Capability nodes:
- Highest dependency depth:
- Most important graph finding:

## Component Review Coverage
| Type | Count | Reviewer | Avg Score | Worst Finding |
|---|---:|---|---:|---|

## Component Findings
Summarize each specialist report.

## Dependency / Interaction Graph Findings
List dependency-depth, provenance, interaction, and capability-exposure findings.

## Cross-Component Findings
List package-level conflicts, gaps, and emergent behavior.

## Package Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|
| P1 Package Intent & Value Delta | | 20 | |
| P2 Component Coverage & Role Separation | | 20 | |
| P3 Activation Architecture | | 20 | |
| P4 Cross-Component Coherence | | 20 | |
| P5 Semantic Safety & Trust Boundaries | | 20 | |
| P6 Context Efficiency | | 20 | |
| P7 Runtime Usefulness | | 20 | |
| P8 Maintainability & Evolvability | | 20 | |

## Blockers

## Top Fixes

## Final Recommendation
```

## Rules

- Do not let a strong individual component hide package-level incoherence.
- Do not let package-level intent compensate for unsafe or unclear components.
- Do not claim subagent review occurred unless a subagent or equivalent specialist pass was actually performed.
- Do not claim a graph was built unless graph evidence was actually gathered or supplied.
- Do not evaluate mechanical integrity.
- Do not perform code execution unless explicitly needed for reading files and allowed by the user.
- Prefer explicit evidence over inference.
