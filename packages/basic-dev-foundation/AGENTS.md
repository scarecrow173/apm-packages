# AGENTS.md

This file guides agents working under `packages/basic-dev-foundation`.

## Package Role

`basic-dev-foundation` is a dependency-only aggregator for baseline AI-assisted development support. Treat [apm.yml](./apm.yml) as the source of truth.

It should stay focused on broadly applicable development foundations: APM usage, Git workflow, PR visibility, CI awareness, dependency hygiene, security review, audit integrity, diagrams, research, governance, and context management.

## Editing Rules

- Keep `README.md` and `README.ja.md` synchronized in meaning and structure.
- Keep `AGENTS.md` and `AGENTS.ja.md` synchronized in meaning and structure.
- Do not describe local skills, agents, prompts, instructions, or MCP servers unless they actually exist in this directory.
- When changing dependencies in `apm.yml`, update both READMEs in the same change.
- Keep this package more conservative than `recommended-dev-suite`; move heavier workflow methodology into the recommended package.

## Validation

This is a dependency-only package. After documentation-only edits, run this command from this directory when available:

```powershell
apm compile --dry-run
```

`apm compile --validate` requires installed or local APM content. If this package still has only `apm.yml` and documentation files, report that validation is not applicable instead of treating the missing local `.apm/` content as a package bug.
