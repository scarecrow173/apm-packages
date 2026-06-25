# token-compression

`token-compression` は、言語モデルとのやり取りにおけるトークン使用量を最適化するための戦略とツールを提供します。

このパッケージは、外部の圧縮特化依存関係とローカルの advisory skill を組み合わせます。外部の `genshijin` スイートはプロンプトとコンテキスト圧縮を扱います。ローカルの `cheap-action` は、現在のハーネスがモデル選択をサポートする場合に、単純で機械的に検証できる作業を最も低コストな対応モデルへルーティングするためのスキルです。

## カバー範囲

このパッケージは、プロンプト圧縮、コンテキストエンジニアリング、トークンバジェット管理、AI 支援開発における効率的なメッセージ構造化をカバーします。

## ローカルスキル

- `cheap-action` — 現在のハーネスがモデル選択をサポートする場合に、単純で機械的に検証できる作業を最も低コストな選択可能モデルへルーティングします。モデル切り替えが利用できない場合は、現在のハーネスで作業を小さく保ち、機械的に検証します。

## 依存関係

外部依存関係とローカルパッケージ資産の信頼できる情報源は [apm.yml](./apm.yml) です。

外部依存関係：

- `InterfaceX-co-jp/genshijin/skills/genshijin`
- `InterfaceX-co-jp/genshijin/skills/genshijin-compress`
- `InterfaceX-co-jp/genshijin/skills/genshijin-crew`
- `InterfaceX-co-jp/genshijin/skills/genshijin-review`

ローカル資産：

- `.apm/skills/cheap-action`

## 関連パッケージ

その他の開発ニーズについては以下を参照してください：

- `agent-intelligence` — AI とエージェント機能
- `recommended-dev-suite` — 総合開発ワークフロー
- `basic-dev-foundation` — Git ワークフロー管理
- `github-automation` — CI/CD と PR 操作
- `security-governance` — セキュリティレビューとガバナンス

## メンテナンス

このパッケージは、トークン最適化と効率化に焦点を合わせ続けます。より広い開発方法論は `recommended-dev-suite` に移します。
