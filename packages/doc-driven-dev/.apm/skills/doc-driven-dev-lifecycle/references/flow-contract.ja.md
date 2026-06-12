# doc-driven-dev-lifecycle: フロー契約

本文書は `doc-driven-dev-lifecycle` が既存スキルをオーケストレーションする際の
固定シーケンスと判定ルールを定義する。

## フェーズ概要

| Phase | 名称 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| 1 | Briefing | `briefing-flow` | briefing 完了出力: 受け入れ条件付き spec + ADR |
| 2 | Design | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | Planning | `plan-doc` | PLAN-DOC-GATE-001（承認済み設計必須） |
| 4 | Execution Slice | `task-doc` | plan にトレース可能な検証付きタスク |
| 5 | Implementation | `implementation-flow` | 全タスクが検証通過 |
| 6 | Exit | `doc-status` | front matter, relations, index の整合 |

## Phase 1: Briefing

目的: ユーザー要望・提案・課題を、実装可能な文書入力へ変換する。

**委譲先:** [`briefing-flow`](../briefing-flow/SKILL.ja.md)

Phase 1 は `briefing-flow` メタスキルに完全に委譲される。
`briefing-flow` は以下を管理する:

- Entry Decision（A-1〜A-5）の経路選択
- Briefing スキル発見プロトコルと `briefing-profile.md` の生成
- スキルスタックを使った情報収集の実行
- Phase D ゲート（spec-doc + adr-doc 完了条件）

### Briefing 完了条件

`briefing-flow` の Phase D ゲートが通過した時点で完了:

- `spec-doc` が受け入れ条件を持ち、status が `proposed` 以上である
  （`draft` のまま次フェーズに進んではならない）。
- `adr-doc` が主要な技術判断と代替案を持つ。
- 両文書が同一の課題文脈を参照している。
- Entry Decision の選択が記録されている。
- 未決事項が「実装前に解消必須」か「後続で管理可能」か分類されている。

ここで生成される `spec-doc` と `adr-doc` が、Phase 2 (`design-doc`) に進むための
briefing 完了成果物になる。

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

## Phase 5: Implementation

目的: `implementation-flow` に委譲し、全利用可能スキルを動的に発見して
`implementation-profile.md` を通じてタスクごとに適切なスキルスタックを構成する。

### ステップ

- 5-1 `implementation-flow` 呼び出し: タスク単位の実行、スキル発見、構成、検証を委譲する。
- 5-2 制約フィードバック: `implementation-flow` が上流の不足を報告した場合、`adr-doc` / `design-doc` を更新しループバックを記録する。
- 5-3 完了確認: `implementation-flow` の完了条件経由で全タスク検証通過を確認する。

### Implementation 完了条件

- `implementation-flow` が全タスク実装済み・検証通過を報告している。
- 新たに発見された制約が上流文書に反映されている。
- コードレビューが完了している。

## Phase 6: Exit

目的: `doc-status` 監査で文書整合を確認し完了判定する。

- front matter の必須項目を検証する。
- relations のリンク整合と index 反映を検証する。
- 必要に応じて不足文書を差し戻し、再監査する。

### Exit 完了条件

- front matter, relations, index が整合している。
- 実装検証結果が文書化されている。
- 監査結果として完了可能な状態である。
