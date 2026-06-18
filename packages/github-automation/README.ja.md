# github-automation

`github-automation` は、GitHub 運用と CI/CD 自動化スキルを束ねる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、GitHub と自動化ツール向けの package を束ねます。

## 対象範囲

この package は、GitHub 運用、PR 管理、CI/CD workflow 最適化、dependency 自動化を対象にします。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `github/awesome-copilot/skills/github-actions-efficiency`
- `github/awesome-copilot/skills/pr-dashboard`
- `github/awesome-copilot/skills/dependabot`

## 関連 Package

その他の開発需要については、以下を参照してください。

- `basic-dev-foundation` — Git workflow 管理
- `visualization` — 図解とドキュメント視覚化
- `security-governance` — セキュリティレビューとガバナンス
- `agent-intelligence` — AI 評価と文脈理解

## Maintenance

この package は、GitHub 運用と自動化に絞って保守してください。より広い開発 workflow は `recommended-dev-suite` に分けます。
