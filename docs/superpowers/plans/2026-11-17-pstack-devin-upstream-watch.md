# pstack-devin Upstream Watch + Update-PR Automation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Turn upstream `cursor/plugins` updates into reviewable pinned-commit update PRs — automated detection/proposal, NEVER auto-merge; breaking changes surface as blocking reports.

**Architecture:** three new `scripts/pstack-devin` tools reusing `gittools.ts`/`config.ts`/`compat-audit.ts`/`role-registry.ts` machinery, plus a minimal scheduled/dispatch GitHub Actions workflow using `GITHUB_TOKEN` only.

## Components

- `src/check-upstream.ts` — `git ls-remote https://github.com/cursor/plugins refs/heads/main` → fetch candidate commit blobless → read tree SHA of `harness/pstack/claude-code` → compare vs current pin's tree SHA (from `upstream.yml` commit). Same → print "up to date", exit 0 (idempotent). Different → exit 42 + emit JSON `{current, candidate, candidateTree}` consumed by workflow/report.
- `src/update-report.ts` — blob-diff current vs candidate trees → classify paths by category: `skills/`, `agents/`, `docs/`, root manifests, LICENSE, other; flag (a) allowlist-covered paths (`overlay.yml` `allow_overwrite` + `poteto-agent.md`) that changed = **blocking** (adapter overwrite must be re-reviewed), (b) LICENSE hash change = blocking, (c) new/deleted files; run compat vocabulary scan on NEW/CHANGED text files only (reuse `scanTree`/vocabulary from compat-audit as importable fn) — new unknowns = blocking; role-registry diff if `roles.json` or role refs changed. Output markdown report = PR body core.
- `src/apply-update.ts` — atomic adoption helper (manual/dispatch run): set `upstream.yml` commit + `apm.yml` devDep `ref` → `apm install` regen lockfile → `pnpm run build` → `check-generated` → `verify` → commit all as ONE commit (tree+refs+lockfile+provenance together, or nothing).
- `.github/workflows/pstack-devin-upstream.yml` — `schedule: cron weekly` + `workflow_dispatch`; `permissions: contents: write, pull-requests: write` only; job: checkout → mise → pnpm install → `check-upstream` (exit 42 = update) → `apply-update` on a `pstack-devin-upstream/<short-sha>` branch → `update-report` into PR body → `gh pr create` UNLESS an open PR with that SHA already exists (`gh pr list --search`). No retries on failure (workflow fails visibly), never touches `main` directly, never auto-merges.
- PR body template: upstream commit/version diff, generated-tree diff summary, compat/L1-L3 results, known constraints, "manual Devin CLI re-verification: REQUIRED / not run" line.

## Constraints

- No auto-merge/auto-publish; PR requires human review. Manual paid verification is an explicit gate noted in PR body.
- Idempotent: same upstream SHA → no branch, no PR, exit 0.
- Workflow perms minimal (contents+pull-requests only); `GH_TOKEN` from `GITHUB_TOKEN`.
- Blocking conditions = allowlist-target change, LICENSE change, new unknown vocabulary, new/removed roles, safety-scan hits — reported as ❌ BLOCKING rows, PR labeled/marked "needs-adapter-review".

## File Map
| Path | Responsibility |
| --- | --- |
| `scripts/pstack-devin/src/{check-upstream,update-report,apply-update}.ts` | detection, classification, adoption |
| `scripts/pstack-devin/tests/upstream.test.ts` | fixture trees: same→exit0, diff→exit42+report, blocking classification |
| `.github/workflows/pstack-devin-upstream.yml` | scheduled/dispatch automation |
| `packages/pstack-devin/docs/upstream-updates.md`(+ja if user-facing) | procedure + PR anatomy |

## Tasks

### Task 1: check-upstream + update-report + tests
- [ ] Both tools + `upstream.test.ts` fixtures (two synthetic trees: identical→exit0; changed→exit42; each blocking class detected; non-blocking changes classified non-blocking). Scripts `check:upstream`, `report:update`. Network call (ls-remote/fetch) injectable/mocked in tests.

### Task 2: apply-update + workflow + docs
- [ ] `apply-update.ts` + workflow yaml (weekly + dispatch, minimal perms, dup-PR guard via SHA search, no auto-merge) + `docs/upstream-updates.md` procedure. Validate workflow syntax (`actionlint` if available else careful review). Commit.

### Task 3: sweep + issue comment
- [ ] Full `pnpm test`+`lint:md`+`verify:l2/l3`; flip checkboxes; `#219` comment.

## Self-Review
Criteria: idempotent ✓(tree-SHA + PR-search guard); coherent proposal PR ✓(apply-update atomic commit); compat failure blocking ✓(report ❌ rows); published unchanged till review ✓(PR-only); simple-vs-breaking distinguish ✓(blocking classification).