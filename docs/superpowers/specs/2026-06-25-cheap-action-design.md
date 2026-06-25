# Cheap Action Design

## Goal

Add `cheap-action` to `packages/token-compression` as a cross-harness advisory skill. The skill tells an agent to route simple, mechanically verifiable work to the lowest-cost model that the current harness makes available, while keeping complex, risky, or ambiguous work on the current reasoning model.

## Context

`token-compression` currently groups token-efficiency capabilities through external `genshijin` dependencies and one local instruction file. Adding `cheap-action` changes the package from dependency-first to a mixed package: external compression dependencies plus one local APM skill focused on model-cost discipline.

The package should remain portable across Codex, Claude, Cursor, Copilot, and generic agent-skills targets. The skill therefore cannot require a universal model-switching API. It must describe a decision contract:

- Use the cheapest selectable model when the harness exposes model selection or low-cost delegation.
- If model switching is not available, continue on the current model but keep the operation mechanical and concise.
- Do not switch down when the task needs planning, judgment, security reasoning, architecture decisions, broad code comprehension, or user clarification.

## Scope

In scope:

- Add local skill content at `packages/token-compression/.apm/skills/cheap-action/SKILL.md`.
- Add `includes: [.apm/]` to `packages/token-compression/apm.yml`.
- Update English and Japanese README/AGENTS docs so the package no longer claims it has no local skills.
- Validate that the package compiles and that docs mention the new skill consistently.

Out of scope:

- Implementing a harness-specific model switcher.
- Changing external `genshijin` dependencies.
- Adding runtime code, MCP servers, agents, or prompts.
- Reworking root marketplace package metadata unless validation reveals an existing omission blocks publishing.

## Skill Contract

`cheap-action` activates when the user's request can be completed by a bounded, mechanically checkable operation with little or no semantic reasoning. Examples include:

- Running a named command or script and reporting the result.
- Scoped rename of variables, functions, files, imports, or includes when matches are mechanically detectable.
- Simple import/include resolution by matching existing local patterns.
- Simple type annotations inferred from immediate usage.
- Comment updates derived from signatures or nearby behavior.
- Minor structured config edits in YAML, JSON, TOML, INI, or similar files.
- Git status, diff summaries, staging, committing, branch checks, and other routine Git operations.
- Grep-style search and file listing.
- Straight syntax-level fixes with clear parser or linter errors.
- File move/copy operations with mechanical import updates.

The skill must decline cheap-mode routing when any of these are true:

- The request needs architecture, product, security, legal, medical, or financial judgment.
- The requested operation can destroy data, leak secrets, publish externally, or modify permissions.
- The scope is broad enough that the agent must infer intent across many files.
- The agent cannot name a deterministic verification step before acting.
- The operation depends on ambiguous natural-language interpretation.
- A failed low-cost attempt would create confusing partial edits that are harder to review than direct execution.

## Decision Procedure

The skill should instruct the agent to run a short routing check:

1. Classify the request as cheap-eligible or not.
2. Name the bounded action and verification command.
3. If the harness exposes selectable models, choose the lowest-cost model that can still use required tools.
4. If no model-switching capability exists, perform the action in the current harness without pretending a switch happened.
5. Execute only the bounded action.
6. Verify mechanically and report the result.
7. Escalate back to the current/default reasoning model if verification fails or new ambiguity appears.

## User-Facing Behavior

The skill should be quiet. For routine actions, the agent should not over-explain routing. It may say a short line such as:

> Cheap action: running the existing script and reporting the result.

When no cheaper model is available, the agent should not apologize or invent a switch. It should simply keep the work bounded.

## Documentation Updates

English and Japanese package docs must stay synchronized in meaning and structure:

- `README.md` and `README.ja.md` should describe the package as a mixed token-efficiency package with external `genshijin` dependencies and local `cheap-action`.
- `AGENTS.md` and `AGENTS.ja.md` should add `cheap-action` to the agent overview and integration points.
- Japanese files must be read and verified with explicit UTF-8 decoding before reporting corruption or mojibake.

## Verification

Implementation should be verified with:

- `apm compile --validate` from `packages/token-compression` if supported by local tooling.
- Repository-level `apm compile --dry-run` if package-level validation is insufficient.
- `rg -n "cheap-action|dependency-first|local skills|独自のスキル|依存関係を優先" packages/token-compression` to verify stale claims are removed and new references exist.
- `git diff --check` to catch whitespace issues.

## Risks

- A skill that over-promises model switching will be misleading in harnesses without model-selection APIs. Mitigation: explicitly frame it as advisory and capability-dependent.
- A vague cheap-action definition could push hard work onto weak models. Mitigation: include clear non-eligible cases and require a deterministic verification step.
- Changing `token-compression` from dependency-first to mixed may surprise package users. Mitigation: document the package shape directly in README and AGENTS files.
