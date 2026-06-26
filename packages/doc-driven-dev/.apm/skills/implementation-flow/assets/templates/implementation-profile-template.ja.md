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
| <!-- 例: test-driven-development --> | Build | .apm/skills/ | conditional | rigid | リポジトリまたは環境が test-led workflow を提供する場合 |
| <!-- 例: subagent-driven-development --> | Build | .apm/skills/ | conditional | flexible | 独立サブタスクを隔離コンテキストのサブエージェントへ委譲できる場合 |
| <!-- 例: cheap-action --> | Tooling | .apm/skills/ | conditional | flexible | 単純で低リスクの作業を、必要ツールを維持したまま低コスト実行経路に載せられる場合 |
| <!-- 例: impl-doc --> | Documentation | .apm/skills/ | always | rigid | コード変更前に実装ドキュメントを開く |
| <!-- 例: systematic-debugging --> | Process | .apm/skills/ | conditional | rigid | バグ修正またはテスト失敗 |
| <!-- 例: source-driven-development --> | Verify | .apm/skills/ | conditional | flexible | フレームワーク / ライブラリの利用 |
| <!-- 例: requesting-code-review --> | Review | .apm/skills/ | conditional | flexible | レビューゲートが利用可能 |
| <!-- Add discovered skills below --> | | | | | |

## カテゴリ割り当て

### Process

タスクへのアプローチ方法を決めるスキル。

- <!-- 例: systematic-debugging — 修正前に根本原因を診断する -->

### Build

実装を構造化し、実行するスキル。

- <!-- 例: test-driven-development — RED-GREEN-REFACTOR サイクル -->
- <!-- 例: incremental-implementation — 細い縦スライスで進める -->
- <!-- 例: subagent-driven-development — レビュー付きでタスクを委譲する -->
- <!-- 例: dispatching-parallel-agents — 独立した作業を並列実行する -->

### Documentation

実装中に Implementation Record と関連エビデンスを開き、維持するスキル。

- <!-- 例: impl-doc — 各 task の最初のコード変更前に `impl-doc` で `in-progress` の Implementation Record を開き、検証完了まで更新を続ける -->

### Verify

権威ある情報源に照らして正しさを検証するスキル。

- <!-- 例: source-driven-development — 公式ドキュメントを確認する -->
- <!-- 例: doubt-driven-development — 判断を対抗的にレビューする -->

### Review

実装後の品質ゲートを提供するスキル。

- <!-- 例: requesting-code-review — レビュー前チェックリスト -->
- <!-- 例: receiving-code-review — レビュー指摘の処理 -->

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

標準的な実装タスクに対するベーススキル構成。リポジトリが slot の既定
assignment を定義しない場合、生成された profile は provider lookup または
override で解決されるまでその slot を空のままにできる。

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Build | <!-- repository default --> | 利用可能なら既定の Build 構成を定義する |
| 2 | Documentation | <!-- repository default --> | 各 task の最初のコード変更前に実装ドキュメントを開く |
| 3 | Build | <!-- repository default --> | 受け入れ条件が明確な独立サブタスクを分散する |
| 4 | Verify | <!-- repository default --> | 利用可能なら正しさ検証を追加する |
| 5 | Tooling | <!-- repository default --> | 対応環境では低リスクな機械的作業を低コスト実行に寄せる |
| 6 | Review | <!-- repository default --> | 利用可能なら完了ゲートを適用する |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| バグ修正またはテスト失敗 | Prepend: 条件に合う Process スキル | 修正前に診断が必要 |
| フレームワーク / ライブラリの利用が検出された | Add: 条件に合う Verify スキル | 公式ドキュメントで検証する |
| 非自明なアーキテクチャ判断 | Add: 条件に合う Verify スキル | コミット前にアプローチを検討する |
| 複数の独立したサブタスク | Replace Build with: 並列実行に適した Build スキル | 効率のために分散する |
| 隔離された受け入れ条件を持つ独立サブタスク | Add: 条件に合うサブエージェント対応 Build スキル | fresh context で並列作業する |
| 単純・機械的・低リスクの task | Add: 条件に合うコスト最適化 Tooling スキル | 必須ツールと検証を弱めずにコストを削減する |
| <!-- Add repository-specific overrides --> | | |
