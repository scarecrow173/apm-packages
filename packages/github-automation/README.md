# github-automation

`github-automation` provides GitHub operations and CI/CD automation skills for development workflow efficiency.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups packages focused on GitHub and automation tooling.

## What It Covers

This package covers GitHub operations, PR management, CI/CD workflow optimization, and dependency automation.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `github/awesome-copilot/skills/github-actions-efficiency`
- `github/awesome-copilot/skills/pr-dashboard`
- `github/awesome-copilot/skills/dependabot`

## Related Packages

For other development needs, see:
- `basic-dev-foundation` — Git workflow management
- `visualization` — Diagrams and design documentation
- `security-governance` — Security review and governance
- `agent-intelligence` — AI evaluation and contextual understanding

## Maintenance

Keep this package focused on GitHub operations and automation. Move broader development workflows to `recommended-dev-suite`.
