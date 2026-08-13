# doc-driven-dev-lifecycle: フロー契約

この文書は人間が承認し、証跡を確認するための規範契約である。runtime route
は [`graphs/lifecycle.yaml`](../graphs/lifecycle.yaml)、derived state は
[`lifecycle-state.ja.md`](lifecycle-state.ja.md)、dispatch は
`route_lifecycle.js` が定義する。prose の Phase label は互換性のための文脈であり、
別の router ではない。

## Router handoff

各 Phase 境界で focus された artifact chain を probe し、route が指定した audit を
実行し、reroute 前に証跡を記録する。`focus-required` は hard stop であり、推測で
chain を選ばず明示的 focus を得る。Planning/Tasking では
`build_task_graph.js` を composite step として使う。その fan-out/fan-in と
fail-closed 規則は `references/graph-contract.ja.md` に定義する。

本文書は `doc-driven-dev-lifecycle` が既存スキルをオーケストレーションする際の
固定シーケンスと判定ルールを定義する。

## フェーズ概要

| Phase | 名称 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| -1 | Migration | `migrate_docs` | dry-run を確認済み; apply は original を削除せず canonical docs を作成する |
| 0 | Bootstrap | `scaffold_docs` | canonical `docs/` tree が存在し、既存ファイルが保持され、`docs/designs/overview.md` は `design-doc` に委ねられる |
| 1 | Briefing | `briefing-flow` | briefing 完了出力: 受け入れ条件付き spec + ADR |
| 2 | Design | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | Planning & Tasking | `plan-doc` + `task-doc` | 承認済み plan と検証付き task |
| 4 | Implementation | `implementation-flow` | 選択 task がすべて lifecycle-resolved（`done` または `wont-do`）で、caller が `implementation-verified` を指定する |
| 5 | Exit | `doc-status` | front matter, relations, index の整合 |

## Phase -1: Migration（任意）

目的: Bootstrap の前に既存 Markdown documentation を canonical な
doc-driven-dev tree へ取り込む。

**Migration command:** `migrate_docs`

Phase -1 は、既にドキュメントを持つリポジトリでのみ必要。まず dry-run を実行し、
source-to-target mapping を確認してから、mapping が妥当な場合だけ `--apply` で
再実行する。Original file は保持し、既存の canonical target は上書きしない。

### Migration 完了条件

- `migrate_docs` dry-run report を確認済み。
- source-to-target mapping を受け入れている。
- `--apply` が original を削除せず canonical docs を作成している。
- 既存の canonical target file が上書きされていない。
- `docs/designs/overview.md` は `design-doc` の所有物として残っている。

## Phase 0: Bootstrap

目的: Briefing 開始前に canonical な docs tree を作成する。

**Bootstrap command:** `scaffold_docs`

Phase 0 はリポジトリの baseline docs tree を作成し、既存ファイルを保持する。
canonical ディレクトリと index README を作成するが、`docs/designs/overview.md`
は**作成しない**。このファイルは `design-doc` の責務である。

### Bootstrap 完了条件

- `docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`,
  `docs/tasks`, `docs/adr`, `docs/impl/ir`, `docs/impl/exp` が存在する。
- 各 canonical ディレクトリに `README.md` がある。
- 対象リポジトリ内の既存ファイルが上書きされていない。
- `docs/designs/overview.md` は bootstrap step では作成されていない。

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

## Phase 3: Planning & Tasking

目的: `spec-doc`、`adr-doc`、`design-doc` を統合し、実装計画へ落とし込む。

### ステップ

- 3-1 Plan Authoring: `plan-doc` で依存順序、縦スライス、検証手順、チェックポイントを定義する。
- 3-2 Planning Gate: 既存 gate を尊重し、承認済み設計がない場合は作成しない。
- 3-3 Plan Approval: plan をレビューし、task 作成前に `status: approved` にする。
- 3-4 Task Decomposition: 承認済み plan から明示的な依存関係と検証条件付きの `task-doc` を作成する。

### Planning & Tasking 完了条件

- `plan-doc` が `spec-doc` / `adr-doc` / `design-doc` を参照し、`status: approved` である。
- 全 `task-doc` が plan セクションにトレース可能である。
- 各 task に検証手順と依存関係がある。

## Phase 4: Implementation

目的: `implementation-flow` に委譲し、全利用可能スキルを動的に発見して
`implementation-profile.md` を通じてタスクごとに適切なスキルスタックを構成する。

### ステップ

- 4-1 implementation documentation を開く: コード変更前に task ごとの
  `impl-doc` SKILL と `impl-doc` 規約を読み、`in-progress` の
  Implementation Record を開く。
- 4-2 `implementation-flow` 呼び出し: タスク単位の実行、スキル発見、構成、
  検証、および進行中ドキュメント更新を委譲する。
- 4-3 制約フィードバック: `implementation-flow` が上流の不足を報告した場合、
  `adr-doc` / `design-doc` を更新しループバックを記録する。
- 4-4 完了確認: 選択 task がすべて lifecycle-resolved（`done` または
  `wont-do`）で、caller が `implementation-verified` を指定し、Implementation
  Record が task クローズ前に完了・監査されていることを確認する。

### Implementation 完了条件

- `implementation-flow` が選択 task を実装済み（`done`）または意図的に未実施（`wont-do`）として報告し、caller が `implementation-verified` を指定している。
- 新たに発見された制約が上流文書に反映されている。
- コードレビューが完了している。
- 各 task はコード変更前に `in-progress` の Implementation Record を開いている。
- 各 Implementation Record は task クローズ前に完了・監査されている。

## Phase 4 終了ゲート: 実装後レビュー / フォローアップ分類

目的: 文書セットを Exit へ進める前に、実装済みの挙動が承認済み上流文書と
整合していることを確認する。

フォローアップ完了は boolean ではなく型付きで判定する。必ず 1 つの route
signal を出し、ユーザー向けフォローアップ報告に選択した route を明記する。

| Classification | Typed route | 必須 route と証跡 |
| --- | --- | --- |
| `bug-fix` | `followup-bug-fix` | 現在の承認済み plan 配下に task を作成または更新し、`relations.depends-on` / `relations.blocks` で関連付ける。 |
| `decision-required`（briefing） | `followup-decision-briefing` | implementation task 作成前に Phase 1（`briefing-flow`）へ戻る。 |
| `decision-required`（design） | `followup-decision-design` | implementation task 作成前に Phase 2（`design-doc`）へ戻る。 |
| `new-feature` | `followup-new-feature` | 新しい briefing のため Phase 1（`briefing-flow`）へ戻る。現在の承認済み plan には決して紐付けない。 |
| `doc-only` | `followup-doc-only` | operator は文書または implementation record の更新を記録する。この route は `exit-audit` に進み、その宣言済み audit route を通る。 |
| `defer` または `wont-do` | `followup-terminal` | operator は延期または理由を記録する（task として表す `wont-do` は `status: wont-do`）。この version では `wont-do` は無条件に lifecycle-resolved であり、Lifecycle state projection / Router は理由の有無や妥当性を機械的に検証しない。他 task の dependency は決して満たさない。 |

6 つの型付き route は相互排他的である。未分類または競合するフォローアップが
ある間、`followup-triage` は blocked のままで、宣言済みの
`followups-unclassified` retry edge を使う。`doc-only`、`defer`、`wont-do` では
対応する follow-up 証跡を operator が記録する。これは人間向けの証跡要件で
あり、Router の条件ではない。route 選択は検証済みまたは記録済み証跡を条件と
しない。この version では `wont-do` は無条件に lifecycle-resolved であり、他
task の dependency を決して満たさない。

## Phase 5: Exit

目的: `doc-status` 監査で文書整合を確認し完了判定する。

- front matter の必須項目を検証する。
- relations のリンク整合と index 反映を検証する。
- 必要に応じて不足文書を差し戻し、再監査する。

### Exit 完了条件

- front matter, relations, index が整合している。
- 実装検証結果が文書化されている。
- 監査結果として完了可能な状態である。
