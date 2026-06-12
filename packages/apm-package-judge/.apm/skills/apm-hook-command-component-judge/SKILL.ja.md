---
name: apm-hook-command-component-judge
description: hook、command、script 構成物を、目的、trigger timing、副作用、ユーザー承認、filesystem/network/secret access、observability、rollback behavior、package 内での意味的適合性の観点で評価する。モジュール式 APM パッケージ評価の専門 reviewer として使用する。
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Hook/Command 構成物 Judge

hooks、commands、scripts を operational behavior として評価する。

## スコープ

以下をレビューする。

- hooks
- 実行する、または実行を示唆する slash commands
- package docs または manifests から参照される scripts
- prompts/instructions に埋め込まれた shell snippets
- generated command wrappers

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| H1 Trigger Clarity | 15 | いつ実行されるかが明示されている。 |
| H2 Purpose/Behavior Match | 15 | 実際の振る舞いが stated purpose と一致する。 |
| H3 Side-Effect Disclosure | 15 | writes、deletes、network calls、git changes、installs が開示されている。 |
| H4 Authorization Boundary | 15 | 破壊的または外部向け操作には明確な user intent が必要である。 |
| H5 Minimality | 10 | package に必要なことだけを行う。 |
| H6 Observability | 10 | user が結果を理解できるだけの log/report を出す。 |
| H7 Failure/Rollback | 10 | failure behavior が安全で復旧可能である。 |
| H8 Package Fit | 10 | この package に属する妥当性があり、user を驚かせない。 |

## 検出すべき所見

- 隠れた mutation
- 開示されていない network call
- secret reads
- install-time side effects
- git state changes
- dry-run または confirmation の欠如
- broad command wrappers
- docs と behavior の不一致

## 出力

標準の component report format を使い、Type は `hook-command` とする。
