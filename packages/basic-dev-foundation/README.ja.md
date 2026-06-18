# basic-dev-foundation

`basic-dev-foundation` は、AI 支援開発で使う Git workflow 管理をまとめる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、Git 操作と基礎 package を束ねます。

## 対象範囲

この package は、AI 支援開発で使う Git workflow の基本要素を対象にします。conventional commit、branch naming、commit message、repository history understanding が主な範囲です。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/repo-story-time`

## 関連 Package

その他の開発需要については、以下を参照してください。

- `github-automation` — CI/CD と PR ダッシュボード
- `visualization` — 図解とドキュメント視覚化
- `security-governance` — セキュリティレビューとガバナンス
- `agent-intelligence` — AI 評価と文脈理解

## Maintenance

この package は、Git workflow に絞って保守してください。意見の強い process workflow、重い methodology bundle、team 固有の practice は `recommended-dev-suite` またはそれぞれの package に分けます。
