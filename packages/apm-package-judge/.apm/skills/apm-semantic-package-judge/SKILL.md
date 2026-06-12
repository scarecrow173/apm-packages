---
name: apm-semantic-package-judge
description: Entry-point orchestrator for semantic quality evaluation of an entire APM package or Claude-plugin-like bundle. Inventory package components, build dependency/provenance/interaction/capability graphs, dispatch skills/agents/prompts/instructions/MCP/hooks to specialist reviewer subagents, collect reports, and synthesize an overall verdict. Use when the user asks to evaluate, judge, review, audit semantically, improve, certify, compare, or approve an APM package; trigger on apm.yml, .apm package, agent package, package-level quality, component judge, dependency graph, or semantic package review. Does not run apm audit or mechanical integrity checks.
license: MIT

---

# APM Semantic Package Judge

This is the entrypoint skill for the package.

Evaluate an APM package as a composed agent capability bundle by combining component specialist reviews with dependency-graph-aware package synthesis.

Do not perform mechanical audit checks. Do not ask for or depend on `apm audit --ci`. This skill evaluates semantic quality only: whether agents that read this package will behave correctly, safely, usefully, and without unnecessary context cost.

## Trigger contract

Use this entrypoint when the user asks to:

- evaluate an APM package
- review package-level semantic quality
- judge whether an agent package should be adopted
- improve a package containing skills, agents, prompts, instructions, MCP, hooks, commands, or plugins
- compare two versions of an APM package semantically
- run the modular judge workflow
- create a package-level report from component reviewers

Do not use this entrypoint for a single isolated `SKILL.md` unless the user explicitly wants package-level review. Use the specialist component judge instead.


## Calibration reference

Before dispatching reviewers, read `../../../references/judge-calibration-guide.md` and `../../../references/dispatch-matrix.md`. Use the calibration guide to keep all component reports comparable and the dispatch matrix to choose the correct reviewer.

## Inputs

Accept any of:

- package root
- `apm.yml` excerpt
- `apm.lock.yaml` excerpt only as dependency/provenance/depth evidence
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

### 2. Build dependency and semantic graph first

Before component dispatch, create a graph report. Use `apm-dependency-graph-reviewer` where available.

Build four views when evidence allows:

1. Package dependency graph.
2. Component provenance graph.
3. Semantic interaction graph.
4. Capability exposure graph.

Use the graph to give component reviewers provenance, overlaps, and capability context. Do not use the graph for lockfile correctness or mechanical integrity.

### 3. Dispatch component reviews

Group files by component type and delegate them to the corresponding reviewer subagent.

Delegation prompt template:

```text
Review these <component-type> components for semantic quality only.
Use <required-skill-name>.
Use the dependency graph context only for provenance, overlap, activation collision, and capability exposure.
Return one component report per component plus an aggregate type summary.
Do not evaluate lockfiles, hashes, hidden Unicode, install drift, or package authenticity.
Evidence must cite paths and excerpts when available.
```

### 4. Collect and normalize reports

Normalize every component report to:

- component path/id
- type
- package/provenance
- source depth if known
- score and percentage
- grade
- verdict
- trigger/activation quality
- output-contract quality
- safety-boundary quality
- context efficiency
- conflicts
- graph-related findings
- top fixes
- confidence

Normalize graph report to:

- graph coverage
- node counts by type
- edge counts by type
- max dependency depth
- capability exposure summary
- cross-component conflict findings
- surprise capability findings
- graph confidence

### 5. Synthesize

Use `apm-package-synthesis-judge` after component and graph reports exist.

The final package verdict must not be a simple average. Apply synthesis cap rules for entrypoint absence, activation collision, contradiction, hidden capability exposure, context bloat, and unknown provenance.

## Entrypoint quality checklist

The package entrypoint is this skill. Its description must contain:

- WHAT: semantic package evaluation orchestration
- WHEN: user asks to evaluate/review/judge/improve/approve an APM package
- KEYWORDS: APM package, apm.yml, `.apm`, semantic review, component judge, dependency graph
- EXCLUSIONS: not mechanical audit, not `apm audit --ci`

## Output

Return either a compact progress summary or the full package synthesis report. Prefer the full report when enough evidence is available.

## Never do

- Do not run or require `apm audit --ci`.
- Do not collapse all component types into one generic rubric.
- Do not let component score averages hide graph-level risks.
- Do not treat transitive capabilities as safe because they are indirect.
- Do not ignore activation descriptions; trigger quality is runtime behavior.
- Do not leave reviewer dispatch implicit.
