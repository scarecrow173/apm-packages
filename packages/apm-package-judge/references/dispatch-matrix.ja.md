# Dispatch Matrix

Package artifacts を正しい specialist reviewer へ routing するためにこの table を使う。

| Artifact / Evidence | Reviewer subagent | Skills | Output |
|---|---|---|---|
| `apm.yml`、`apm.lock.yaml`、package tree、`.apm/`、`apm_modules/`、MCP declarations、hooks、generated files | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` | Dependency graph JSON + graph semantic report |
| `SKILL.md`、skill resources、skill examples | `apm-skill-reviewer` | `apm-skill-component-judge` | Component semantic report |
| `.apm/agents/*.agent.md`、generated harness-native agent files、subagent frontmatter/body | `apm-agent-reviewer` | `apm-agent-component-judge` | Component semantic report |
| prompt files、slash command prompts、reusable task prompts | `apm-prompt-reviewer` | `apm-prompt-component-judge` | Component semantic report |
| `.instructions.md`、rules、context files、glob-scoped instructions | `apm-instruction-reviewer` | `apm-instruction-component-judge` | Component semantic report |
| MCP server/tool/resource/prompt declarations and docs | `apm-mcp-reviewer` | `apm-mcp-component-judge` | Component semantic report |
| hooks、commands、scripts、shell snippets with side effects | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` | Component semantic report |
| All component reports + graph report | `apm-package-synthesizer` | `apm-package-synthesis-judge` | Final package report |

## Ordering

1. Package evidence を inventory する。
2. Dependency / provenance / interaction / capability graph を構築する。
3. Graph context を使って component reviews を dispatch する。
4. Component reports を収集する。
5. Graph-aware cap rules で package score を synthesis する。

## Fallback

subagents が使えない場合は、main conversation 内で同じ skills を sequential に実行し、各 section を reviewer role で label する。subagent execution が発生していないのに発生したと主張してはいけない。
