# Dispatch Matrix

この表を使い、package artifacts を適切な specialist reviewer へ振り分ける。

| Artifact / Evidence | Reviewer subagent | Skills | Output |
|---|---|---|---|
| `apm.yml`、`apm.lock.yaml`、package tree、`.apm/`、`apm_modules/`、MCP declarations、hooks、generated files | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` | Dependency graph JSON + graph semantic report |
| `SKILL.md`、skill resources、skill examples | `apm-skill-reviewer` | `apm-skill-component-judge` | Component semantic report |
| `.apm/agents/*.agent.md`、生成済み harness-native agent files、subagent frontmatter/body | `apm-agent-reviewer` | `apm-agent-component-judge` | Component semantic report |
| prompt files、slash command prompts、reusable task prompts | `apm-prompt-reviewer` | `apm-prompt-component-judge` | Component semantic report |
| `.instructions.md`、rules、context files、glob-scoped instructions | `apm-instruction-reviewer` | `apm-instruction-component-judge` | Component semantic report |
| MCP server/tool/resource/prompt declarations and docs | `apm-mcp-reviewer` | `apm-mcp-component-judge` | Component semantic report |
| hooks、commands、scripts、side effects を持つ shell snippets | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` | Component semantic report |
| すべての component reports + graph report | `apm-package-synthesizer` | `apm-package-synthesis-judge` | Final package report |

## Ordering

1. package evidence を inventory する。
2. dependency/provenance/interaction/capability graph を構築する。
3. graph context を使って component reviews を dispatch する。
4. component reports を収集する。
5. graph-aware cap rules で package score を統合する。

## Fallback

subagents が利用できない場合は、main conversation で同じ skills を順番に実行し、各 section に reviewer role を明示する。subagent execution が行われていないのに、行われたと主張してはならない。
