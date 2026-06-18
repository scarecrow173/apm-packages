# AGENTS.md

This file guides agents working under `packages/agent-intelligence`.

## Package Role

`agent-intelligence` is a dependency-only aggregator for AI and agent capabilities. Treat [apm.yml](./apm.yml) as the source of truth.

It should stay focused on AI and agent intelligence: agent evaluation, automated research, usage metrics, and contextual understanding.

## Related Packages

This package is part of a family of specialized aggregators:
- `basic-dev-foundation` — Git workflow management
- `github-automation` — CI/CD and PR operations
- `visualization` — Diagram and documentation tools
- `security-governance` — Security review and governance

## Editing Rules

- Keep `README.md` and `README.ja.md` synchronized in meaning and structure.
- Keep `AGENTS.md` and `AGENTS.ja.md` synchronized in meaning and structure.
- Do not describe local skills, agents, prompts, instructions, or MCP servers unless they actually exist in this directory.
- When changing dependencies in `apm.yml`, update both READMEs in the same change.

## Validation

This is a dependency-only package. After documentation-only edits, run this command from this directory when available:

```powershell
apm compile --dry-run
```

`apm compile --validate` requires installed or local APM content. If this package still has only `apm.yml` and documentation files, report that validation is not applicable instead of treating the missing local `.apm/` content as a package bug.
