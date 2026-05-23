---
name: adr-doc
description: Use this skill when creating, auditing, indexing, or migration-planning Architecture Decision Records using MADR 4.0.0. It helps preserve decision history, adapt to existing ADR directory conventions, and avoid automatic rewrites unless explicitly requested.
license: MIT
---

# ADR Documentation Skill

Use this skill for MADR 4.0.0-based Architecture Decision Records.

## Responsibilities

- Create new ADRs from MADR 4.0.0 templates.
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

## Operating Rules

- Treat `references/adr-conventions.md` as the authoritative ADR convention.
- Use `references/adr-maintenance.md` for tool-specific safety behavior and
  review focus.
- Treat MADR 4.0.0 as the ADR-specific standard only.
- Do not apply MADR rules to other future document types.
- Prefer explicit user confirmation before using `--write` in a repository with existing ADRs.
