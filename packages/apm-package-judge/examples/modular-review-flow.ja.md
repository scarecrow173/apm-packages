# 依存グラフ付きモジュール式レビュー Flow

User request:

```text
この APM package を意味論的に評価してください。specialist component reviewers を使い、dependency graph を構築してから package 全体の score を synthesis してください。
```

Expected orchestration:

```text
1. apm-semantic-package-judge が package evidence を inventory する。
2. apm-dependency-graph-reviewer が以下を構築・評価する。
   - package dependency graph
   - component provenance graph
   - semantic interaction graph
   - capability exposure graph
3. apm-skill-reviewer が apm-skill-component-judge を使って SKILL.md files をレビューする。
4. apm-agent-reviewer が apm-agent-component-judge を使って custom agents をレビューする。
5. apm-prompt-reviewer が apm-prompt-component-judge を使って prompts をレビューする。
6. apm-instruction-reviewer が apm-instruction-component-judge を使って instructions をレビューする。
7. apm-mcp-reviewer が apm-mcp-component-judge を使って MCP declarations をレビューする。
8. apm-hook-command-reviewer が apm-hook-command-component-judge を使って hooks/commands/scripts をレビューする。
9. apm-package-synthesizer が apm-package-synthesis-judge を使って component reports と graph findings を統合する。
```

Important rule:

Final package score は component scores の平均ではない。Graph-derived findings は、transitive capability surprise、activation collisions、instruction conflicts、dependency-induced context bloat など、composition によって現れる emergent behavior を示すため、package dimensions を cap できる。

Example final report additions:

```markdown
## Graph Summary
- Graph built: partial
- Package nodes: 3
- Component nodes: 14
- Capability nodes: 2
- Highest dependency depth: 2
- Most important graph finding: transitive MCP server is introduced by a dependency but not disclosed in root docs.

## Dependency / Interaction Graph Findings
| Severity | Finding | Evidence | Synthesis impact | Fix |
|---|---|---|---|---|
| high | Transitive MCP capability surprise | `pkg:root -> pkg:base -> mcp:github` | P5 <= 10 | Document the MCP capability or remove the dependency. |
| medium | Instruction overlap | root and dependency both define Python rules for `**/*.py` | P4 <= 14 | Merge or define precedence. |
```
