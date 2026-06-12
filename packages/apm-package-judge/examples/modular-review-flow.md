# Modular Review Flow with Dependency Graph

User request:

```text
Evaluate this APM package semantically. Use specialist component reviewers, build the dependency graph, then synthesize the whole-package score.
```

Expected orchestration:

```text
1. apm-semantic-package-judge inventories package evidence.
2. apm-dependency-graph-reviewer builds and judges:
   - package dependency graph
   - component provenance graph
   - semantic interaction graph
   - capability exposure graph
3. apm-skill-reviewer reviews SKILL.md files using apm-skill-component-judge.
4. apm-agent-reviewer reviews custom agents using apm-agent-component-judge.
5. apm-prompt-reviewer reviews prompts using apm-prompt-component-judge.
6. apm-instruction-reviewer reviews instructions using apm-instruction-component-judge.
7. apm-mcp-reviewer reviews MCP declarations using apm-mcp-component-judge.
8. apm-hook-command-reviewer reviews hooks/commands/scripts using apm-hook-command-component-judge.
9. apm-package-synthesizer combines component reports and graph findings using apm-package-synthesis-judge.
```

Important rule:

The final package score is not the average of component scores. Graph-derived findings can cap package dimensions because they reveal emergent behavior: transitive capability surprise, activation collisions, instruction conflicts, and dependency-induced context bloat.

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
