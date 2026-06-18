# visualization

`visualization` provides diagram and documentation visualization tools for design and architecture communication.

This package is intentionally dependency-first. It does not add local skills, agents, prompts, or MCP servers of its own; it groups packages focused on visual design and documentation.

## What It Covers

This package covers diagram generation, architecture visualization, and document formatting standards for clear communication.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `github/awesome-copilot/skills/drawio`
- `github/awesome-copilot/skills/draw-io-diagram-generator`
- `github/awesome-copilot/skills/plantuml-ascii`
- `github/awesome-copilot/skills/editorconfig`

## Related Packages

For other development needs, see:
- `basic-dev-foundation` — Git workflow management
- `github-automation` — CI/CD and PR operations
- `security-governance` — Security review and governance
- `agent-intelligence` — AI evaluation and contextual understanding

## Maintenance

Keep this package focused on visualization and documentation tools. Move broader design methodologies to `recommended-dev-suite`.
