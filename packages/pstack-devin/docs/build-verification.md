# Build verification log — generated `devin-plugin/` (issue `#213`)

Reproduction contract: every command below was run on the recorded date and
platform against worktree `.worktrees/pstack-devin-213`
(branch `feat/pstack-devin-issue-213`). Re-run blocks verbatim from the
repository root to reproduce; divergence means the generated tree is stale
and must be rebuilt.

## 1. Environment

- date: 2026-11-17
- platform: windows, git-bash (`core.fileMode=false` — executable bits are
  carried by the git index via `git update-index --chmod=+x`, not by the
  filesystem)
- package manager: pnpm via `mise exec --`

## 2. Build

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build
```

Output (verbatim; the absolute path prefix is worktree-specific):

```text
$ tsx src/cli.ts build
overlay allow_overwrite entry unused: skills/setup-pstack/SKILL.md
built G:\repositry\apm-packages\.worktrees\pstack-devin-213\packages\pstack-devin\devin-plugin: 549 files, upstream tree c1b4ae4da06c9815864bc7fe609cc5fb5324108c
```

The `allow_overwrite entry unused` line is expected, not an error:
`overlay.yml` declares `skills/setup-pstack/SKILL.md` as the only permitted
overwrite, but `#213` ships no overwrite content yet — the first real
overwrite lands in `#215`. The allowlist is the authority; the overlay is
currently additions-only.

## 3. Provenance

`devin-plugin/provenance.json` summary (schema
`pstack-devin/provenance@1`, written by `scripts/pstack-devin build`):

| Field | Value |
| --- | --- |
| `upstream.repo` / `upstream.path` | `cursor/plugins` / `harness/pstack/claude-code` |
| `upstream.commit` | `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7` |
| `upstream.tree_sha` | `c1b4ae4da06c9815864bc7fe609cc5fb5324108c` |
| `upstream.version` | `0.15.42` |
| `upstream.file_count` | 546 |
| `executables` | 6 paths (see §6) |
| `overlay.additions` | `.devin-plugin/plugin.json`, `AGENTS.md` |
| `overlay.overwrites` | `[]` (allowlist declared, none exercised) |

The provenance record carries no timestamps: identical inputs produce an
identical file, so it is itself part of the byte-stability contract.

## 4. Committed tree size

```bash
find packages/pstack-devin/devin-plugin -type f | wc -l
# -> 549
```

549 = 546 upstream files + 2 overlay additions (`.devin-plugin/plugin.json`,
`AGENTS.md`) + 1 generated `provenance.json`.

## 5. Determinism — `check-generated` is the second build

```bash
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
```

Output (verbatim):

```text
$ tsx src/cli.ts check
overlay allow_overwrite entry unused: skills/setup-pstack/SKILL.md
check-generated PASS: 549 files, upstream tree c1b4ae4da06c9815864bc7fe609cc5fb5324108c
```

`check` performs a full rebuild into `packages/pstack-devin/build/check-out`
— that internal rebuild **is** the second build of the double-build
determinism proof. It then compares the fresh tree against the committed
`devin-plugin/` by path-set equality plus per-file sha256 (see
`scripts/pstack-devin/src/check.ts` `diffTrees`). PASS means the committed
tree is byte-identical to a clean rebuild: output is a pure function of the
pin (`upstream.yml`), the overlay inputs (`overlay/` + `overlay.yml`), and
the builder. The temp rebuild is deleted on every path, so no second copy
remains in the worktree.

Beyond the byte compare, `check` also stages the generated tree, restores
exec bits in the index, and requires `git diff --cached --exit-code` to be
clean — so PASS additionally proves the committed output is in sync with
what the pipeline produces.

## 6. Executable bits

`core.fileMode=false` on Windows, so modes live in the index:

```bash
git ls-files -s -- packages/pstack-devin/devin-plugin | grep '^100755'
```

```text
100755 c3ddc398997d29d3c97a414e5c2b37172b901254 0  packages/pstack-devin/devin-plugin/skills/poteto-mode/scripts/check-plan.mjs
100755 99807d577c3b006cfe6ee9e149cf2914bfd4afd6 0  packages/pstack-devin/devin-plugin/skills/poteto-mode/scripts/watch-pr/watch-pr
100755 47e08919d7b08c32923a7bdaaa70b17ca708f5f6 0  packages/pstack-devin/devin-plugin/skills/poteto-mode/scripts/worktree-audit.sh
100755 052e53b7e1090579eaec1d3d59f7a1cd2f2e452a 0  packages/pstack-devin/devin-plugin/skills/show-me-your-work/scripts/log.sh
100755 7d3aeb8c219bf20aea4cbc321892fca9cbd582f1 0  packages/pstack-devin/devin-plugin/skills/statechart/scripts/statechart
100755 b6634ad7ac998851cbce400bf5a52b37ee96ea80 0  packages/pstack-devin/devin-plugin/skills/statechart/scripts/test/java.ts
```

(The stage field `0` and the path are TAB-separated in real output; the tab
is rendered as spaces above.)

Six `100755` index entries, exactly matching `provenance.executables`.
`check` enforces this set equality and fails on any drift.

## 7. Acceptance mapping (issue `#213`)

| Acceptance criterion | Evidence |
| --- | --- |
| Snapshot + overlay + provenance in one pipeline | `build` produces all three in one run (§2); tests in `scripts/pstack-devin/tests/` |
| Allowlist enforcement + fixture tamper detection | `overlay.test.ts`, `check.test.ts` — `pnpm --dir scripts/pstack-devin test` |
| All 546 upstream files + assets present | `provenance.upstream.file_count: 546` (§3); committed tree 549 files (§4) |
| Previous artifact survives a failed build | atomic swap in `src/build.ts` (`keepPrev`), exercised by `build.test.ts` |
| Byte-stability | `check-generated` internal rebuild + sha256 compare PASS (§5) |
| `build` / `check-generated` entries with `git diff --exit-code` gate | `scripts/pstack-devin/package.json` scripts; cached-diff gate in `src/check.ts` (§5) |

## 8. Regeneration

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build            # regenerate devin-plugin/
mise exec -- pnpm --dir scripts/pstack-devin run check-generated  # verify committed tree == fresh rebuild
```

Never edit `devin-plugin/` by hand. Overlay changes go in
`packages/pstack-devin/overlay/` (additions) and `overlay.yml`
(overwrite allowlist), then rebuild and commit the regenerated tree.
