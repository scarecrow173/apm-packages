# recommended-dev-suite

`recommended-dev-suite` is a recommended APM aggregator for richer AI-assisted development workflows.

This package assumes the basic foundation is already available or intentionally handled elsewhere. It adds opinionated workflow skills for planning, refinement, debugging, review, TDD, source-grounded implementation, CI/CD, simplification, and context engineering.

## What It Covers

This package covers recommended workflow capabilities for teams that want agents to participate more actively in development.

Add dependencies here when they improve how agents clarify intent, plan work, implement changes, verify results, debug, simplify code, use subagents, or handle review loops. Keep broadly useful but low-opinion development utilities in `basic-dev-foundation`.

## Dependencies

The source of truth is [apm.yml](./apm.yml). Current dependencies:

- `obra/superpowers/skills/brainstorming`
- `obra/superpowers/skills/dispatching-parallel-agents`
- `obra/superpowers/skills/subagent-driven-development`
- `obra/superpowers/skills/requesting-code-review`
- `obra/superpowers/skills/receiving-code-review`
- `obra/superpowers/skills/systematic-debugging`
- `addyosmani/agent-skills/skills/idea-refine`
- `addyosmani/agent-skills/skills/interview-me`
- `addyosmani/agent-skills/skills/doubt-driven-development`
- `addyosmani/agent-skills/skills/test-driven-development`
- `addyosmani/agent-skills/skills/source-driven-development`
- `addyosmani/agent-skills/skills/incremental-implementation`
- `addyosmani/agent-skills/skills/ci-cd-and-automation`
- `addyosmani/agent-skills/skills/code-simplification`
- `addyosmani/agent-skills/skills/context-engineering`

## Maintenance

Keep this package focused on recommended workflow depth rather than baseline availability. Dependencies here may be more opinionated than `basic-dev-foundation`, but they should still be generally useful for development repositories.
