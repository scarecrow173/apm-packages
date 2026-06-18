# agent-intelligence

`agent-intelligence` は、AI と agent の能力を束ねる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、AI 支援に向けの package を束ねます。

## 対象範囲

この package は、agent 評価、自動 research、usage metric、文脈理解を対象にします。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `github/awesome-copilot/skills/agentic-eval`
- `github/awesome-copilot/skills/autoresearch`
- `github/awesome-copilot/skills/copilot-usage-metrics`
- `github/awesome-copilot/plugins/context-engineering`

## 関連 Package

その他の開発需要については、以下を参照してください。

- `basic-dev-foundation` — Git workflow 管理
- `github-automation` — CI/CD と PR 運用
- `visualization` — 図解とドキュメント視覚化
- `security-governance` — セキュリティレビューとガバナンス

## Maintenance

この package は、AI 能力と intelligence feature に絞って保守してください。より広い開発 methodology は `recommended-dev-suite` に分けます。
