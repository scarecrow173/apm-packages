# Dispatch Matrix

Use this table to route package artifacts to the right specialist reviewer.

| Artifact / Evidence | Reviewer subagent | Skills | Output |
|---|---|---|---|
| `apm.yml`, `apm.lock.yaml`, package tree, `.apm/`, `apm_modules/`, MCP declarations, hooks, generated files | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` | Dependency graph JSON + graph semantic report |
| `SKILL.md`, skill resources, skill examples | `apm-skill-reviewer` | `apm-skill-component-judge` | Component semantic report |
| `.apm/agents/*.agent.md`, generated harness-native agent files, subagent frontmatter/body | `apm-agent-reviewer` | `apm-agent-component-judge` | Component semantic report |
| prompt files, slash command prompts, reusable task prompts | `apm-prompt-reviewer` | `apm-prompt-component-judge` | Component semantic report |
| `.instructions.md`, rules, context files, glob-scoped instructions | `apm-instruction-reviewer` | `apm-instruction-component-judge` | Component semantic report |
| MCP server/tool/resource/prompt declarations and docs | `apm-mcp-reviewer` | `apm-mcp-component-judge` | Component semantic report |
| hooks, commands, scripts, shell snippets with side effects | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` | Component semantic report |
| All component reports + graph report | `apm-package-synthesizer` | `apm-package-synthesis-judge` | Final package report |

## Ordering

1. Inventory package evidence.
2. Build dependency/provenance/interaction/capability graph.
3. Use graph context to dispatch component reviews.
4. Collect component reports.
5. Synthesize package score with graph-aware cap rules.

## Fallback

If subagents are unavailable, run the same skills sequentially in the main conversation and label each section by reviewer role. Do not claim subagent execution occurred.
