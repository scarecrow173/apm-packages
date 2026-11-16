# Verification matrix — pstack-devin (issue `#216`)

What each deterministic command proves, what it cannot prove, and where
live validation is deferred. All commands run from the repository root
through `mise exec --` so the pinned toolchain applies; `pnpm` refers to
the repo-managed pnpm. Everything listed is deterministic, free, and
local unless a row says otherwise.

## Level L1 — build integrity & distribution safety

| Command | Proves |
| --- | --- |
| `pnpm --dir scripts/pstack-devin run build` | `devin-plugin/` regenerates from the pinned upstream commit + `overlay/` only |
| `pnpm --dir scripts/pstack-devin run check-generated` | committed tree is byte-exact reproducible: file set + sha256 + git index exec modes + overlay policy + provenance |
| `pnpm --dir scripts/pstack-devin run check:safety` | generated tree carries no secret-shaped tokens, no oversized files, provenance executables exist and can execute, `.devin-plugin/plugin.json` name/version/platforms contract |
| `pnpm --dir scripts/pstack-devin test` | inventory/overlay/build contract tests + negative fixtures for every checker |

## Level L2 — upstream compatibility & references

| Command | Proves |
| --- | --- |
| `pnpm --dir scripts/pstack-devin run audit:compat` | every harness-API token in shipped docs/scripts is a registered vocabulary entry — a new upstream API fails loudly |
| `pnpm --dir scripts/pstack-devin run check:links` | every reference in shipped `.md`/`.mdc` resolves to a real shipped target or a classified, justified skip kind |
| `pnpm --dir scripts/pstack-devin run check:roles` | role labels upstream consumers name ⊆ `roles.json` keys, and every `roles.json` key has ≥1 live consumer reference |
| `pnpm --dir scripts/pstack-devin test` (adapter/setup/apm-sync cases) | Devin adapter doc contract, setup.mjs behavior, `.apm` skill ⇄ overlay byte-sync |

## Level L3 — distribution shape

| Command | Proves |
| --- | --- |
| `pnpm --dir scripts/pstack-devin run verify:l3` (`tsx src/l3-dist.ts`) | `.devin-plugin/plugin.json` full schema (name/version/description/author/license/keywords/platforms); `devin-plugin/` layout incl. `docs/harness/devin.md`; `.apm/` and `devin-plugin/` trees never conflate; `apm pack --dry-run` emits the recorded manifest set; `apm compile --validate` yields the documented skill-only N/A |
| `pnpm --dir scripts/pstack-devin run probe:consumer` — **manual** | a scratch consumer installs the package (`path:` source offline; `--ref` git source needs network) — evidence appended to `docs/l3-verification.md` |

`verify:l3` needs `apm` resolvable via `mise exec --` for the pack/compile
probes. When `mise`/`apm` is absent the probes report `skipped` with a
notice instead of passing — install with `mise install`.

## Aggregate scripts

| Command | Composition |
| --- | --- |
| `pnpm --dir scripts/pstack-devin run verify:l1` | `check-generated` + `check:safety` (note: `check-generated` refetches the pinned upstream commit — deterministic but needs GitHub access; its ~546 sequential blob fetches can hit rate limits) |
| `pnpm --dir scripts/pstack-devin run verify:l2` | `audit:compat` + `check:links` + `check:roles` |
| `pnpm --dir scripts/pstack-devin run verify:l3` | `tsx src/l3-dist.ts` |
| `pnpm --dir scripts/pstack-devin run verify` | `verify:l1` + `verify:l2` + `verify:l3` + `pnpm test` |

## Deferred — issue `#218`

| What | Why deferred |
| --- | --- |
| Real Devin CLI session runs — invoking a `/pstack:<skill>`, spawning `pstack:<agent>` subagents, observing model-backed behavior | requires a paid Devin environment and model calls; **no static check proves agent runtime quality** — this boundary is explicit and non-negotiable |

## CI policy

Only deterministic commands belong in CI: `verify:l1`, `verify:l2`,
`verify:l3`, `pnpm test`, `lint:md`. `probe:consumer` is manual — it
spawns the real `apm`, writes a scratch consumer, appends evidence, and
its git form needs network. No paid-API or model-backed validation runs
in CI. Known consumer-side caveat: Windows `apm_modules` paths can
exceed `MAX_PATH` (`#212`); that limits the consumer probe on
long-path-disabled machines, not the deterministic checks.
