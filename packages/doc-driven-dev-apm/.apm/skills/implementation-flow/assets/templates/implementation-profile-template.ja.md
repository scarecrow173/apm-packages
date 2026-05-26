---
type: implementation-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---

# Implementation Profile

このファイルはこのリポジトリのスキル構成を定義します。
`implementation-flow` によるスキル発見プロトコルで生成されます。

## Available Skills（利用可能なスキル）

| Name | Category | Source | Activation | Execution | Condition |
| ---- | -------- | ------ | ---------- | --------- | --------- |
| test-driven-development | Build | .apm/skills/ | always-on | rigid | — |
| incremental-implementation | Build | .apm/skills/ | always-on | rigid | — |
| systematic-debugging | Process | .apm/skills/ | conditional | rigid | バグ修正またはテスト失敗 |
| source-driven-development | Verify | .apm/skills/ | conditional | flexible | フレームワーク/ライブラリ使用 |
| doubt-driven-development | Verify | .apm/skills/ | conditional | flexible | 複数の選択肢がある非自明な決定 |
| requesting-code-review | Review | .apm/skills/ | always-on | flexible | — |
| receiving-code-review | Review | .apm/skills/ | conditional | flexible | レビューフィードバック受信 |
| subagent-driven-development | Build | .apm/skills/ | conditional | rigid | 委譲に適したタスク |
| dispatching-parallel-agents | Build | .apm/skills/ | conditional | rigid | 複数の独立したタスク |
| <!-- 以下に発見されたスキルを追加 --> | | | | | |

## Category Assignments（カテゴリ割り当て）

### Process

タスクへのアプローチ方法を決定するスキル。

- systematic-debugging — 修正前の根本原因診断

### Build

実装を構造化して実行するスキル。

- test-driven-development — RED-GREEN-REFACTOR サイクル
- incremental-implementation — 薄い垂直スライス
- subagent-driven-development — レビュー付きタスク委譲
- dispatching-parallel-agents — 並行独立実行

### Verify

権限のあるソースに対する正確性を検証するスキル。

- source-driven-development — 公式ドキュメント検証
- doubt-driven-development — 決定の対抗的レビュー

### Review

実装後の品質ゲートを提供するスキル。

- requesting-code-review — レビュー前チェックリスト
- receiving-code-review — レビューフィードバック処理

### Domain

言語、フレームワーク、またはプラットフォーム固有のガイダンス。

- <!-- 例: typescript-conventions -->
- <!-- 例: react-patterns -->
- <!-- 例: api-and-interface-design -->

### Tooling

ツール固有のワークフロー。

- <!-- 例: git-workflow-and-versioning -->
- <!-- 例: ci-cd-and-automation -->
- <!-- 例: browser-testing-with-devtools -->

## Default Stack

標準的な実装タスク用の基本スキル組み合わせ。

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Build | test-driven-development | テストがすべての変更の正確性を定義 |
| 2 | Build | incremental-implementation | ビッグバン変更を防止 |
| 3 | Review | requesting-code-review | すべてのタスクがレビューを受ける |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| バグ修正またはテスト失敗 | 優先: systematic-debugging を先頭に | 修正前に診断が必須 |
| フレームワーク/ライブラリ使用を検出 | 追加: source-driven-development | 公式ドキュメントに対して検証 |
| 非自明なアーキテクチャ決定 | 追加: doubt-driven-development | コミット前にアプローチに異議 |
| 複数の独立したサブタスク | 置換: dispatching-parallel-agents で Build を置換 | 効率のためにファンアウト |
| <!-- リポジトリ固有のオーバーライドを追加 --> | | |
