---
name: apm-dependency-graph-builder
description: Build semantic dependency, provenance, interaction, and capability-exposure graphs for APM packages from apm.yml, apm.lock.yaml when available, .apm primitives, apm_modules, plugin metadata, MCP declarations, agents, skills, prompts, instructions, and hooks. Use before package synthesis or graph review in modular APM semantic evaluation.
license: MIT

---

# APM Dependency Graph Builder

Build graph evidence for semantic package evaluation. Do not judge quality except for annotating graph uncertainties.

## Trigger contract

Use this skill when a package-level review needs to understand:

- direct and transitive APM dependencies
- which package contributed each component
- activation overlaps or instruction overlaps
- MCP/tool/hook capability exposure
- local versus dependency provenance
- graph paths behind package-level findings


## Calibration reference

Before building graph evidence for a review, read `../../../references/judge-calibration-guide.md` so node/edge confidence, provenance ambiguity, capability surprise, and synthesis usefulness are annotated consistently with the package judges.

## Graph views to build

1. Package dependency graph: root package, direct dependencies, transitive dependencies, local path dependencies, plugin dependencies, declared MCP dependencies.
2. Component provenance graph: which package contributes each skill, prompt, instruction, agent, hook, command, MCP declaration, package doc, or generated output.
3. Semantic interaction graph: activation overlaps, instruction-scope overlaps, prompt bypasses, agent-skill delegation, reviewer-synthesizer handoffs, and conflicts.
4. Capability exposure graph: MCP servers, tool access, hooks, commands, scripts, filesystem writes, network calls, approvals, secrets, and destructive actions.

## Node schema

Each node should include:

- `id`: stable graph id such as `pkg:root`, `skill:root/review`, `agent:root/security-reviewer`
- `type`: package, skill, prompt, instruction, agent, hook, command, script, mcp, tool, resource, generated-output, doc, unknown
- `path`: file path if available
- `package`: owning package id
- `source`: local, direct-dependency, transitive-dependency, generated, external, unknown
- `depth`: dependency depth when known
- `target_harnesses`: known or inferred target harnesses
- `capabilities`: read, write, execute, network, auth, destructive, approval, unknown
- `confidence`: high, medium, low

## Edge schema

Use these edge types:

- `depends_on`
- `contains`
- `declares_mcp`
- `exposes_tool`
- `invokes`
- `preloads_skill`
- `delegates_to`
- `compiled_to`
- `overlaps_with`
- `conflicts_with`
- `constrains`
- `bypasses`
- `shadows`
- `references`
- `unknown_relation`

## Graph construction rules

- Prefer explicit manifest/lockfile/dependency evidence over inference.
- Use `apm.lock.yaml` only as provenance/depth evidence; do not evaluate lock correctness.
- Infer semantic edges from descriptions, applyTo/glob overlap, agent descriptions, prompt workflows, skill descriptions, MCP capabilities, and hook events.
- Mark inferred edges with `confidence: medium` or `low` and a reason.
- Do not hide unknowns; unknown provenance is itself important synthesis evidence.

## Required outputs

1. JSON graph matching `references/dependency-graph.schema.json` when structured output is requested.
2. Mermaid overview for human review when the graph is small enough.
3. A brief coverage summary:
   - package nodes
   - component nodes by type
   - capability nodes
   - direct dependencies
   - transitive dependencies
   - unknown provenance count
   - inferred conflict/overlap edges

## Do not do

- Do not score package quality.
- Do not call `apm audit`.
- Do not claim dependency depth if no evidence exists.
- Do not treat absent evidence as safety.
