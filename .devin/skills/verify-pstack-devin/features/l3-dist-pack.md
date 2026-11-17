# L3 distribution pack

The maintainer proves the package's distribution shape — the
`.devin-plugin/plugin.json` schema, the generated tree's required
layout, `.apm/` ⇄ `devin-plugin/` separation, the observed behavior of
the pinned `apm` binary (`pack --dry-run`, `compile --validate`), and
the marketplace registration contract — plus, manually, a real
consumer install.

## Sub-features

- `l3-manifest` — full plugin.json schema (name/version/description/
  author/license/keywords/platforms).
- `l3-layout` — required tree entries including `docs/harness/devin.md`.
- `l3-separation` — `.apm` and `devin-plugin` product trees never
  conflate.
- `l3-apm-pack` — `apm pack --dry-run` emits the recorded manifest set.
- `l3-apm-compile` — `apm compile --validate` yields the documented
  skill-only N/A.
- `l3-marketplace` — root `apm.yml` dep entry + marketplace block and
  `apm.lock.yaml` lockfile entry pin the package registration.
- `l3-consumer` — manual probe: a real `apm install` into a scratch
  consumer outside the repo.

## How to get to it (user POV)

- `pnpm --dir scripts/pstack-devin run verify:l3` — l3-dist +
  check:marketplace in sequence.
- `tsx src/l3-dist.ts` and `tsx src/check-marketplace.ts` — the two
  halves directly.
- `pnpm --dir scripts/pstack-devin run probe:consumer` — manual
  path-source install; `--ref <40-hex>` for the git-source form
  (network).
- `pnpm --dir scripts/pstack-devin run probe:fixture` — regenerates
  the throwaway consumer repo the probes use.

## Driving it with run-drive

Preconditions:

- Launch complete, `doctor.mjs` exit `0`.
- `apm` resolvable via `mise exec --` (the mise.toml pin) or the
  pack/compile probes report `skipped`.
- `verify:l3` itself is fully local.

- **L3 suite.** `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs scripts/pstack-devin/fixtures/evidence/<run-id> verify:l3`
  → exit `0`; stdout carries `l3-dist: manifest 0, layout 0,
  separation 0, pack match, compile expected-na` then
  `check-marketplace: deps 0, marketplace 0, lockfile 0, packageDir 0`.
- **Probe verdicts.** `pack: match — observed manifest set matches the
  recorded apm 0.33.0 behavior` and `compile: expected-na` are the pass
  shapes; `skipped`/`drift`/`unexpected` each name their reason.
- **Consumer probe (manual).** `run-drive.mjs <evidence-dir>
  probe:consumer` — writes a scratch consumer in temp, runs real `apm
  install`, appends evidence to tracked
  `packages/pstack-devin/docs/l3-verification.md` (the `M` in
  after-status is the documented side effect). Pass extra args
  verbatim: `run-drive.mjs <evidence-dir> probe:consumer --ref <sha>`
  needs github.com.
- **Proof.** Logs show the `match`/`expected-na` verdicts and the
  marketplace pass; a consumer run additionally shows
  deployed/vendored/lockfile counts and the docs append.

## Gotchas

- `verify:l3` can exit `0` with `skipped` probes — the summary line is
  the verdict; a skipped probe is an unexercised surface, not a pass.
  Fix with `mise install`, then re-drive.
- `apm compile --validate` has TWO expected-na shapes: non-zero exit
  with `No instruction files found` (no `apm_modules/`), or exit `0`
  with `Validated 0 primitives` (post-`apm install`). Any third outcome
  is `unexpected` — real drift to investigate.
- `probe:consumer` is deliberately NOT wired into `verify` — it spawns
  the real apm and its `--ref` form hits the network; the scratch
  consumer lives outside the repo so `git status` cannot see it — the
  `docs/l3-verification.md` append is what shows.
- Windows `apm_modules` paths can exceed `MAX_PATH` (`#212`) — a
  consumer probe failing on path length is the recorded caveat, not
  new drift.
- `apm pack --dry-run` reports what it WOULD write — a real
  (non-dry-run) `apm pack` would create `.claude-plugin/`/`.github/`
  side effects in the package; the probe never triggers them.
