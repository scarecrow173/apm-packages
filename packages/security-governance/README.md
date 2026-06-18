# security-governance

`security-governance` provides security review and governance tools for supply chain integrity and agent compliance.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups packages focused on security and governance.

## What It Covers

This package covers security review, audit integrity, agent governance, supply chain security, and security best practices.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `github/awesome-copilot/skills/security-review`
- `github/awesome-copilot/skills/audit-integrity`
- `github/awesome-copilot/skills/agent-governance`
- `github/awesome-copilot/skills/agent-supply-chain`
- `github/awesome-copilot/plugins/security-best-practices`

## Related Packages

For other development needs, see:
- `basic-dev-foundation` — Git workflow management
- `github-automation` — CI/CD and PR operations
- `visualization` — Diagrams and design documentation
- `agent-intelligence` — AI evaluation and contextual understanding

## Maintenance

Keep this package focused on security and governance. Move broader compliance or organizational policies to `recommended-dev-suite`.
