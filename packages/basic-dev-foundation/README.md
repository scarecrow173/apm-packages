# basic-dev-foundation

`basic-dev-foundation` is a foundational APM aggregator for day-to-day AI-assisted development.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups baseline packages that are useful across most development repositories.

## What It Covers

This package covers broadly useful baseline capabilities for AI-assisted development.

Add dependencies here when they improve everyday development hygiene, repository understanding, review readiness, safety awareness, or lightweight documentation without requiring a specific development methodology. If a dependency strongly shapes how agents plan, implement, test, or review work, prefer `recommended-dev-suite`.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

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

Keep this package focused on broadly useful development foundations. Move opinionated process workflows, heavier methodology bundles, or team-specific practices to `recommended-dev-suite` or a narrower package.
