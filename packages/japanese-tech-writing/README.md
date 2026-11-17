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
- Imported Gist revision: `8f2d57610a73efc97d743c9b0b0ecb1002e09fa4`
- Upstream license: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)

The upstream skill is bundled for offline use after installation. The source rules are retained, while frontmatter and Markdown formatting are adapted for APM. Updates to the Gist are not automatically synchronized; verify a revision and review its diff before updating this copy.

## Validation

From the package directory:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```
