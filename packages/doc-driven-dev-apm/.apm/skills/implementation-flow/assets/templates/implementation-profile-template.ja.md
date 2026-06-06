---
type: implementation-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---

# Implementation Profile

このテンプレートは、リポジトリ固有の implementation profile を再生成または確認するときに使います。
プレースホルダの値を実行時の既定値として扱わないでください。

このファイルは、このリポジトリ向けのスキル構成を定義します。
`implementation-flow` が skill discovery protocol を通じて生成します。

生成済み profile に `runtime_guidance` が含まれている場合は、`execution_policy`
の確認後に読む構造化された soft ranking metadata として扱ってください。

## 利用可能なスキル

| Name | Category | Source | Activation | Execution | Condition |
| ---- | -------- | ------ | ---------- | --------- | --------- |
| test-driven-development | Build | .apm/skills/ | always-on | rigid | — |
| incremental-implementation | Build | .apm/skills/ | always-on | rigid | — |
| systematic-debugging | Process | .apm/skills/ | conditional | rigid | バグ修正またはテスト失敗 |
| source-driven-development | Verify | .apm/skills/ | conditional | flexible | フレームワーク / ライブラリの利用 |
| doubt-driven-development | Verify | .apm/skills/ | conditional | flexible | 代替案を伴う非自明な判断 |
| requesting-code-review | Review | .apm/skills/ | always-on | flexible | — |
| receiving-code-review | Review | .apm/skills/ | conditional | flexible | レビュー指摘を受けた場合 |
| subagent-driven-development | Build | .apm/skills/ | conditional | rigid | 委譲に適したタスク |
| dispatching-parallel-agents | Build | .apm/skills/ | conditional | rigid | 複数の独立したタスク |
| <!-- Add discovered skills below --> | | | | | |

## カテゴリ割り当て

### Process

タスクへのアプローチ方法を決めるスキル。

- systematic-debugging — 修正前に根本原因を診断する

### Build

実装を構造化し、実行するスキル。

- test-driven-development — RED-GREEN-REFACTOR サイクル
- incremental-implementation — 細い縦スライスで進める
- subagent-driven-development — レビュー付きでタスクを委譲する
- dispatching-parallel-agents — 独立した作業を並列実行する

### Verify

権威ある情報源に照らして正しさを検証するスキル。

- source-driven-development — 公式ドキュメントを確認する
- doubt-driven-development — 判断を対抗的にレビューする

### Review

実装後の品質ゲートを提供するスキル。

- requesting-code-review — レビュー前チェックリスト
- receiving-code-review — レビュー指摘の処理

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

標準的な実装タスクのベースとなるスキル組み合わせ。

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Build | test-driven-development | すべての変更に対してテストが正しさを定義する |
| 2 | Build | incremental-implementation | ビッグバン変更を避ける |
| 3 | Review | requesting-code-review | すべてのタスクをレビューする |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| バグ修正またはテスト失敗 | Prepend: systematic-debugging | 修正前に診断が必要 |
| フレームワーク / ライブラリの利用が検出された | Add: source-driven-development | 公式ドキュメントで検証する |
| 非自明なアーキテクチャ判断 | Add: doubt-driven-development | コミット前にアプローチを検討する |
| 複数の独立したサブタスク | Replace Build with: dispatching-parallel-agents | 効率のために分散する |
| <!-- Add repository-specific overrides --> | | |
