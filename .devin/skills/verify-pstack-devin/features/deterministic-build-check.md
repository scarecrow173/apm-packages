# Deterministic build & generated-tree check

The maintainer regenerates `packages/pstack-devin/devin-plugin/` from
the pinned upstream commit plus `overlay/`, and proves the committed
tree is byte-exact reproducible — file set, per-file sha256, git index
exec modes, and provenance — before trusting any other check.

## Sub-features

- `build-fetch` fetches the pinned upstream commit (blobless, depth 1)
  and materializes its `harness/pstack/claude-code` subtree.
- `build-overlay` applies `overlay/` additions and allowlist-guarded
  overwrites, validates `.devin-plugin/plugin.json`, writes
  `provenance.json`.
- `build-stage` stages the tree into the git index and restores exec
  bits (`update-index --chmod=+x`) for provenance `executables`.
- `check-rebuild` rebuilds into `packages/pstack-devin/build/check-out`
  and byte-compares path set + sha256 against committed `devin-plugin/`.
- `check-git-gates` requires a clean `git diff --cached` on the plugin
  pathspec and an index `100755` set equal to provenance `executables`.

## How to get to it (user POV)

- `pnpm --dir scripts/pstack-devin run build` — regenerate the tree.
- `pnpm --dir scripts/pstack-devin run check-generated` — prove the
  committed tree equals a fresh rebuild (first leg of `verify:l1`).
- `tsx src/cli.ts check --pre-commit` — the pipeline variant used
  inside `apply:update` (skips only the committed-vs-HEAD gate).
- `pnpm --dir scripts/pstack-devin run verify:l1` — `check-generated`
  and `check:safety` as one command.

## Driving it with run-drive

Preconditions:

- Launch complete, `doctor.mjs` exit `0`.
- Network: github.com reachable — both drives fetch the pinned commit;
  ~546 sequential blob fetches can hit GitHub rate limits
  (`docs/verification-matrix.md` records this).
- Baseline `git status --porcelain -- packages/pstack-devin/` is clean.

- **Build.** Run `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs scripts/pstack-devin/fixtures/evidence/<run-id> build`.
  Exit `0` and stdout `built <pkg>/devin-plugin: N files, upstream tree
  <sha>`. On an already-synced tree the after-status is unchanged — the
  staging is a no-op diff-wise; a changed tree shows staged `M`/`A`
  entries under `devin-plugin/`.
- **Check pass.** Run the same with `check-generated`. Exit `0` and
  stdout `check-generated PASS: N files, upstream tree <sha>`. The
  `build/check-out` temp rebuild is deleted on every path — confirm
  `packages/pstack-devin/build/` is absent after.
- **Drift path (optional, mutating).** On a baseline you own, edit one
  byte in a committed `devin-plugin` file, drive `check-generated` —
  it must exit `1` listing `content differs: <path>`. Then restore:
  `git checkout -- <path>` and `git restore --staged -- packages/pstack-devin`.
  Never leave the drift in place.
- **Proof.** The drive logs hold the `built`/`PASS` lines, exit `0`,
  and clean after-status; `git diff --cached -- packages/pstack-devin`
  empty is part of the proof.

## Gotchas

- `check-generated` stages `packages/pstack-devin/devin-plugin` into
  the index BY DESIGN — on a dirty baseline it sweeps unrelated
  uncommitted package changes into the index. Clean baseline or do not
  drive it.
- Both drives hit GitHub: `fetchAtCommit` fetches `--filter=blob:none`
  and `cat-file --batch` lazy-backfills ~546 blobs in one session. A
  rate-limit/offline failure exits `1` naming the fetch — report
  `verified-unreachable`, not a checker bug.
- `build` rename-swaps `devin-plugin/` atomically; a crash can leave
  `build/devin-plugin.prev` or `build/fetch.git` — remove
  `packages/pstack-devin/build/` in cleanup, never the tree itself.
- `PSTACK_DEVIN_CHECK_PRECOMMIT=1` in the environment flips check into
  pre-commit mode (the committed-vs-HEAD gate skips). Unset it for a
  normal drive or that gate silently does not run.
