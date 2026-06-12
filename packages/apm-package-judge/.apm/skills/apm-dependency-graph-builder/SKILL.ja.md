---
name: apm-dependency-graph-builder
description: 機械的監査を行わずに、APM パッケージの dependency / provenance / semantic interaction / capability exposure graph を構築する。component review と package synthesis の前に使い、依存深度、transitive component、activation overlap、instruction scope overlap、MCP/tool/hook exposure、provenance path を特定する。
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM 依存グラフ Builder

意味論的なパッケージレビューのための graph evidence を構築する。このスキルは graph view を作るだけであり、機械的な整合性、hash の正しさ、hidden Unicode、install drift は判定しない。

## 入力

利用可能な証拠を使う。

- `apm.yml`
- `apm.lock.yaml`。ただし、resolved dependency depth と provenance evidence のためだけに使う
- パッケージツリー
- `.apm/` の内容
- `apm_modules/` の内容
- `.apm/agents/` やその他 harness 固有の生成ファイル
- MCP 宣言
- hooks、commands、scripts
- 既存の inventory

証拠が部分的な場合は、partial graph を作り、unknown を明示する。

## Graph view

4種類の graph view を作成する。

### 1. Package dependency graph

ノード:

- root package
- direct APM dependencies
- transitive APM dependencies
- local dependencies
- plugin-like dependencies
- declared MCP dependencies

エッジ:

- `depends_on`
- `declares_mcp`
- `resolved_from`
- `local_path_depends_on`
- `virtual_subdir_depends_on`

### 2. Component provenance graph

ノード:

- package nodes
- skill nodes
- agent nodes
- prompt nodes
- instruction nodes
- MCP nodes
- hook/command/script nodes
- generated-output nodes
- documentation nodes

エッジ:

- `contains`
- `generated_from`
- `contributed_by`
- `overrides`
- `shadows`

### 3. Semantic interaction graph

ノード:

- runtime behavior に影響し得る構成物

エッジ:

- `overlaps_with`: 同じ trigger、domain、applyTo scope、responsibility を持つ
- `conflicts_with`: 矛盾する、または相互に危険な指示を持つ
- `constrains`: instruction が skill/agent/prompt の振る舞いを制約する
- `delegates_to`: prompt/skill/agent が別 component へ委譲する
- `bypasses`: prompt/command が期待される skill/agent/safety path を迂回する
- `uses`: component が tool、MCP server、hook、command を期待している

### 4. Capability exposure graph

ノード:

- MCP servers
- MCP tools/resources/prompts
- hooks
- commands
- scripts
- tool permission を持つ agents
- sensitive capabilities: filesystem write、delete、network、git mutation、secret access、shell execution、external service access

エッジ:

- `exposes_capability`
- `may_call`
- `requires_secret`
- `writes_to`
- `reads_from`
- `calls_network`
- `mutates_state`

## Node schema

安定した id を使う。

- `pkg:<name>`
- `skill:<package>/<name>`
- `agent:<package>/<name>`
- `prompt:<package>/<name>`
- `instruction:<package>/<name>`
- `mcp:<package>/<name>`
- `hook:<package>/<name>`
- `command:<package>/<name>`
- `capability:<name>`

各ノードは以下を含める。

- `id`
- `type`
- `name`
- `path`。分かる場合
- `package`。分かる場合
- `source`: local、direct-dependency、transitive-dependency、generated、unknown
- `depth`。分かる場合
- `confidence`: high、medium、low

## Edge schema

各エッジは以下を含める。

- `from`
- `to`
- `type`
- `reason`
- `evidence`
- `severity`: info、low、medium、high、critical
- `confidence`: high、medium、low

## 検出ヒューリスティック

### Dependency depth

lockfile depth が利用できる場合はそれを使う。利用できない場合は、directory layout と dependency declaration から推定する。推定した depth は confidence を medium または low として扱う。

### Activation overlap

以下から overlap を検出する。

- skill descriptions
- agent descriptions
- prompt names/descriptions
- command names
- 繰り返される task nouns
- 同じ target file patterns
- 同じ tool/MCP expectations

### Instruction overlap

以下から overlap を検出する。

- 同一の `applyTo` または glob scope
- `**/*` のような broad scope
- 同じ language/framework names
- 重複する rule headings

### Capability exposure

以下から検出する。

- MCP tools または server declarations
- agent `tools` frontmatter
- hook names と triggers
- shell snippets
- command files
- write/delete/install/network/git/secret behavior を含む descriptions

## 出力

以下を出力する。

1. compact summary
2. structured output が求められた場合は `references/dependency-graph.schema.json` に従った JSON graph
3. 有用な場合は Mermaid overview
4. unknowns と confidence notes

このスキルでは graph を採点しない。graph scoring には `apm-dependency-graph-judge` を使う。
