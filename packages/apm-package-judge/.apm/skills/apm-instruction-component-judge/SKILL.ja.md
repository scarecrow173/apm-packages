---
name: apm-instruction-component-judge
description: instruction/rules 構成物を、scope precision、conflict potential、behavioral clarity、priority hygiene、context cost、agent harness 間の portability の観点で評価する。モジュール式 APM パッケージ評価の専門 reviewer として使用する。
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Instruction 構成物 Judge

always-on または scoped instruction files を評価する。

## スコープ

以下をレビューする。

- `.instructions.md`
- `CLAUDE.md` のようなファイル
- project rules
- agent context に注入される coding standards
- path/glob-scoped instructions

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| I1 Scope Precision | 15 | 必要な場所にだけ適用される。 |
| I2 Behavioral Clarity | 15 | 曖昧な好みではなく、具体的な制約を与える。 |
| I3 Non-Contradiction | 15 | 重なり得る scope の他ルールと衝突しない。 |
| I4 Priority Hygiene | 10 | higher-priority instructions を上書きしようとしない。 |
| I5 Context Cost | 15 | always-on use に十分短く、generic bloat がない。 |
| I6 Portability | 10 | 利用できない harness behavior を前提にしない。 |
| I7 Testability | 10 | 出力または diff から compliance を確認できる。 |
| I8 Failure Handling | 10 | 例外と edge cases を扱う。 |

## 検出すべき所見

- scoped にすべき global rules
- generic coding advice
- contradictory rules
- instruction injection patterns
- always-on context として長すぎる prose
- 不明確な precedence
- 文書化されていない target-specific assumptions

## 出力

標準の component report format を使い、Type は `instruction` とする。
