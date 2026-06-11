# SteER Enterprise Web Research APM Package

This is an APM package for a SteER / Enterprise Deep Research style web research workflow.

It packages:

- a model-invoked research skill
- reusable deep-research prompts
- explicit research agents
- always-on repository instructions
- research-state templates
- a lightweight structural audit script

The package is designed for Codex and GitHub Copilot, while keeping the source in APM's canonical `.apm/` package layout.

Paths in this document are repository-root-relative unless a command block says
otherwise.

## Install from a Git repository

After publishing this directory as a Git repository, install it from a consumer repository:

```bash
apm install <owner>/<repo>#v0.1.0
```

For local testing from this package directory:

```bash
apm install .
```

Validate and preview the package before release from `packages/steer-enterprise-web-research/`:

```bash
apm compile --validate
apm compile --dry-run
```

Create an offline bundle from `packages/steer-enterprise-web-research/`:

```bash
apm pack --archive -o dist
```

Consumers can then install the produced bundle with:

```bash
apm install ./dist/steer-enterprise-web-research-0.1.0.tar.gz
```

## Contents

```text
packages/steer-enterprise-web-research/
  .apm/
    instructions/
      steer-web-research.instructions.md
    skills/
      steer-web-research/
        SKILL.md
        SKILL.ja.md
    prompts/
      steer-deep-research.prompt.md
      steer-deep-research.prompt.ja.md
      steer-deep-research-ja.prompt.md
    agents/
      steer-enterprise-web-research.agent.md
      steer-enterprise-web-research.agent.ja.md
  docs/
  research/
scripts/steer-enterprise-web-research/
  src/
  tests/
  build/
```

## Usage

Ask your agent to use the SteER web research skill:

```text
Use the steer-web-research skill to research <topic>.
Run iterative search, maintain an evidence ledger, audit the findings, and produce a cited final report.
```

Or invoke the prompt:

```text
/steer-deep-research
```

Japanese users can use:

```text
/steer-deep-research-ja
```

## Audit Script Development

The source of the audit script now lives in:

- `scripts/steer-enterprise-web-research/src/research_audit.ts`

The generated build artifact is placed in:

- `packages/steer-enterprise-web-research/scripts/research_audit.js`

Run the build and test workflow from the repository root against the isolated scripts workspace:

```bash
pnpm --dir scripts/steer-enterprise-web-research test
pnpm --dir scripts/steer-enterprise-web-research build
```

## Notes

This package does not implement a search API. It instructs Codex, GitHub Copilot, or an MCP-enabled agent to use whatever search, fetch, GitHub, academic, file, or enterprise retrieval tools are available.

If no retrieval tool is available, the agent must not fabricate findings. It should produce a research plan only.

## Release checklist

1. Run `apm compile --validate`.
2. Run `apm compile --dry-run`.
3. Run `apm audit`.
4. Tag the repository, for example `v0.1.0`.
5. Install from a scratch repository using the tag.
6. Optionally run `apm pack --archive -o dist`.
