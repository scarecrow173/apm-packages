---
name: apm-prompt-component-judge
description: prompt および slash-command prompt 構成物を、task specificity、variable contract、expected outputs、assumptions、safety boundaries、skills/agents との composability、failure behavior の観点で評価する。モジュール式 APM パッケージ評価の専門 reviewer として使用する。
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Prompt 構成物 Judge

prompts を再利用可能な task entrypoint として評価する。

## スコープ

以下をレビューする。

- prompt files
- slash command prompts
- natural-language driven な command descriptions
- argument placeholders
- expected output definitions

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| PR1 Task Specificity | 15 | generic roleplay ではなく、焦点の定まった task を持つ。 |
| PR2 Input Contract | 15 | variables、assumptions、prerequisites が明確である。 |
| PR3 Output Contract | 15 | expected output format と decision criteria が明確である。 |
| PR4 Workflow Adequacy | 15 | steps が十分だが、過剰に規定しすぎていない。 |
| PR5 Safety & Authorization | 10 | review、permissions、user intent を迂回しない。 |
| PR6 Composability | 10 | 関連する skills/agents と連携し、重複または迂回しない。 |
| PR7 Error Handling | 10 | missing、invalid、ambiguous inputs を扱う。 |
| PR8 Context Efficiency | 10 | 簡潔であり、大量の generic instructions を埋め込まない。 |

## 検出すべき所見

- 保護なしの広範な変更を促す prompt
- input variables が文書化されていない
- expected output がない
- instructions または skills と矛盾する
- skill workflow を重複させる
- side effects を隠す
- 再利用には汎用的すぎる

## 出力

標準の component report format を使い、Type は `prompt` とする。
