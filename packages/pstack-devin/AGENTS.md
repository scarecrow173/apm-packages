# AGENTS.md

Guide for agents maintaining `packages/pstack-devin`.

## Package role

`pstack-devin` distributes the upstream `cursor/plugins`
`harness/pstack/claude-code` tree to Devin CLI without forking it. Treat
[apm.yml](./apm.yml) and [upstream.yml](./upstream.yml) as the contract
surface; `docs/` holds maintainer-facing evidence, not user docs.

## Artifact boundary

- `.apm/` primitives (added by later issues) serve APM consumers.
- `devin-plugin/` is a generated, git-tracked Devin plugin produced by
  `scripts/pstack-devin`. Never edit it by hand; regenerate via the build.
- `targets:` in `apm.yml` covers APM runtimes only. It must keep `copilot`
  listed: the provenance `devDependencies` entry is an `agent_plugin`
  package that resolves only when `copilot` is an active target. Listing
  `copilot` does not imply Copilot workflow support beyond that pin, and it
  never implies Devin support.

## Upstream pin rules

- `upstream.yml.upstream.commit` is the single authority for the upstream
  snapshot. The `devDependencies.apm[0].ref` in `apm.yml` and
  `apm.lock.yaml`'s `resolved_commit` must equal it at all times.
- Regenerate `apm.lock.yaml` only by running `apm install` inside this
  directory. Never hand-edit it.
- `apm_modules/`, `.github/`, `.claude-plugin/`, and `build/` are local
  install/pack side-effects and stay gitignored.
- Upstream files are byte-identical except the overwrite allowlist
  (currently only `skills/setup-pstack/SKILL.md`; see
  `docs/upstream-source-decision.md`).

## Editing rules

- Keep `README.md`/`README.ja.md` and `AGENTS.md`/`AGENTS.ja.md`
  synchronized in structure and meaning.
- Do not add the upstream tree to `dependencies:`; consumers would inherit
  a copilot-only `agent_plugin` resolution and fail on other targets.
- Do not edit the root `apm.yml`, `apm.lock.yaml`, or marketplace block;
  registration is handled in the marketplace issue (`#217`).
- `docs/` files are maintainer-facing and may stay English-only; README and
  AGENTS must remain bilingual.
- `apm install` may append `apm_modules/` to this directory's `.gitignore`;
  that line is expected.

## Validation

From this directory:

```bash
mise exec -- apm install --frozen   # lockfile/manifest must be in sync
mise exec -- apm compile --dry-run  # consumer-context preview only
```

`apm compile --validate` requires installed or local APM primitives. While
this package ships no `.apm/` primitives, report validation as not
applicable instead of treating it as a package bug.

From the repository root:

```bash
mise exec -- pnpm --dir scripts/pstack-devin test
mise exec -- pnpm --dir scripts/pstack-devin run lint:md
```
