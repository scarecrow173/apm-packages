---
name: apm-dependency-graph-builder
description: APM package の `apm.yml`、利用可能な `apm.lock.yaml`、`.apm` primitives、`apm_modules`、plugin
  metadata、MCP declarations、agents、skills、prompts、instructions、hooks から、semantic dependency、provenance、interaction、capability-exposure
  graphs を構築する。modular APM semantic evaluation で package synthesis または graph review
  の前に使う。
license: MIT

---

# APM Dependency Graph Builder 日本語版

APM package から、dependency / provenance / semantic interaction / capability exposure の graph evidence を構築する。package quality の採点はしない。

この builder は、後続の graph judge と package synthesis judge が emergent behavior を評価できるように、component と package の関係を明示する。

## Trigger contract（発火契約）

次の evidence が必要なときに使う:

- direct and transitive APM dependencies
- どの package がどの component を提供したか
- activation overlaps または instruction overlaps
- MCP/tool/hook capability exposure
- local と dependency の provenance
- package-level findings の背後にある graph paths

## Calibration reference（キャリブレーション参照）

Graph を構築する前に `../../../references/judge-calibration-guide.ja.md` を読む。Graph finding が後続の synthesis で使える粒度になるよう、evidence classification、confidence、未知情報の扱いを揃える。

## Graph views to build（構築する graph views）

1. Package dependency graph: package 間の direct / transitive dependency を示す。
2. Component provenance graph: 各 skill、agent、prompt、instruction、MCP、hook、command、script がどの package 由来かを示す。
3. Semantic interaction graph: activation overlap、instruction overlap、delegation、preload、bypass、shadowing などの意味的関係を示す。
4. Capability exposure graph: MCP tools、hooks、commands、scripts、network、write、execute、auth、destructive operations を示す。

## Node schema（ノードスキーマ）

各 node は可能な限り次を持つ:

- `id`: `pkg:root`、`skill:root/review`、`agent:root/security-reviewer` などの stable graph id
- `type`: package、skill、prompt、instruction、agent、hook、command、script、mcp、tool、resource、generated-output、doc、unknown
- `path`: 利用可能なら file path
- `package`: owning package id
- `source`: local、direct-dependency、transitive-dependency、generated、external、unknown
- `depth`: 分かる場合の dependency depth
- `target_harnesses`: known または inferred target harnesses
- `capabilities`: read、write、execute、network、auth、destructive、approval、unknown
- `confidence`: high、medium、low

## Edge schema（エッジスキーマ）

使用できる edge type:

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

## Graph construction rules（グラフ構築ルール）

- 推測よりも manifest / lockfile / dependency evidence を優先する。
- `apm.lock.yaml` は provenance / depth evidence としてだけ使う。lock correctness は評価しない。
- descriptions、applyTo/glob overlap、agent descriptions、prompt workflows、skill descriptions、MCP capabilities、hook events から semantic edges を推定する。
- 推定した edges には `confidence: medium` または `low` と reason を付ける。
- unknowns を隠さない。unknown provenance は synthesis にとって重要な evidence である。

## Required outputs（必須出力）

1. Dependency graph JSON。
2. Optional Mermaid graph。小さな package では useful。
3. Short graph construction notes。
4. Unknowns / low-confidence edges。

## Do not do（禁止事項）

- package quality を採点しない。
- `apm audit` を呼ばない。
- evidence なしに dependency depth を断定しない。
- evidence がないことを safety と扱わない。
