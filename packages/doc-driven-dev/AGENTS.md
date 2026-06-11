# AGENTS.md

This file is a practical guide for AI agents modifying `packages/doc-driven-dev`.

## 1. Purpose and Scope

- This package provides skills for document-driven development.
- The primary flow is `briefing/deep-dive -> ADR/spec -> design -> plan -> task -> implementation -> audit`.
- Generated artifacts use YAML front matter plus Markdown.
- This guide defines package development rules; it does not require doc-driven-dev process artifacts for changes to this package itself.

## 2. Responsibility Boundaries in This Package

All paths in this document are repository-root-relative unless a command block
explicitly says otherwise.

- Edit implementation logic in the isolated build workspace:
  - `scripts/doc-driven-dev/src/skills/**/scripts/*.ts`
  - `scripts/doc-driven-dev/src/skills/**/scripts/lib/*.ts`
  - `scripts/doc-driven-dev/src/skills/lib/*.ts`
- Edit distributed skill definitions, templates, and references in:
  - `packages/doc-driven-dev/.apm/skills/**/SKILL.md`
  - `packages/doc-driven-dev/.apm/skills/**/references/**`
  - `packages/doc-driven-dev/.apm/skills/**/assets/templates/**`
- Build outputs (JavaScript) are in:
  - `packages/doc-driven-dev/.apm/skills/**/scripts/*.js`
  - These are generated from `scripts/doc-driven-dev/src` by `pnpm --dir scripts/doc-driven-dev run build:scripts`.

Important:

- When changing script behavior, edit `scripts/doc-driven-dev/src` first.
- `build:scripts` cleans existing `.js` files under `packages/doc-driven-dev/.apm/skills/**/scripts` and regenerates them.
- `SKILL.md`, `references`, and `assets/templates` are not auto-generated from the scripts workspace today, so update them directly when needed.

## 3. Package Development Workflow

1. Read existing documents and implementation code first.
2. If behavior changes, edit `scripts/doc-driven-dev/src` first; update `packages/doc-driven-dev/.apm` references/templates when the change affects distributed skill docs.
3. When `scripts/doc-driven-dev/src` changes, run `pnpm --dir scripts/doc-driven-dev run build:scripts` to regenerate `packages/doc-driven-dev/.apm/skills/**/scripts/*.js`.
4. After changes, run `pnpm --dir scripts/doc-driven-dev test` and `pnpm --dir scripts/doc-driven-dev run lint:md`, then report outcomes.
5. For compatibility-impacting updates, explicitly call out expected impact and migration approach.

## 4. Standard Commands

Run from the repository root against the isolated scripts workspace:

```bash
pnpm --dir scripts/doc-driven-dev run build:scripts
pnpm --dir scripts/doc-driven-dev test
pnpm --dir scripts/doc-driven-dev run lint:md
```

When needed, run these from `packages/doc-driven-dev/`:

```bash
apm compile --dry-run
apm compile --validate
```

Note:

- In this package, `apm compile --validate` may fail in some environments due to `.apm` instruction discovery behavior.
- Prioritize `pnpm --dir scripts/doc-driven-dev test` as the main regression signal.

## 5. Script Safety Notes

- `doc-status` scripts (`list_docs`, `audit_docs`) are primarily report-only.
- In `adr-doc`, `update_index` and `relate_adr` default to dry-run; `--write` is required for file updates.
- Avoid destructive changes; verify with dry-run or JSON output first.

## 6. Change Checklist

- Updated the relevant skill documentation for the intent of the change.
- Regenerated `packages/doc-driven-dev/.apm/skills/**/scripts/*.js` when `scripts/doc-driven-dev/src` changed.
- Confirmed tests pass with `pnpm --dir scripts/doc-driven-dev test`.
- Checked Markdown quality with `pnpm --dir scripts/doc-driven-dev run lint:md` when Markdown files changed.

## 7. Workflow Skills (Implementation Phase)

In addition to document-generation skills (which have scripts, templates, and references), this package includes **workflow skills** for the implementation phase. These are pure-markdown guidance skills with no TypeScript source or compiled scripts.

- Workflow skills live only in `packages/doc-driven-dev/.apm/skills/<name>/` (no corresponding `scripts/doc-driven-dev/src/skills/<name>/`).
  - If a workflow skill later gains code, that code belongs under `scripts/doc-driven-dev/src`, not under `packages/doc-driven-dev/`.
- They may include `references/` and/or `assets/templates/` subdirectories for supporting docs and prompt templates.
- They do NOT participate in `pnpm --dir scripts/doc-driven-dev run build:scripts`.
- When editing workflow skills, update `packages/doc-driven-dev/.apm/skills/<name>/SKILL.md` (and `.ja.md`) directly.

Workflow and meta skills included:

| Skill | Purpose | Origin |
|-------|---------|--------|
| briefing-flow | Meta skill: dynamic orchestrator for briefing and spec/ADR preparation | original |
| doc-driven-dev-flow | Meta skill: six-phase document lifecycle orchestrator | original |
| implementation-flow | Meta skill: dynamic orchestrator that discovers and routes to all available implementation skills via implementation profiles | original |
| deep-dive | Codebase-aware interrogation of user intent, constraints, and decision axes | original |
| skill-discovery-protocol | Flow-neutral skill catalog / profile generation and validation | original |

## 8. Non-Goals

- Unrelated large refactors.
- Requiring ADR/spec/plan/task authoring and relation tracking for this package's own implementation tasks.
- Changes that break existing index or relation consistency.
