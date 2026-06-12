# AGENTS.md

This file is a practical guide for AI agents modifying `packages/doc-driven-dev`.

## 1. Purpose and Scope

- This package provides skills for document-driven development.
- The primary flow is `briefing -> ADR/spec -> design -> plan -> task -> implementation -> audit`.
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
- `skill-discovery-protocol` scans local skill roots such as `.agents/skills`
  and `apm_modules` when generating `.sdp` artifacts.
- Environment-provided skills can affect routing without becoming bundled
  package content, so docs must disclose optional external routing when an
  adapter refers to non-bundled skills such as `steer-web-research`.

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
- Document creation commands write files immediately unless the command
  explicitly says it is dry-run or report-only.
- Path flags such as `--dir`, `--file`, and `--out` change where generated or
  updated artifacts are written.
- `pnpm --dir scripts/doc-driven-dev run build:scripts` replaces distributed
  JavaScript outputs under `packages/doc-driven-dev/.apm/skills/**/scripts/*.js`.

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

Workflow and meta skills included here:

| Skill | Purpose | Origin |
|-------|---------|--------|
| doc-driven-dev-lifecycle | Meta skill: six-phase document lifecycle orchestrator | original |
| briefing-flow | Meta skill: dynamic orchestrator for briefing and spec/ADR preparation | original |
| implementation-flow | Meta skill: dynamic orchestrator that discovers and routes to all available implementation skills via implementation profiles | original |
| skill-discovery-protocol | Flow-neutral skill catalog / profile generation and validation | original |

## 8. Meta-Skill Activation Boundaries

This package contains three meta-skills that orchestrate different phases of document-driven development. To prevent undefined behavior, exactly one meta-skill must be active per user request.

### Activation Matrix

| Meta-Skill | Entry Condition | Responsibility | Mutual Exclusions |
|------------|-----------------|-----------------|-------------------|
| `doc-driven-dev-lifecycle` | User invokes with 6-phase scope explicitly OR no other entry point matches | Phase 1–6 orchestration; delegates Phase 1 to briefing-flow, Phases 5+ to implementation-flow | Must not activate if `briefing-flow` already active OR if request explicitly targets Phase 5+ (→ implementation-flow only) |
| `briefing-flow` | User invokes briefing/discovery/spec/ADR creation task explicitly OR lifecycle delegates Phase 1 | Phase A–D discovery; concurrent spec + ADR dispatch; skill stack assembly | Must not activate if `doc-driven-dev-lifecycle` is already driving Phase 2–6 OR if request explicitly targets code implementation (→ implementation-flow only) |
| `implementation-flow` | User invokes task execution / code implementation explicitly OR lifecycle delegates Phase 5 | Phase A–E task execution with review gates; discovers and routes available implementation skills | Must not activate if request targets document creation (→ lifecycle or briefing-flow) OR if user is in mid-briefing or design review |

### Dispatch Decision Tree

```
Entry Request
├─ Contains "lifecycle" or "6-phase" or "end-to-end" keyword?
│  └─ YES → doc-driven-dev-lifecycle
│
├─ Contains "briefing" or "discovery" or "spec" or "adr" keyword?
│  └─ YES → briefing-flow
│
├─ Contains "implement" or "code" or "execute" or "task" keyword?
│  └─ YES → implementation-flow
│
└─ No clear meta-skill signal → Consult request context
   ├─ If in middle of spec/ADR creation → briefing-flow
   ├─ If design already approved, in planning/task phase → lifecycle or implementation-flow per context
   └─ If uncertain → Escalate to user for clarification
```

### Guarantees

1. **Single Active Meta-Skill**: Only one meta-skill is active per user-facing request. Delegation between meta-skills is controlled via explicit phase gates, not concurrent activation.
2. **No Cross-Activation Loops**: If `lifecycle` delegates to `briefing-flow` (Phase 1), then `briefing-flow` does NOT simultaneously activate `lifecycle` or `implementation-flow` unless the user makes a new, explicit request.
3. **Phase Boundary Enforcement**: Once a phase gate is satisfied, the next meta-skill in sequence activates only on explicit user request or documented delegation, never unilaterally.

### Testing

Integration tests verify:
- Activation conflicts are detected (two meta-skills competing for same request).
- Review gate names remain canonical (`requesting-code-review` for Phase E).
- Delegation boundaries are honored (Phase 1 completes before Phase 2 activation).

See `scripts/doc-driven-dev/tests/integration/activation-conflict-detector.test.ts` and `review-gate-contract.test.ts`.

## 9. Non-Goals

- Unrelated large refactors.
- Requiring ADR/spec/plan/task authoring and relation tracking for this package's own implementation tasks.
- Changes that break existing index or relation consistency.
