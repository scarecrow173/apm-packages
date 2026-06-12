# apm-package-judge

A modular semantic judge suite for evaluating an APM package as a composed agent capability bundle.

This package intentionally does **not** run or depend on `apm audit --ci`. It evaluates meaning, coherence, activation behavior, dependency/provenance graph risk, safety boundaries, context efficiency, and practical usefulness.

## Architecture

```text
Package orchestrator skill
  ├─ inventory package components
  ├─ build dependency/provenance/interaction/capability graph
  │   └─ dependency graph reviewer → apm-dependency-graph-builder + apm-dependency-graph-judge
  ├─ dispatch each component type to a specialist reviewer subagent
  │   ├─ skill reviewer       → apm-skill-component-judge
  │   ├─ agent reviewer       → apm-agent-component-judge
  │   ├─ prompt reviewer      → apm-prompt-component-judge
  │   ├─ instruction reviewer → apm-instruction-component-judge
  │   ├─ MCP reviewer         → apm-mcp-component-judge
  │   └─ hook/command reviewer→ apm-hook-command-component-judge
  └─ synthesize component reports and graph findings with apm-package-synthesis-judge
```

## Contents

```text
.apm/skills/
  apm-semantic-package-judge/
  apm-dependency-graph-builder/
  apm-dependency-graph-judge/
  apm-skill-component-judge/
  apm-agent-component-judge/
  apm-prompt-component-judge/
  apm-instruction-component-judge/
  apm-mcp-component-judge/
  apm-hook-command-component-judge/
  apm-package-synthesis-judge/
.apm/agents/
  apm-dependency-graph-reviewer.agent.md
  apm-skill-reviewer.agent.md
  apm-agent-reviewer.agent.md
  apm-prompt-reviewer.agent.md
  apm-instruction-reviewer.agent.md
  apm-mcp-reviewer.agent.md
  apm-hook-command-reviewer.agent.md
  apm-package-synthesizer.agent.md
references/
  component-report.schema.json
  dependency-graph.schema.json
  graph-report.schema.json
  graph-aware-synthesis.md
  package-report.schema.json
  dispatch-matrix.md
examples/
  modular-review-flow.md
```

## Typical use

```text
Evaluate this APM package semantically using the modular APM package judge. Build a dependency graph, spawn specialist reviewers for each component type, collect reports, then synthesize an overall package-quality report.
```

## Graph views

The dependency graph reviewer builds four semantic graph views:

1. Package dependency graph: root, direct dependencies, transitive dependencies, local dependencies, and MCP declarations.
2. Component provenance graph: which package contributes each skill, prompt, instruction, agent, MCP, hook, command, or generated output.
3. Semantic interaction graph: activation overlaps, instruction conflicts, delegation paths, bypasses, constraints, and role duplication.
4. Capability exposure graph: MCP/tools, hooks, commands, scripts, agent tool permissions, filesystem/network/git/secret/state-changing capabilities.

## What this does not evaluate

- lockfile integrity
- hash drift
- hidden Unicode scans
- install replay
- package authenticity
- dependency vulnerability databases
- CI policy pass/fail

Use separate mechanical/security tooling for those. This suite focuses only on semantic package quality and graph-aware composition risk.
