# visualization

`visualization` は、図解とドキュメント視覚化ツールを束ねる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、visual design とドキュメント向けの package を束ねます。

## 対象範囲

この package は、図解生成、architecture 視覚化、ドキュメント形式の標準化を対象にします。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `github/awesome-copilot/skills/drawio`
- `github/awesome-copilot/skills/draw-io-diagram-generator`
- `github/awesome-copilot/skills/plantuml-ascii`
- `github/awesome-copilot/skills/editorconfig`

## 関連 Package

その他の開発需要については、以下を参照してください。

- `basic-dev-foundation` — Git workflow 管理
- `github-automation` — CI/CD と PR 運用
- `security-governance` — セキュリティレビューとガバナンス
- `agent-intelligence` — AI 評価と文脈理解

## Maintenance

この package は、視覚化とドキュメント化ツールに絞って保守してください。より広い design methodology は `recommended-dev-suite` に分けます。
