# apm-packages

This repository is a marketplace index that organizes multiple APM packages for skills, agents, prompts, and instructions.

Consumers can install this entire package collection by adding it to their `apm.yml`:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages#v0.1.0
```

Or from local development:

```bash
apm install ./apm-packages
```

## Repository structure

This is a **monorepo-hybrid** layout:

- Root `apm.yml` defines the marketplace index and lists all local packages.
- Each package under `packages/` has its own `apm.yml` and is self-contained.

```text
apm.yml                                  # marketplace index
packages/
  steer-enterprise-web-research-apm/
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
```

## Adding more packages

1. Create a new directory under `packages/` with the package name.
2. Add an `apm.yml` manifest and `.apm/` structure inside.
3. Update the root `apm.yml` marketplace block to include the new package entry.
4. Tag and release via CI/CD (see [Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/)).
