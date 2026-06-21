# apm-packages

This repository is a marketplace index that organizes multiple APM packages for skills, agents, prompts, and instructions.

It also publishes two aggregator packages:

- `basic-dev-foundation`: a foundational bundle of core APM and workflow helpers
- `recommended-dev-suite`: a broader bundle that adds the repo's higher-level workflow packages

## Environment Activation (Required Before Work)

The `mise` shims are excluded from PATH to prevent infinite loops with `uv`.
**You must run `mise activate` at the start of each session** before working.

| Platform | Command |
|---|---|
| Windows (PowerShell) | `mise activate pwsh \| Out-String \| Invoke-Expression` |
| macOS / Linux (bash) | `eval "$(mise activate bash)"` |
| macOS / Linux (zsh) | `eval "$(mise activate zsh)"` |

Without activation, version management for `uv`, `python`, `node`, and other tools will not work.
Commands may not be found, or incorrect versions will be executed.

## Installation

Consumers can install this entire package collection by adding it to their `apm.yml`:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages#v0.1.0
```

Or from local development:

```bash
pnpm clean
apm install .
```

`pnpm clean` is recommended before local `apm install` to remove transient
`node_modules` trees that may contain hidden Unicode fixtures in third-party
test files.

## Repository structure

This is a **monorepo-hybrid** layout:

- Root `apm.yml` defines the marketplace index and lists all local packages.
- Each package under `packages/` has its own `apm.yml` and distributed `.apm/` assets.
- Build workspaces, TypeScript sources, and tests may live under `scripts/<package-name>/`.

```text
apm.yml                                  # marketplace index
packages/
  basic-dev-foundation/
    apm.yml                              # package manifest
    .apm/
      instructions/
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
  recommended-dev-suite/
    apm.yml                              # package manifest
    .apm/
      instructions/
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
  doc-driven-dev/
    apm.yml                              # package manifest
    .apm/
      skills/
    README.md
    README.ja.md
  steer-enterprise-web-research/
    apm.yml                              # package manifest
    .apm/
      agents/
      skills/
      prompts/
      instructions/
    README.md
    README.ja.md
    docs/
    examples/
    research/
scripts/
  doc-driven-dev/                        # build workspace, TS sources, tests
  steer-enterprise-web-research/         # build workspace, TS sources, tests

For path references in this repository, prefer repo-root-relative paths such as
`packages/doc-driven-dev/.apm/...` and `scripts/doc-driven-dev/...` so the
manifest/distribution tree and the build/test tree stay distinct.
```

## Adding more packages

1. Create a new directory under `packages/` with the package name.
2. Add an `apm.yml` manifest and `.apm/` structure inside.
3. Update the root `apm.yml` marketplace block to include the new package entry.
4. Tag and release via CI/CD (see [Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/)).
