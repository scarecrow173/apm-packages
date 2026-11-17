# pstack-devin verification map

This directory is the maintained source for verifying the
maintainer-facing behavior of `scripts/pstack-devin` — the TypeScript
CLI toolchain that builds and contract-checks `packages/pstack-devin`.
Read this index before driving, then use the matching feature file as
the recipe.

Here "user" means the maintainer running the toolchain: their interface
is `mise exec -- pnpm --dir scripts/pstack-devin run <script>` — one
short-lived batch process per drive, no server.

## Baseline preconditions

- Run from the repository root of THIS checkout; every command resolves
  `../../..` from `scripts/pstack-devin/src/`, so it always operates on
  the checkout it lives in.
- Launch ran: `mise exec -- pnpm --dir scripts/pstack-devin install`
  and `run probe:fixture` (see `../SKILL.md`).
- `doctor.mjs` exits `0` — deps installed, generated tree present,
  provenance commit equals the `upstream.yml` pin.
- Pick an evidence dir:
  `scripts/pstack-devin/fixtures/evidence/<run-id>/`.
- Network boundary: `build`, `check-generated`, `check:upstream`,
  `report:update`, `apply:update`, and `probe:consumer --ref` reach
  github.com — every other drive is fully local. A drive that needs
  network in a no-network run reports `verified-unreachable` with the
  precondition, never a pass.
- Git-mutating drives (`check-generated` stages the index,
  `apply:update` commits, `probe:consumer` appends a tracked docs file)
  require a clean `git status --porcelain -- packages/pstack-devin/`
  baseline.

## Driving conventions

- One drive = one package script through the helper:
  `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs <evidence-dir> <script> [args...]`
- The helper re-emits the drive's exit code — chain or stop on it.
  Exit `0` = pass, `1` = failure, `42` = `check:upstream`'s
  update-available verdict (not a failure).
- `skipped` probe lines inside `verify:l3` (`pack:`/`compile:`) mean
  the surface went unexercised — missing `apm`/`mise`, not a pass.
- Never edit the app mid-run: a red drive is a finding, not a prompt
  to patch the checker. The one exception is skill-internal drift
  (see `../SKILL.md`).
- Keep commands literal — the checkers pin real paths
  (`packages/pstack-devin/devin-plugin`, root `apm.yml`,
  `apm.lock.yaml`).

## Proof and skip reporting

- A pass needs all three in the drive log: the command, exit `0`, and
  the tool's own pass-summary line (listed per feature).
- Git-mutating drives additionally need the before/after `git status`
  agreeing, or differing exactly as the feature file documents.
- Report a skipped/blocked drive with the command attempted and the
  unmet precondition — never relabel it verified through another path.
- Evidence lives in the named `<evidence-dir>`; cleanup never touches
  it.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing
the maintainer-visible behavior, then exactly four H2 sections in this
order:

1. `Sub-features` lists short IDs with one line per behavior.
2. `How to get to it (user POV)` lists every maintainer entry point.
3. `Driving it with run-drive` starts with `Preconditions:` and uses
   labeled bullets pairing each action with the exact command and
   observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

Keep implementation details out of the map. Name only entry points,
commands, required state, and observable proof.

## Features

- [Deterministic build & generated-tree check](./deterministic-build-check.md)
  covers `build` and `check-generated` — the rebuild/drift gate.
- [Safety scan](./safety-scan.md) covers `check:safety` — secrets,
  oversized files, exec bits, plugin manifest.
- [Compat audit & reference checks](./compat-audit.md) covers
  `audit:compat`, `check:links`, `check:roles` (`verify:l2`).
- [L3 distribution pack](./l3-dist-pack.md) covers `verify:l3`
  (l3-dist + `check:marketplace`) and the manual `probe:consumer`.
- [Upstream watch & pin update](./upstream-watch.md) covers
  `check:upstream`, `report:update`, `apply:update`.
