# Upstream update pipeline

Status: active (issue `#219`) · Owner docs for the scheduled/dispatch
upstream watch and the update-PR machinery in `scripts/pstack-devin`.

## Purpose

Track `cursor/plugins` `main` for changes under
`harness/pstack/claude-code` and turn each real change into **one
reviewable PR** that re-pins this package. The pipeline proposes; a human
merges. Nothing auto-merges, nothing pushes to `main`, and a failed run
fails visibly — there are no silent retries.

## Pipeline anatomy

```text
check:upstream ──exit 0──▶ "up to date" (done; idempotent)
       │
       └──exit 42 + JSON──▶ dup-PR guard ──▶ report:update (markdown)
                              │                    │
                              │                    ▼
                              │              apply:update <sha>
                              │              (refs → apm install → build
                              │               → check-generated → verify
                              │               → ONE commit)
                              │                    │
                              ▼                    ▼
                         open PR on        report + re-verification
                   pstack-devin-upstream/<short>   notice = PR body
```

### 1. Detection — `pnpm run check:upstream` (idempotent)

- Resolves `refs/heads/main` on the upstream repo via `git ls-remote`.
- Equal to `upstream.yml upstream.commit` → prints `up to date`, exit 0.
- Different → blobless-fetches both commits and compares the **subtree
  tree SHA** (`<commit>:harness/pstack/claude-code`). Equal tree → exit 0:
  commits whose diff never touches our subtree (docs churn elsewhere,
  rebases, merges) are not updates.
- Different tree → prints one JSON line
  `{current, candidate, candidateTree, upstreamVersion?}`, exit **42**.
  Exit 42 is the "update available" contract the workflow keys on; any
  other non-zero exit is a real failure.

### 2. Report — `pnpm run report:update <candidateSha>`

Blob-diffs pinned vs candidate subtree, classifies every path
(`skills/`, `agents/`, `docs/`, manifests, `LICENSE`, other), and emits
the markdown that becomes the PR body. Every changed path appears exactly
once — a ❌ blocking row or a non-blocking bullet.

| Blocking kind | Trigger | Required action |
| --- | --- | --- |
| `overlay-path` | Upstream added/changed/removed a path the overlay owns (an `allow_overwrite` entry or a payload that is a pure addition) | Re-review the adapter content against the new upstream bytes |
| `license` | `LICENSE*` bytes changed or file removed | Legal review before adoption |
| `compat-unknown` | Compat-vocabulary scan of added/changed text files found unclassified API tokens | Extend `compat-vocabulary.ts` or reject the new surface |
| `role-new` | A consumer doc references a role `roles.json` does not know | Register/re-map the role |
| `role-removed` | A `roles.json` key is no longer referenced upstream | Drop or re-map the key |

Zero blocking rows = "simple update" — still human-merged, never
auto-merged.

### 3. Apply — `pnpm run apply:update <candidateSha>`

Sequential steps; **any** failure restores every pipeline-owned path to
`HEAD` (`git reset` + `git checkout` + scoped `git clean` on
`devin-plugin/`) and reports the failing step. All-or-nothing — the run
never leaves a half-applied pin.

1. `upstream.yml` — `upstream.commit` := candidate (comment-preserving
   single-line edit).
2. `apm.yml` — `devDependencies.apm[0].ref` := candidate (same
   single-line edit; `git:`/`path:`/`targets:` untouched).
3. `mise exec -- apm install` in `packages/pstack-devin` — regenerates
   `apm.lock.yaml`. The lockfile is never hand-edited.
4. `pnpm run build` — fetches the candidate subtree, re-materializes
   `devin-plugin/`, writes `provenance.json`, stages exec bits.
5. `observed` refresh — rewrites the informational `observed:` audit
   block in `upstream.yml` (`upstream_version`/`upstream_file_count`
   from `provenance.json`, `apm_content_hash`/`apm_package_type` from
   the regenerated lockfile). The pipeline is the only pin mover, so it
   is the only place these fields can be re-observed; missing sources or
   keys warn and are left untouched.
6. `pnpm run check-generated` — byte-compare a fresh rebuild against the
   regenerated tree plus the exec-bit gate. The run exports
   `PSTACK_DEVIN_CHECK_PRECOMMIT=1` for the whole apply, so this step and
   the `check-generated` nested inside `verify:l1` skip only the
   index-vs-HEAD clean gate — the tree legitimately differs from HEAD
   until the single commit lands (see `check --pre-commit` in
   `src/cli.ts`).
7. `pnpm run verify` — full L1+L2+L3+test suite against the new pin.
8. Commit — one commit
   `chore(pstack-devin): update upstream pin to <short-sha>` carrying
   refs + lockfile + generated tree + provenance together.

Guards: refuses to run when the candidate equals the current pin, when
the repo root is not a git work-tree root, when any pipeline-owned path
has uncommitted changes (rollback would otherwise discard them), or when
unrelated staged changes would be swept into the commit.

### 4. Workflow — `.github/workflows/pstack-devin-upstream.yml`

- Triggers: `schedule: "0 0 * * 1"` (weekly, Monday 00:00 UTC) +
  `workflow_dispatch`.
- Permissions: `contents: write` (push the update branch),
  `pull-requests: write` (open the PR). `GH_TOKEN` is `GITHUB_TOKEN`.
- Order: checkout → `jdx/mise-action@v2` (installs the `mise.toml`/
  `mise.lock` toolchain: node, pnpm, apm) →
  `pnpm --dir scripts/pstack-devin install` → `check:upstream`
  (exit 0 → summary, done; exit 42 → continue) → duplicate-PR guard
  (`gh pr list --search "<sha> in:title"`) → `report:update` →
  `git switch -c pstack-devin-upstream/<short>` →
  `apply:update <sha>` → push branch → `gh pr create`.
- `concurrency` serializes runs; `cancel-in-progress: false` because a
  killed apply step could leave an uncommitted worktree.
- The report step runs **before** `apply:update` on purpose: the report
  diffs pin-vs-candidate, and after adoption the pin *is* the candidate —
  running it later would produce an empty diff.

## Manual procedure (equivalent commands)

From the repository root, to do exactly what the workflow does:

```bash
mise exec -- pnpm --dir scripts/pstack-devin install
mise exec -- pnpm --dir scripts/pstack-devin run check:upstream
# on exit 42, copy "candidate" from the JSON line, then:
git switch -c pstack-devin-upstream/<short-sha>
mise exec -- pnpm --dir scripts/pstack-devin exec tsx \
  src/update-report.ts <candidate-sha>   # review first
mise exec -- pnpm --dir scripts/pstack-devin run apply:update \
  <candidate-sha>
git push -u origin pstack-devin-upstream/<short-sha>
gh pr create   # body = report + re-verification notice
```

`apply:update` needs a clean state for `packages/pstack-devin` pin files
and `devin-plugin/` — it refuses to run over uncommitted changes there
and needs `git` identity configured for the final commit.

## PR anatomy

- **Branch**: `pstack-devin-upstream/<short-sha>` (one branch per
  upstream commit).
- **Title**: `chore(pstack-devin): update upstream pin to <full-sha>` —
  the full sha stays verbatim because the duplicate-PR guard searches
  `<sha> in:title`.
- **Body**: the `report:update` markdown (Summary, Blocking, Categories,
  Non-blocking changes), then `Manual Devin CLI re-verification:
  REQUIRED (not run)`, and — when ❌ rows exist — a `> [!WARNING]`
  blocking callout.
- **Single commit**: refs + lockfile + generated tree + provenance, so
  `main` history stays one-commit-per-adoption and `git revert` undoes a
  bad update atomically.

## Human-review gate

The workflow never merges and never requests auto-merge. Merge requires
a human who has read the Blocking section; ❌ rows mean the adapter
(overlay/roles/compat vocabulary) must be re-reviewed first. A closed
update PR leaves its branch behind — the next run for the same candidate
hits the duplicate guard only while a PR is **open**, so re-proposing
after a close is a deliberate `git push` failure to investigate, not a
silent skip.

## Manual paid re-verification policy

CI cannot run Devin CLI probes (paid environment). Every update PR
therefore carries `Manual Devin CLI re-verification: REQUIRED (not run)`
in its body. The manual probe set and the pass/fail evidence format live
in `runtime-verification.md`; the deterministic check list lives in
`verification-matrix.md`. Re-verification is expected before merge for
updates with blocking findings, and may be deferred (tracked in the PR)
for simple updates at maintainer discretion — the notice is never
removed, only checked off by a human.

## Validation

- Workflow YAML: `actionlint` 1.7.12 —
  `mise exec actionlint@1.7.12 -- actionlint .github/workflows/pstack-devin-upstream.yml`
  (clean; `actionlint` is not yet a `mise.toml` tool, so the version is
  pinned inline here).
- `apply-update` rollback path and the yaml-edit helpers: fixture-repo
  tests in `scripts/pstack-devin/tests/apply-update.test.ts`
  (`pnpm --dir scripts/pstack-devin test`).
- End-to-end (scheduled run → PR) is exercised by the workflow itself;
  the first real run is the smoke test. Manual dry-equivalent: run the
  commands above through the `report:update` step and stop before
  `apply:update`.
