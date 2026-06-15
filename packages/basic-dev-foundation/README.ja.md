# basic-dev-foundation

`basic-dev-foundation` は、日常的な AI 支援開発で使う基礎要素をまとめる APM aggregator です。

この package は dependency-first です。独自の local skill、agent、prompt、MCP server は追加せず、多くの開発リポジトリで共通して使いやすい基礎 package を束ねます。

## 対象範囲

この package は、AI 支援開発で広く使える baseline capability を対象にします。

日常的な development hygiene、repository understanding、review readiness、safety awareness、軽量な documentation に効き、特定の development methodology を要求しない dependency はここに追加します。agent の planning、implementation、testing、review の進め方を強く形作る dependency は `recommended-dev-suite` を優先してください。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/agentic-eval`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/repo-story-time`
- `github/awesome-copilot/skills/github-actions-efficiency`
- `github/awesome-copilot/skills/pr-dashboard`
- `github/awesome-copilot/skills/dependabot`
- `github/awesome-copilot/skills/drawio`
- `github/awesome-copilot/skills/draw-io-diagram-generator`
- `github/awesome-copilot/skills/plantuml-ascii`
- `github/awesome-copilot/skills/editorconfig`
- `github/awesome-copilot/skills/copilot-usage-metrics`
- `github/awesome-copilot/skills/autoresearch`
- `github/awesome-copilot/skills/agent-governance`
- `github/awesome-copilot/skills/security-review`
- `github/awesome-copilot/skills/audit-integrity`
- `github/awesome-copilot/skills/agent-supply-chain`
- `github/awesome-copilot/plugins/acreadiness-cockpit`
- `github/awesome-copilot/plugins/context-engineering`
- `github/awesome-copilot/plugins/doublecheck`
- `github/awesome-copilot/plugins/security-best-practices`

## Maintenance

この package は、広く使える開発基盤に絞って保守してください。意見の強い process workflow、重い methodology bundle、team 固有の practice は `recommended-dev-suite` またはより狭い package に分けます。
