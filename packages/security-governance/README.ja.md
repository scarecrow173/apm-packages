# security-governance

`security-governance` は、セキュリティレビューとガバナンスツールを束ねる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、security とガバナンス向けの package を束ねます。

## 対象範囲

この package は、security review、audit integrity、agent governance、supply chain security、security best practice を対象にします。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `github/awesome-copilot/skills/security-review`
- `github/awesome-copilot/skills/audit-integrity`
- `github/awesome-copilot/skills/agent-governance`
- `github/awesome-copilot/skills/agent-supply-chain`
- `github/awesome-copilot/plugins/security-best-practices`

## 関連 Package

その他の開発需要については、以下を参照してください。

- `basic-dev-foundation` — Git workflow 管理
- `github-automation` — CI/CD と PR 運用
- `visualization` — 図解とドキュメント視覚化
- `agent-intelligence` — AI 評価と文脈理解

## Maintenance

この package は、security とガバナンスに絞って保守してください。より広い compliance または organizational policy は `recommended-dev-suite` に分けます。
