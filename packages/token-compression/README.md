# token-compression

`token-compression` provides strategies and tools for optimizing token usage in language model interactions.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups packages focused on token optimization and compression techniques.

## What It Covers

This package covers prompt compression, context engineering, token budget management, and efficient message structuring for AI-assisted development.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `obra/superpowers/skills/context-engineering`
- `softaworks/agent-toolkit/skills/token-optimization`
- `github/awesome-copilot/skills/prompt-compression`
- `addyosmani/agent-skills/skills/incremental-implementation`

## Related Packages

For other development needs, see:
- `agent-intelligence` — AI and agent capabilities
- `recommended-dev-suite` — Comprehensive development workflow
- `basic-dev-foundation` — Git workflow management
- `github-automation` — CI/CD and PR operations
- `security-governance` — Security review and governance

## Maintenance

Keep this package focused on token optimization and efficiency. Move broader development methodologies to `recommended-dev-suite`.
