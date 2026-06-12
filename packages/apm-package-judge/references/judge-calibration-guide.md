# Judge Calibration Guide

Use this guide to keep all component judges calibrated consistently: judge content by expert knowledge/value delta, trigger quality, anti-pattern specificity, progressive disclosure, freedom calibration, and practical usability.

## When to read this guide

- The entrypoint orchestrator reads it before dispatching reviewers.
- Component judges read it immediately before scoring an individual component.
- The dependency graph judge reads it before scoring graph findings.
- The package synthesis judge reads it before assigning the final package score.

## Universal calibration questions

Ask these for every component type:

1. Would this component activate at the right time?
2. Does it add knowledge or behavior the base model would not reliably apply?
3. Does it define boundaries and anti-patterns, not just happy-path instructions?
4. Is the freedom level appropriate for task fragility?
5. Is the expected output or return contract clear?
6. Does it avoid always-on, preload, or resource-loading token waste?
7. Does it compose safely with dependencies and sibling components?
8. Can a realistic eval task detect whether it works?

## Score normalization

Component judges score out of 120. Package synthesis scores out of 160. Always report both raw score and percentage.

## Trigger quality rule

Activation text is runtime behavior. A strong description contains:

- WHAT the component does
- WHEN it should be used
- KEYWORDS likely to appear in user requests or package files
- EXCLUSIONS for similar-but-wrong cases

## Component type bias

- Skills: weight expert knowledge and progressive disclosure.
- Agents: weight delegation trigger, tool boundary, and return contract.
- Prompts: weight invocation contract, input handling, and output contract.
- Instructions: weight scope precision and always-on context cost.
- MCP: weight tool descriptions, schemas, side effects, and trust boundary.
- Hooks/commands: weight deterministic trigger, idempotency, side effects, and failure behavior.
- Graph: weight provenance, collisions, hidden capabilities, and synthesis usefulness.
- Package: weight composition; never use a simple average.
