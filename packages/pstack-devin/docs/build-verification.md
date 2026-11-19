# Build verification log — generated `devin-plugin/` (issues `#213`/`#214`)

Reproduction contract: every command below was run on the recorded date and
platform from the repository root on branch `feat/pstack-team-kit-deps`
(the earlier `#214` log ran against worktree `.worktrees/pstack-devin-214`
at pin `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`). Re-run blocks verbatim
from the repository root to reproduce; divergence means the generated tree
is stale and must be rebuilt. (`#213` recorded the same blocks against
`.worktrees/pstack-devin-213`; the tree shape then was 549 files with no
exercised overwrite.)

Note on this run: GitHub rate-limited anonymous `git fetch` (HTTP 429), so
the upstream objects were reconstructed from the GitHub REST API into a
local bare mirror — every commit/tree/blob object sha-verified byte-exact —
and served to the build over `git://localhost` via a per-process
`url.insteadOf` override. The produced tree sha is identical to what a
direct GitHub fetch yields; the pin and object integrity checks are
unchanged.

## 1. Environment

- date: 2026-11-19
- platform: windows, git-bash (`core.fileMode=false` — executable bits are
  carried by the git index via `git update-index --chmod=+x`, not by the
  filesystem)
- package manager: pnpm via `mise exec --`

## 2. Build

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build
```

Output (verbatim; the absolute path prefix is machine-specific):

```text
$ tsx src/cli.ts build
built G:\repositry\apm-packages\packages\pstack-devin\devin-plugin: 544 files, upstream tree 9f63e68efd0e0de310d8164d7d43b00c549a839f
```

Both `overlay.yml` `allow_overwrite` entries are now exercised —
`agents/poteto-agent.md` (the Devin-native profile, `#214`) and
`skills/setup-pstack/SKILL.md` (the Devin delegation entry, `#215`) — so
the earlier "entry unused" warning no longer appears.

## 3. Provenance

`devin-plugin/provenance.json` summary (schema
`pstack-devin/provenance@1`, written by `scripts/pstack-devin build`):

| Field | Value |
| --- | --- |
| `upstream.repo` / `upstream.path` | `cursor/plugins` / `harness/pstack/claude-code` |
| `upstream.commit` | `b4a4f6151b8e77f8d71045f09f553a733cf0ed37` |
| `upstream.tree_sha` | `9f63e68efd0e0de310d8164d7d43b00c549a839f` |
| `upstream.version` | `0.15.43` |
| `upstream.file_count` | 537 |
| `executables` | 5 paths (see §6) |
| `overlay.additions` | `.devin-plugin/plugin.json`, `AGENTS.md`, `docs/harness/devin.md`, `skills/setup-pstack-devin/` (3 files) |
| `overlay.overwrites` | `agents/poteto-agent.md`, `skills/setup-pstack/SKILL.md` |

The provenance record carries no timestamps: identical inputs produce an
identical file, so it is itself part of the byte-stability contract.

Note: the `additions[].sha256` values are hashes of the overlay SOURCE
bytes as read from the worktree. An earlier provenance recorded the CRLF
hash of `.devin-plugin/plugin.json` (the overlay file then had CRLF on
disk); `.gitattributes` `eol=lf` normalization means the LF hash is the
steady state, and the current record matches the committed blob bytes.

## 4. Committed tree size

```bash
find packages/pstack-devin/devin-plugin -type f | wc -l
# -> 544
```

544 = 537 upstream files + 6 overlay additions (`.devin-plugin/plugin.json`,
`AGENTS.md`, `docs/harness/devin.md`, plus the three
`skills/setup-pstack-devin/` files) + 1 generated `provenance.json`.
The two overwrites replace upstream paths, so they do not change the count.

## 5. Determinism — `check-generated` is the second build

```bash
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
```

Output (verbatim, pre-commit mode — see below):

```text
$ tsx src/cli.ts check
check-generated PASS: 544 files, upstream tree 9f63e68efd0e0de310d8164d7d43b00c549a839f
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
what the pipeline produces. Because that gate compares the staged tree
against HEAD, `check-generated` only passes once the rebuilt tree has been
committed; run it after committing regenerated output. The one exception
is the apply-update pipeline itself, which runs `check` in pre-commit
mode (`check --pre-commit` / `PSTACK_DEVIN_CHECK_PRECOMMIT=1`): the
regenerated tree legitimately differs from HEAD until the run's single
atomic commit lands, so the vs-HEAD gate is skipped while the byte
compare and exec-bit gate still apply.

## 6. Executable bits

`core.fileMode=false` on Windows, so modes live in the index:

```bash
git ls-files -s -- packages/pstack-devin/devin-plugin | grep '^100755'
```

```text
100755 99807d577c3b006cfe6ee9e149cf2914bfd4afd6 0  packages/pstack-devin/devin-plugin/skills/poteto-mode/scripts/watch-pr/watch-pr
100755 47e08919d7b08c32923a7bdaaa70b17ca708f5f6 0  packages/pstack-devin/devin-plugin/skills/poteto-mode/scripts/worktree-audit.sh
100755 052e53b7e1090579eaec1d3d59f7a1cd2f2e452a 0  packages/pstack-devin/devin-plugin/skills/show-me-your-work/scripts/log.sh
100755 7d3aeb8c219bf20aea4cbc321892fca9cbd582f1 0  packages/pstack-devin/devin-plugin/skills/statechart/scripts/statechart
100755 b6634ad7ac998851cbce400bf5a52b37ee96ea80 0  packages/pstack-devin/devin-plugin/skills/statechart/scripts/test/java.ts
```

(The stage field `0` and the path are TAB-separated in real output; the tab
is rendered as spaces above.)

Five `100755` index entries, exactly matching `provenance.executables`
(`check-plan.mjs` lost its upstream exec bit since the previous pin).
`check` enforces this set equality and fails on any drift.

## 7. Compatibility audit (`#214`)

```bash
mise exec -- pnpm --dir scripts/pstack-devin run audit:compat
```

Output (summary line, verbatim):

```text
compat audit: 541 files scanned, 505 findings, 0 unknowns
```

541 = the 537 upstream files plus the generated `docs/harness/devin.md`
and the three `skills/setup-pstack-devin/` files (the scanner skips only
`.devin-plugin/`, `AGENTS.md`, and `provenance.json`). Every finding
resolves to a vocabulary row and zero unknowns means no unclassified
harness-API-shaped text exists in the tree — including the adapter doc's
own Devin-side tool names, which are lowercase and intentionally never
flagged. Per-class counts and the mapping rationale live in
`docs/devin-adapter-decisions.md`.

## 8. Acceptance mapping (issue `#213`)

| Acceptance criterion | Evidence |
| --- | --- |
| Snapshot + overlay + provenance in one pipeline | `build` produces all three in one run (§2); tests in `scripts/pstack-devin/tests/` |
| Allowlist enforcement + fixture tamper detection | `overlay.test.ts`, `check.test.ts` — `pnpm --dir scripts/pstack-devin test` |
| All 537 upstream files + assets present | `provenance.upstream.file_count: 537` (§3); committed tree 544 files (§4) |
| Previous artifact survives a failed build | atomic swap in `src/build.ts` (`keepPrev`), exercised by `build.test.ts` |
| Byte-stability | `check-generated` internal rebuild + sha256 compare PASS (§5) |
| `build` / `check-generated` entries with `git diff --exit-code` gate | `scripts/pstack-devin/package.json` scripts; cached-diff gate in `src/check.ts` (§5) |

## 9. Regeneration

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build            # regenerate devin-plugin/
mise exec -- pnpm --dir scripts/pstack-devin run check-generated  # verify committed tree == fresh rebuild
mise exec -- pnpm --dir scripts/pstack-devin run audit:compat     # classify every harness-API reference
```

Never edit `devin-plugin/` by hand. Overlay changes go in
`packages/pstack-devin/overlay/` (additions) and `overlay.yml`
(overwrite allowlist), then rebuild and commit the regenerated tree.
