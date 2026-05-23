---
name: adr-doc
description: Use this skill when creating, auditing, indexing, or migration-planning Architecture Decision Records for coding agents using MADR 4.0.0. It helps write decisions that agents can execute without extra explanation.
license: MIT
---

# ADR Documentation Skill

Use this skill for MADR 4.0.0-based Architecture Decision Records written for
coding agents.

An `adr-doc` ADR must give a coding agent enough context, constraints, and
acceptance signals to implement the decision without additional explanation.

## Responsibilities

- Read relevant existing ADRs, code patterns, and project conventions before
  drafting a new ADR.
- Create new ADRs from MADR 4.0.0 templates.
- Write ADRs as executable decision guidance for coding agents.
- Detect common ADR directories and naming conventions.
- Audit existing ADRs for missing metadata, missing MADR sections, unresolved placeholders, broken local links, and index drift.
- Validate optional YAML front matter `relations` links when they are present.
- Update ADR indexes only when explicitly asked to write.
- Report migration suggestions without changing historical ADR files.

## Commands

Run scripts from the installed skill directory or this package source tree.

```bash
node scripts/new_adr.ts --title "Adopt MADR"
node scripts/new_adr.ts --title "Use PostgreSQL" --template full --dir docs/decisions
node scripts/audit_adr.ts --dir docs/adr
node scripts/update_index.ts --dir docs/adr --write
node scripts/migrate_report.ts --dir docs/adr
```

## ADR Conventions

- Treat `references/adr-conventions.md` as the authoritative ADR convention.
- Directory, filename, metadata, status, relation, mutability, and indexing
  defaults are defined in `references/adr-conventions.md`.

## Template Selection

- Default template: `full`.
- Use `minimal` only when the decision is simple, unlikely to be misread, and
  has little meaningful trade-off to preserve. When in doubt, choose `full`.
- Use the `bare` template family when the repository already has strict ADR
  wording conventions.
- Detailed template selection guidance is defined in
  `references/template-variants.md`.

## Agent Readiness

- Every new ADR should include an implementation plan and verification criteria.
- Review drafted ADRs with `references/review-checklist.md` before finalizing.
- If the ADR cannot tell a coding agent what to change, what to preserve, and
  how to verify completion, ask for more intent before writing or accepting it.

## Operating Rules

- Treat `references/adr-conventions.md` as the authoritative ADR convention.
- Use `references/adr-maintenance.md` for tool-specific safety behavior and
  review focus.
- Treat MADR 4.0.0 as the ADR-specific standard only.
- Do not apply MADR rules to other future document types.
- Prefer explicit user confirmation before using `--write` in a repository with existing ADRs.
