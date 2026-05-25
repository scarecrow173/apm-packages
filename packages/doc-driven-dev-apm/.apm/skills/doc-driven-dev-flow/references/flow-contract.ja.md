# doc-driven-dev-flow: フロー契約

本文書は `doc-driven-dev-flow` が既存スキルをオーケストレーションする際の
固定シーケンスと判定ルールを定義する。

## フェーズ概要

| Phase | 名称 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| 1 | Briefing | `idea-refine`, `brainstorming`, `spec-doc`, `adr-doc` | 受け入れ条件付き spec + ADR |
| 2 | Design | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | Planning | `plan-doc` | PLAN-DOC-GATE-001（承認済み設計必須） |
| 4 | Execution Slice | `task-doc` | plan にトレース可能な検証付きタスク |
| 5 | Exit | `doc-status` | front matter, relations, index の整合 |

## Phase 1: Briefing

目的: ユーザー要望・提案・課題を、実装可能な文書入力へ変換する。

### 1-1 Entry Decision（選択判定）

現在の情報状態に応じて選択する:

- **1-1-A. Problem Framing**
  - 適用条件: 課題定義が曖昧、要件が散在、目的が未確定。
  - 実施内容: `idea-refine` を使い、問題定義・価値仮説・未確定事項を整理する。
- **1-1-B. Option Framing**
  - 適用条件: 方向性はあるが、論点やトレードオフ整理が不足。
  - 実施内容: `brainstorming` を使い、選択肢比較と評価軸を明確化する。
- **1-1-C. Combined Skill Discovery**
  - 適用条件: 複数スキルを組み合わせて判断材料を収集する必要がある。
  - 実施内容: `idea-refine`、`brainstorming`、その他利用可能スキルを対話で組み合わせる。
- **1-1-D. Direct Documentation Start**
  - 適用条件: 要件と制約が十分に明確。
  - 実施内容: `spec-doc + adr-doc` の作成へ直接進む（理由を 1 行残す）。

注記:

- 1-1-A/B/C/D は選択肢であり順序ではない。A/B 間に前後関係はない。
- 必要な場合は A/B/C を組み合わせてよい。
- 緊急修正でも、最低限 `spec-doc` または `adr-doc` の根拠を残す。

### 1-2 Discovery Deepening

目的: 実装時の追加質問が最小になる粒度まで情報を反復的に深掘りする。

手順:

1. 要件、制約、前提、非目標、依存先、未決事項を棚卸しする。
2. 不足情報を質問として明文化し、優先度順に解消する。
3. 解消結果を Briefing メモへ反映し、必要に応じて 1-1 の経路選択を見直す。

停止条件:

- 主要ユースケースについて、入力・処理・期待結果が説明できる。
- 重要な制約（技術・運用・期限・品質）が明示されている。
- 未決事項が実装ブロッカーかどうか分類されている。

### 1-3 Parallel Documentation Output

Briefing 出力を根拠として `spec-doc` と `adr-doc` を作成する:

- `spec-doc`: 目的、範囲、受け入れ条件、対象外を含む。
- `adr-doc`: 採用案、代替案、採否理由、影響範囲を含む。
- 両文書は同一課題を参照し、相互に追跡可能な relation を持つ。

### Briefing 完了条件

- `spec-doc` が受け入れ条件を持ち、status が `proposed` 以上である
  （`draft` のまま次フェーズに進んではならない）。
- `adr-doc` が主要な技術判断と代替案を持つ。
- 両文書が同一の課題文脈を参照している。
- 1-1-A/B/C/D のどの経路を選んだかが記録されている。
- 未決事項が「実装前に解消必須」か「後続で管理可能」か分類されている。

## Phase 2: Design

目的: Briefing で確定した情報に不足分を補い、設計を実装可能な形へ具体化する。

### ステップ

- 2-1 Design Authoring: `design-doc` を作成し、構成・境界・データ/処理フロー・非機能観点を明確化する。
- 2-2 Consistency Check: `design-doc` が `spec-doc` の要求と `adr-doc` の制約に矛盾しないことを確認する。
- 2-3 Approval Gate Preparation: `plan-doc` に進む前提として承認可能状態を満たす。

### Design 完了条件

- `design-doc` が `spec-doc` と `adr-doc` を根拠に持つ。
- `plan-doc` 入力に必要な設計情報が揃っている。

## Phase 3: Planning

目的: `spec-doc`、`adr-doc`、`design-doc` を統合し、実装計画へ落とし込む。

### ステップ

- 3-1 Plan Authoring: `plan-doc` で依存順序、縦スライス、検証手順、チェックポイントを定義する。
- 3-2 Planning Gate: 既存 gate を尊重し、承認済み設計がない場合は作成しない。
- 3-3 Execution Readiness: `task-doc` に分解可能な粒度で実装作業を定義する。

### Planning 完了条件

- `plan-doc` が `spec-doc` / `adr-doc` / `design-doc` を参照する。
- `task-doc` へ直結できる実装順序と検証条件がある。

## Phase 4: Execution Slice

目的: plan を実装単位へ分解し実行可能状態へ接続する。

- `task-doc` を plan 起点で分割し、依存関係を明確にする。
- 各 task は「実装手順 + 検証条件 + 完了条件」を持つ。
- 実装中に新たな制約が判明した場合は `adr-doc` / `design-doc` を更新する。

### Execution Slice 完了条件

- `task-doc` が plan にトレース可能である。
- 各 task に検証手順がある。

## Phase 5: Exit

目的: `doc-status` 監査で文書整合を確認し完了判定する。

- front matter の必須項目を検証する。
- relations のリンク整合と index 反映を検証する。
- 必要に応じて不足文書を差し戻し、再監査する。

### Exit 完了条件

- front matter, relations, index が整合している。
- 監査結果として完了可能な状態である。
