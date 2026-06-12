---
name: apm-dependency-graph-builder
description: Build dependency, provenance, semantic interaction, and capability exposure graphs for an APM package without performing mechanical audit checks. Use before component reviews and package synthesis to identify dependency depth, transitive components, activation overlaps, instruction-scope overlaps, MCP/tool/hook exposure, and provenance paths.
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
---

# APM Dependency Graph Builder

Build graph evidence for semantic package review. This skill constructs graph views; it does not judge mechanical integrity, hash correctness, hidden Unicode, or install drift.

## Inputs

Use any available evidence:

- `apm.yml`
- `apm.lock.yaml`, only for resolved dependency depth and provenance evidence
- package tree
- `.apm/` content
- `apm_modules/` content
- `.apm/agents/` or other harness-specific generated files
- MCP declarations
- hooks, commands, scripts
- previous inventory

If evidence is partial, build a partial graph and mark unknowns.

## Graph views

Create four graph views.

### 1. Package dependency graph

Nodes:

- root package
- direct APM dependencies
- transitive APM dependencies
- local dependencies
- plugin-like dependencies
- declared MCP dependencies

Edges:

- `depends_on`
- `declares_mcp`
- `resolved_from`
- `local_path_depends_on`
- `virtual_subdir_depends_on`

### 2. Component provenance graph

Nodes:

- package nodes
- skill nodes
- agent nodes
- prompt nodes
- instruction nodes
- MCP nodes
- hook/command/script nodes
- generated-output nodes
- documentation nodes

Edges:

- `contains`
- `generated_from`
- `contributed_by`
- `overrides`
- `shadows`

### 3. Semantic interaction graph

Nodes:

- components that can influence runtime behavior

Edges:

- `overlaps_with`: same trigger, domain, applyTo scope, or responsibility
- `conflicts_with`: contradictory or mutually unsafe guidance
- `constrains`: instruction constrains skill/agent/prompt behavior
- `delegates_to`: prompt/skill/agent hands off to another component
- `bypasses`: prompt/command bypasses expected skill/agent/safety path
- `uses`: component expects a tool, MCP server, hook, or command

### 4. Capability exposure graph

Nodes:

- MCP servers
- MCP tools/resources/prompts
- hooks
- commands
- scripts
- agents with tool permissions
- sensitive capabilities: filesystem write, delete, network, git mutation, secret access, shell execution, external service access

Edges:

- `exposes_capability`
- `may_call`
- `requires_secret`
- `writes_to`
- `reads_from`
- `calls_network`
- `mutates_state`

## Node schema

Use stable ids:

- `pkg:<name>`
- `skill:<package>/<name>`
- `agent:<package>/<name>`
- `prompt:<package>/<name>`
- `instruction:<package>/<name>`
- `mcp:<package>/<name>`
- `hook:<package>/<name>`
- `command:<package>/<name>`
- `capability:<name>`

Each node should include:

- `id`
- `type`
- `name`
- `path` when known
- `package` when known
- `source`: local, direct-dependency, transitive-dependency, generated, unknown
- `depth` when known
- `confidence`: high, medium, low

## Edge schema

Each edge should include:

- `from`
- `to`
- `type`
- `reason`
- `evidence`
- `severity`: info, low, medium, high, critical
- `confidence`: high, medium, low

## Detection heuristics

### Dependency depth

Use lockfile depth when available. Otherwise infer from directory layout and dependency declarations. Mark inferred depth as medium or low confidence.

### Activation overlap

Detect overlap from:

- skill descriptions
- agent descriptions
- prompt names/descriptions
- command names
- repeated task nouns
- same target file patterns
- same tool/MCP expectations

### Instruction overlap

Detect overlap from:

- identical `applyTo` or glob scopes
- broad scopes such as `**/*`
- matching language/framework names
- duplicated rule headings

### Capability exposure

Detect from:

- MCP tools or server declarations
- agent `tools` frontmatter
- hook names and triggers
- shell snippets
- command files
- descriptions containing write/delete/install/network/git/secret behavior

## Output

Produce:

1. compact summary
2. JSON graph using `references/dependency-graph.schema.json` when structured output is requested
3. Mermaid overview when helpful
4. unknowns and confidence notes

Do not score the graph in this skill. Use `apm-dependency-graph-judge` for graph scoring.
