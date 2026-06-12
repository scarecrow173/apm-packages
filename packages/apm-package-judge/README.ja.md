# apm-package-judge

`apm-package-judge` は、APM パッケージ全体を意味論的に評価するためのモジュール式 skill suite である。

この suite は機械的監査を行わない。`apm audit --ci`、lockfile integrity、hash drift、hidden Unicode scan、install replay は対象外である。目的は、APM パッケージを「agent capability bundle」として読み、構成物が正しく、安全に、無駄なく、有用に合成されているかを評価することにある。

## Architecture

```text
apm-semantic-package-judge
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

dependency graph reviewer は4つの semantic graph view を構築する。

1. Package dependency graph: root、direct dependencies、transitive dependencies、local dependencies、MCP declarations。
2. Component provenance graph: 各 skill、prompt、instruction、agent、MCP、hook、command、generated output をどの package が提供しているか。
3. Semantic interaction graph: activation overlaps、instruction conflicts、delegation paths、bypasses、constraints、role duplication。
4. Capability exposure graph: MCP/tools、hooks、commands、scripts、agent tool permissions、filesystem/network/git/secret/state-changing capabilities。

## What this does not evaluate

- lockfile integrity
- hash drift
- hidden Unicode scans
- install replay
- package authenticity
- dependency vulnerability databases
- CI policy pass/fail

これらには別の機械的監査・セキュリティツールを使う。この suite は semantic package quality と graph-aware composition risk だけに集中する。

## 日本語版について

各 Markdown ファイルには `.ja.md` の日本語ローカライズ版を用意している。`.apm/agents/*.ja.md` は、重複した agent id を避けるため、frontmatter の `name` に `-ja` サフィックスを付けている。
