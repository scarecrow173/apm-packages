# AGENTS.md

This file guides agents working under `packages/github-automation`.

## Package Role

`github-automation` is a dependency-only aggregator for GitHub operations and CI/CD automation. Treat [apm.yml](./apm.yml) as the source of truth.

It should stay focused on GitHub-specific capabilities: PR management, CI/CD workflow, and dependency automation.

## Related Packages

This package is part of a family of specialized aggregators:
- `basic-dev-foundation` — Git workflow management
- `visualization` — Diagram and documentation tools
- `security-governance` — Security review and governance
- `agent-intelligence` — AI capabilities and evaluation

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
