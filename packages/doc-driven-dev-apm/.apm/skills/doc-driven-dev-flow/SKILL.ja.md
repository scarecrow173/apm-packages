---
name: doc-driven-dev-flow
description: "文書駆動開発の全ライフサイクルをオーケストレーションするメタスキル。既存の doc スキル（idea-refine, brainstorming, spec-doc, adr-doc, design-doc, plan-doc, task-doc, doc-status）を 5 フェーズのフローで選択・順序付けし、明示的なゲートで制御する。"
license: MIT
---

# Doc-Driven Dev Flow

既存の doc スキルを 5 フェーズのフローで選択・順序付けし、明示的なゲートで
制御することで文書駆動開発の全ライフサイクルをオーケストレーションする。

これは**メタスキル**であり、スクリプトを持たず直接的な成果物を生成しない。
代わりに「どのスキルを」「いつ」呼び出すかを判定し、フロー契約で定義された
順序制約と完了条件を強制する。

## 利用タイミング

- 新機能・新プロジェクト・大規模な変更をゼロから始めるとき。
- どの doc スキルから始めるべきか不明なとき。
- アイデアから実行まで end-to-end の文書オーケストレーションが必要なとき。

## フロー概要

```text
Phase 1: Briefing  →  Phase 2: Design  →  Phase 3: Planning  →  Phase 4: Execution Slice  →  Phase 5: Exit
```

各フェーズにはゲートがあり、通過しなければ次へ進めない。
詳細は `references/flow-contract.ja.md` を参照。

## フェーズ一覧

| Phase | 目的 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| 1 | 要望を文書入力に変換する | `idea-refine`, `brainstorming`, `spec-doc`, `adr-doc` | 受け入れ条件付き spec + ADR |
| 2 | 設計を実装可能な形へ具体化する | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | 実装計画へ統合する | `plan-doc` | PLAN-DOC-GATE-001（承認済み設計必須） |
| 4 | plan を実装単位へ分解する | `task-doc` | plan にトレース可能な検証付きタスク |
| 5 | 文書整合を確認する | `doc-status` | front matter, relations, index の整合 |

## Entry Decision（Phase 1, Step 1-1）

開始前に現在の情報状態を評価し経路を選択する:

- **1-1-A. Problem Framing** — 課題が曖昧 → `idea-refine` を使用
- **1-1-B. Option Framing** — 方向性はあるがトレードオフ不明 → `brainstorming` を使用
- **1-1-C. Combined Skill Discovery** — 複数スキルが必要 → 対話で組み合わせる
- **1-1-D. Direct Documentation Start** — 要件が明確 → `spec-doc + adr-doc` へ直接進む

これらは**選択肢**であり順序ではない。情報の充足度に基づいて選択する。

## Hard Gates

<HARD-GATE>
フェーズを飛ばしてはならない。各フェーズのゲートを満たしてから次へ進むこと。
ゲートを満たせない場合は、当フェーズ内でループするか前フェーズへ戻る。
</HARD-GATE>

<HARD-GATE>
承認済み design-doc なしに plan-doc を作成してはならない（PLAN-DOC-GATE-001）。
承認済み plan-doc なしに task-doc を作成してはならない。
</HARD-GATE>

<HARD-GATE>
緊急修正シナリオでも、最低限 spec-doc または adr-doc を根拠として残してから
実装に進むこと。
</HARD-GATE>

## プロセス

1. **Entry 評価** — 1-1 のどの経路が適用されるか判定し、選択を記録する。
2. **Discovery 深掘り** — 停止条件を満たすまで反復する（フロー契約 §1-2 参照）。
3. **Briefing 出力** — `spec-doc` と `adr-doc` を並行して作成する。
4. **Design** — `design-doc` を呼び出し、spec/ADR との整合を検証する。
5. **Plan** — `plan-doc` を呼び出し、PLAN-DOC-GATE-001 を尊重する。
6. **Execute** — `task-doc` エントリに分解し、各タスクに検証手順を付与する。
7. **Exit 監査** — `doc-status` を呼び出し、文書整合を検証する。

## ループバックルール

- Phase 2 で spec の不足が判明した場合 → Phase 1 へ戻る。
- Phase 3 で設計の不足が判明した場合 → Phase 2 へ戻る。
- Phase 4 で新たな制約が判明した場合 → ADR/design を更新し再開する。
- ループバック時は理由を 1 行記録する。

## 完了判定

Phase 5 の `doc-status` 監査がブロッキング指摘なしで通過したとき、
全文書が整合・追跡可能であることが確認され、フローは完了となる。

## 参照

詳細なフロー契約: `references/flow-contract.ja.md`
