# apm-package-judge

Modular semantic quality evaluation package for APM packages and Claude-plugin-like bundles.

The entrypoint skill is:

```text
.apm/skills/apm-semantic-package-judge/SKILL.md
```

This package deliberately does **not** run or require `apm audit --ci`. It evaluates semantic quality only: trigger quality, expert knowledge delta, component boundaries, safety disclosure, context efficiency, dependency/provenance graphs, and runtime usefulness.

## Architecture

```text
apm-semantic-package-judge
  -> apm-dependency-graph-reviewer
  -> component reviewer subagents
  -> apm-package-synthesizer
```

## Component judges

All component judges use 120-point rubrics covering activation contract, knowledge/value delta, anti-patterns, freedom calibration, progressive disclosure/context efficiency, output contracts, and usability. MCP and hooks weight capability disclosure and side effects more heavily.

## Calibration guide

`references/judge-calibration-guide.md` is read at the point of use: the entrypoint reads it before dispatch, component judges read it before individual scoring, and the synthesis judge reads it before assigning the final score.

## Source layout

APM source primitives live under `.apm/`:

```text
.apm/skills/<name>/SKILL.md
.apm/agents/*.agent.md
.apm/prompts/*.prompt.md
.apm/instructions/*.instructions.md
.apm/hooks/*.json
```

Japanese reference localizations are provided as `.ja.md` files. Runtime entrypoints remain the standard non-localized filenames unless your harness explicitly selects the localized files.
