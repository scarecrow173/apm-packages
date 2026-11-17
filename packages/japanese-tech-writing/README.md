# japanese-tech-writing

An APM aggregator package that installs [k16shikano's Japanese Tech Writing Skill](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d) directly from the original Gist as a Git dependency. The Skill covers writing and editing Japanese technical documentation, articles, and manuscripts.

The upstream `SKILL.md` is not vendored into this repository. The package does not depend on `doc-driven-dev`.

## Installation

Via the marketplace:

```bash
apm marketplace add scarecrow173/apm-packages
apm install japanese-tech-writing@apm-packages
```

Or declare the monorepo package in your project's `apm.yml`:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/japanese-tech-writing#main
```

Then run `apm install`. APM deploys the Gist Skill into the target's native skills directory (with APM 0.33.0 and the `agent-skills` target, `.agents/skills/japanese-tech-writing/`).

## Upstream dependency and updates

The package's `apm.yml` declares the original Gist as a Git dependency:

```yaml
dependencies:
  apm:
    - git: https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d.git
      alias: japanese-tech-writing
```

APM pins a resolved Git commit in its lockfile. **A plain reinstall does not necessarily refresh the upstream commit.** To fetch current refs, run this in the consuming project:

```bash
apm update
```

Use `apm update --yes` in unattended automation. Projects requiring periodic upgrades can schedule that command in their own CI. This aggregator does not maintain a vendored copy or a custom Gist synchronization job.

## Provenance and licensing

- Upstream author: [k16shikano](https://gist.github.com/k16shikano)
- Canonical source: [Gist / japanese-tech-writing](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)
- Upstream Skill license: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)
- This aggregator's manifest license: MIT

The upstream Skill is fetched directly on installation. For current content and history, refer to the Gist.

