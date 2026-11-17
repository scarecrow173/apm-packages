---
name: verify-pstack-devin
description: "Verification harness for scripts/pstack-devin — the TypeScript CLI toolchain that builds and contract-checks packages/pstack-devin (the byte-pinned Devin plugin distribution of upstream pstack). Use to prove build/check/audit/l3-dist/upstream-watch behavior end-to-end: launch the toolchain, drive its package scripts, capture exit-code/stdout/git-state evidence."
---

# Verify pstack-devin

The app under test is `scripts/pstack-devin`, a private TypeScript CLI
toolchain (`package.json` name `pstack-devin-build`) that regenerates
and contract-checks the `packages/pstack-devin` APM package — a
byte-pinned Devin plugin distribution of upstream `cursor/plugins`
`harness/pstack/claude-code`.

**Surface:** non-interactive batch CLIs. Every user-facing surface is a
`package.json` script that runs `tsx src/*.ts`, prints a report to
stdout, and exits `0` (pass), `1` (failure/error), or `42`
(`check:upstream`'s "update available" verdict). There is no server, no
TUI, no ports — a plain subprocess pipe is the whole harness; no PTY or
tmux session is ever needed.

Everything runs from the repository root through `mise exec --` so the
`mise.toml`-pinned toolchain applies (root `AGENTS.md` §0: the mise
shims are excluded from PATH on purpose).

## Launch

One-time setup per checkout/worktree. No long-lived process results —
"launched" means the toolchain can run at all:

1. `mise install` — only on a fresh clone or after `mise.toml`/
   `mise.lock` changes; a cheap no-op otherwise. Pins node 24, pnpm 11,
   apm 0.33.0.
2. `mise exec -- pnpm --dir scripts/pstack-devin install` — installs
   `tsx`, `typescript`, `js-yaml`, `markdownlint-cli2` under
   `scripts/pstack-devin/node_modules/`.
3. `mise exec -- pnpm --dir scripts/pstack-devin run probe:fixture` —
   (re)generates `scripts/pstack-devin/fixtures/smoke-repo`, the
   gitignored throwaway consumer repo the `probe:*` drives use. Skip
   only if no probe drive is planned.

Ready = the [Doctor](#doctor) check exits `0`. There are no migrations
and no seed data beyond the fixture.

Teardown: nothing to stop — every drive is a short-lived process that
exits on its own. [Cleanup](#cleanup) covers residue.

## Doctor

One read-only check, run first after launch and again whenever anything
looks off:

```bash
mise exec -- node .devin/skills/verify-pstack-devin/scripts/doctor.mjs
```

Exit `0` means worth driving. It verifies, read-only:

- `scripts/pstack-devin/node_modules/tsx` exists — launch step 2 ran.
- `packages/pstack-devin/devin-plugin/provenance.json` exists — a
  generated tree is present for the checkers to assert against.
- The tree's provenance `upstream.commit` equals the `upstream.commit`
  pin in `packages/pstack-devin/upstream.yml` — the built tree matches
  the contract the checkers enforce.
- Prints `git status --porcelain -- packages/pstack-devin/` — the
  baseline every git-mutating drive compares against. A dirty baseline
  is reported, not failed, but do not drive `check-generated` or
  `apply:update` against one (their feature files explain why).
- Warns (never fails) when `fixtures/smoke-repo` is missing — only
  `probe:*` drives need it.

A non-zero exit names the failed check and the launch step that fixes
it.

## Drive

Every drive is one `package.json` script through the shipped helper,
run from the repository root:

```bash
mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs \
  <evidence-dir> <script> [args...]
```

- `<evidence-dir>` — created if needed; by convention
  `scripts/pstack-devin/fixtures/evidence/<run-id>/` (gitignored).
- `<script>` — a script name from `scripts/pstack-devin/package.json`:
  `build`, `check-generated`, `check:safety`, `audit:compat`,
  `check:links`, `check:roles`, `check:marketplace`, `check:upstream`,
  `report:update`, `apply:update`, `probe:fixture`, `probe:consumer`,
  `verify:l1`, `verify:l2`, `verify:l3`, `verify`, `test`, `lint:md`.
- `[args...]` — verbatim extra args (`apply:update <40-hex-sha>`,
  `report:update <40-hex-sha>`, `probe:consumer --ref <sha>`).

The helper runs the exact maintainer command `mise exec -- pnpm --dir
scripts/pstack-devin run <script> [args...]` and records command, cwd,
exit code, full stdout/stderr, elapsed time, and
`git status --porcelain -- packages/pstack-devin/` before and after
into `<evidence-dir>/<script-args>.log`, then re-emits the drive's exit
code. Aggregate scripts (`verify:l1`/`l2`/`l3`, `verify`) compose the
same primitives — driving one counts as driving every check it
contains.

Feature recipes live in `features/` — read `features/README.md` first,
then the feature file. The map is the maintained source of which
maintainer-facing surface each script proves; drive from it, not from
memory of this list.

## Evidence

Named location: `scripts/pstack-devin/fixtures/evidence/<run-id>/`,
where `<run-id>` is `<yyyymmdd-hhmmss>-<feature-id>` — e.g.
`20261117-153000-safety-scan`. The `fixtures/` tree is gitignored
(`scripts/pstack-devin/.gitignore`), so evidence never pollutes the
repo and survives cleanup.

Proof standards for this app:

- Exercise the real command — what runs is the same
  `pnpm --dir scripts/pstack-devin run <script>` line a maintainer
  types; the helper only records, never stubs.
- Capture the action AND the resulting state: command line, exit code,
  full stdout+stderr, and git status before/after. For this app, side
  effects are git state (index staging, a commit, an appended docs
  file) plus gitignored scratch (`build/`, `fixtures/`).
- A pass is exit `0` AND the tool's own summary line in the log —
  `safety scan: N files scanned, 0 findings`,
  `check-generated PASS: N files, upstream tree <sha>`,
  `compat audit: N files scanned, F findings, 0 unknowns`,
  `link-check: … 0 broken, 0 unresolved`,
  `role registry: … 0 unknown, 0 dead`,
  `l3-dist: …, pack match, compile expected-na`,
  `check-marketplace: deps 0, marketplace 0, lockfile 0, packageDir 0`.
  Record the summary in the run report, not just "it exited 0".
- Exit `42` from `check:upstream` is "update available" — a verdict
  carrying JSON coordinates, not a failure.
- A `skipped` probe line (`pack: skipped` / `compile: skipped` inside
  `verify:l3` output) is NOT a pass — it means `apm`/`mise` was absent
  and the surface went unexercised. `mise install`, then re-drive.
- `probe:consumer` writes a scratch consumer outside the repo and
  appends evidence to the tracked
  `packages/pstack-devin/docs/l3-verification.md` — that `M` in the
  after-status is its documented behavior, not drift.
- No mocks: every check observes the committed/generated tree. The two
  dry-run boundaries are `apm pack --dry-run` (inside `verify:l3`) and
  `check-generated`'s temp rebuild under `packages/pstack-devin/build/`
  (deleted on every path) — both observe real behavior.

## Cleanup

After the run:

- Nothing to kill — drives are batch processes; a killed terminal
  orphans no server. The only crash residue a `build`/`check-generated`
  leaves is `packages/pstack-devin/build/` (staging/fetch dirs,
  `devin-plugin.prev`) — remove it: `rm -rf packages/pstack-devin/build`.
  It is gitignored scratch, safe to delete any time.
- `scripts/pstack-devin/fixtures/smoke-repo` may stay (gitignored seed
  state; `probe:fixture` recreates it on demand). Remove it only for a
  pristine end state. NEVER remove
  `scripts/pstack-devin/fixtures/evidence/` — proof artifacts survive
  teardown.
- Git-state residue: `check-generated` stages
  `packages/pstack-devin/devin-plugin` into the index BY DESIGN (that
  staging is the gate), so on a clean tree the after-status stays
  clean. If the after-status differs from the doctor baseline only by
  your run's staging, restore it:
  `git restore --staged -- packages/pstack-devin`. An `apply:update`
  drive creates a real commit by design — undo it only with an
  explicit, deliberate `git reset`, never silently.
- Confirm evidence survived:
  `ls scripts/pstack-devin/fixtures/evidence/<run-id>/` must still list
  the logs after cleanup. A cleanup that ate the proof fails the run.

## Helpers

Both helpers are dependency-free node ESM scripts under
`.devin/skills/verify-pstack-devin/scripts/`, run via the same pinned
node as the drives:

| Helper | Invocation | What it does |
| --- | --- | --- |
| `scripts/doctor.mjs` | `mise exec -- node .devin/skills/verify-pstack-devin/scripts/doctor.mjs` | Read-only worth-driving check (see [Doctor](#doctor)): deps, generated tree, provenance==pin, baseline git status, fixture presence. |
| `scripts/run-drive.mjs` | `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs <evidence-dir> <script> [args...]` | Drives one package script, writes `<evidence-dir>/<script-args>.log` with command/exit/stdout/stderr/git-status before+after, re-emits the drive's exit code. |

Keep this skill and `features/` honest as the app's scripts change —
the `maintain-verification-skill` loop (`/pstack:maintain-verification-skill`
in the shipped plugin) is the upkeep pass for exactly this kind of
skill.
