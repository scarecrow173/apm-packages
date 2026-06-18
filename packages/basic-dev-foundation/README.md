# basic-dev-foundation

`basic-dev-foundation` is a foundational APM aggregator providing Git workflow management for AI-assisted development.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups essential Git and baseline packages useful across development repositories.

## What It Covers

This package covers Git workflow essentials for AI-assisted development: conventional commits, branch naming, commit messages, and repository history understanding.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/repo-story-time`

## Related Packages

For specialized needs, see:
- `github-automation` — CI/CD, PR dashboard, and dependency management
- `visualization` — Diagrams and design documentation
- `security-governance` — Security review and governance
- `agent-intelligence` — AI evaluation and contextual understanding

## Maintenance

Keep this package focused on Git workflows. Move opinionated process workflows, heavier methodology bundles, or team-specific practices to `recommended-dev-suite` or related packages.
