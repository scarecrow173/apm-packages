# japanese-tech-writing

An APM package for k16shikano's `japanese-tech-writing` Agent Skill, providing style and argumentation rules for Japanese technical writing and editing.

It covers paragraph structure, rigorous reasoning, reader cognitive load, narrative perspective, rhetorical restraint, AI-generated filler, literal translations, and redundancy. The package is standalone and does not depend on `doc-driven-dev`.

## Installation

Via the marketplace:

```bash
apm marketplace add scarecrow173/apm-packages
apm install japanese-tech-writing@apm-packages
```

Or reference the monorepo subdirectory in your project's `apm.yml`:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/japanese-tech-writing#main
```

Then run `apm install`. The skill is located at `.apm/skills/japanese-tech-writing/SKILL.md` in this package.

## Provenance and license

- Original author: [k16shikano](https://gist.github.com/k16shikano)
- Upstream source: [japanese-tech-writing / SKILL.md](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)
- Imported Gist revision: recorded in [`upstream.json`](./upstream.json)
- Upstream license: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)

## Automatic Gist synchronization

The [GitHub Actions workflow](../../.github/workflows/japanese-tech-writing-upstream.yml) checks the latest Gist commit daily at 03:17 UTC (and supports manual `workflow_dispatch`). When the Gist changes, it runs offline sync tests and APM validation, then commits the updated Skill and lockfile directly to `main` without requiring a PR. No commit is created if all files match.

Only the upstream `SKILL.md` is imported. Its body is preserved and the frontmatter `license` is normalized to `Unlicense`. `upstream.json` records the Gist commit. If the upstream name, license or frontmatter format changes unexpectedly, or validation fails, the workflow fails without publishing changes.

This intentionally trusts upstream-authored agent instructions for automatic publication. Consumers can fetch updates with `apm update japanese-tech-writing` (or `apm update`). A plain `apm install` may replay the pinned commit, and existing local installations are not overwritten immediately.

## Local sync tests

From the repository root:

```bash
python3 -m unittest discover -s scripts/japanese-tech-writing -p "test_*.py" -v
```

## Validation

From the package directory:

```bash
# Install the package in an isolated consumer and verify its deployed Skill.
mise exec -- apm install ./packages/japanese-tech-writing --target agent-skills
```

`apm compile` is for instructions, not skill-only packages. CI uses an isolated consumer, runs `apm install`, and checks the deployed `SKILL.md` matches the package source.
