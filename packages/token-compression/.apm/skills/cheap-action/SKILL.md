---
name: cheap-action
description: Use when a request is a simple, mechanical, verifiable action such as running a command, grep search, scoped rename, trivial config edit, syntax fix, file move, or routine Git operation; route it to the lowest-cost capable model or delegation path when the harness supports that.
---

# Cheap Action

Use this skill only for bounded work that needs little reasoning and has an obvious mechanical verification step.

## Cheap-Eligible

- Run a named command or script and report the result.
- Do grep-style search, file listing, diff summary, or routine Git status/stage/commit checks.
- Make a scoped mechanical edit: rename, import/include fix, simple type annotation, comment update, structured config edit, syntax-level fix, or file move with import updates.

## Do Not Use

Stay on the current reasoning model for planning, design, code review, debugging, architecture, security, policy judgment, destructive actions, broad code comprehension, ambiguous intent, publishing, deployment, permission changes, or secret handling.

## Protocol

1. Name the bounded action and verification step.
2. If the harness offers a lower-cost model or delegation path that can use the required tools, use it.
3. If not, continue on the current model without claiming a switch happened.
4. Execute only the bounded action.
5. Verify mechanically.
6. Escalate back to the current/default reasoning model if scope expands, verification fails, or ambiguity appears.

## Output

Report the action, verification result, relevant output or file paths, and any reason cheap routing was not used.
