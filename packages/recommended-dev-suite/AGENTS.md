# AGENTS.md

This file guides agents working under `packages/recommended-dev-suite`.

## Package Role

`recommended-dev-suite` is a dependency-only aggregator for recommended AI-assisted development workflows. Treat [apm.yml](./apm.yml) as the source of truth.

It should contain workflow depth that goes beyond the basic foundation: brainstorming, idea refinement, interview-style clarification, subagent execution, code review loops, systematic debugging, TDD, source-driven work, incremental delivery, CI/CD automation, simplification, and context engineering.

## Editing Rules

- Keep `README.md` and `README.ja.md` synchronized in meaning and structure.
- Keep `AGENTS.md` and `AGENTS.ja.md` synchronized in meaning and structure.
- Do not describe local skills, agents, prompts, instructions, or MCP servers unless they actually exist in this directory.
- When changing dependencies in `apm.yml`, update both READMEs in the same change.
- Keep baseline, low-opinion dependencies in `basic-dev-foundation`; use this package for recommended workflow methodology.

## Validation

This is a dependency-only package. After documentation-only edits, run this command from this directory when available:

```powershell
apm compile --dry-run
```

`apm compile --validate` requires installed or local APM content. If this package still has only `apm.yml` and documentation files, report that validation is not applicable instead of treating the missing local `.apm/` content as a package bug.
