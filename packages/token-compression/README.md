# token-compression

`token-compression` provides strategies and tools for optimizing token usage in language model interactions.

This package provides one local advisory skill for bounded, mechanically verifiable work.

## What It Covers

This package covers prompt compression, context engineering, token budget management, and efficient message structuring for AI-assisted development.

## Local Skills

- `cheap-action` — routes simple, mechanically verifiable work to the lowest-cost selectable model when the current harness supports model selection. If no model switch is available, it keeps the action bounded and verifies it mechanically in the current harness.

## Dependencies source truth

[apm.yml](./apm.yml) is the source of truth for external dependencies and local package assets.

Local assets:

- `.apm/skills/cheap-action`

## Related Packages

For other development needs, see:

- `agent-intelligence` — AI agent capabilities
- `recommended-dev-suite` — Comprehensive development workflow
- `basic-dev-foundation` — Git workflow management
- `github-automation` — CI/CD PR operations
- `security-governance` — Security review governance

## Maintenance

Keep package focused on token optimization efficiency. Move broader development methodologies to `recommended-dev-suite`.
