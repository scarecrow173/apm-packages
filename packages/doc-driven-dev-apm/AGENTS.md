# AGENTS.md

This file is a practical guide for AI agents modifying `packages/doc-driven-dev-apm`.

## 1. Purpose and Scope

- This package provides skills for document-driven development.
- The primary flow is `idea -> brainstorming -> ADR/spec -> plan -> task -> implementation -> audit`.
- Generated artifacts use YAML front matter plus Markdown.
- This guide defines package development rules; it does not require doc-driven-dev process artifacts for changes to this package itself.

## 2. Responsibility Boundaries in This Package

- Edit implementation logic in:
  - `src/skills/**/scripts/*.ts`
  - `src/skills/**/scripts/lib/*.ts`
  - `src/skills/lib/*.ts`
- Edit distributed skill definitions, templates, and references in:
  - `.apm/skills/**/SKILL.md`
  - `.apm/skills/**/references/**`
  - `.apm/skills/**/assets/templates/**`
- Build outputs (JavaScript) are in:
  - `.apm/skills/**/scripts/*.js`
  - These are generated from `src` by `pnpm run build:scripts`.

Important:

- When changing script behavior, edit `src` first.
- `build:scripts` cleans existing `.js` files under `.apm/skills/**/scripts` and regenerates them.
- `SKILL.md`, `references`, and `assets/templates` are not auto-generated from `src` today, so update them directly when needed.

## 3. Package Development Workflow

1. Read existing documents and implementation code first.
2. If behavior changes, edit `src` first; update `.apm` references/templates when the change affects distributed skill docs.
3. When `src` changes, run `pnpm run build:scripts` to regenerate distributable `.js` files.
4. After changes, run `pnpm test` and `pnpm run lint:md`, then report outcomes.
5. For compatibility-impacting updates, explicitly call out expected impact and migration approach.

## 4. Standard Commands

Run in the package root:

```bash
pnpm run build:scripts
pnpm test
pnpm run lint:md
```

When needed:

```bash
apm compile --dry-run
apm compile --validate
```

Note:

- In this package, `apm compile --validate` may fail in some environments due to `.apm` instruction discovery behavior.
- Prioritize `pnpm test` as the main regression signal.

## 5. Script Safety Notes

- `doc-status` scripts (`list_docs`, `audit_docs`) are primarily report-only.
- In `adr-doc`, `update_index` and `relate_adr` default to dry-run; `--write` is required for file updates.
- Avoid destructive changes; verify with dry-run or JSON output first.

## 6. Change Checklist

- Updated the relevant skill documentation for the intent of the change.
- Regenerated `.apm/skills/**/scripts/*.js` when `src` changed.
- Confirmed tests pass with `pnpm test`.
- Checked Markdown quality with `pnpm run lint:md` when Markdown files changed.

## 7. Non-Goals

- Unrelated large refactors.
- Requiring ADR/spec/plan/task authoring and relation tracking for this package's own implementation tasks.
- Changes that break existing index or relation consistency.
