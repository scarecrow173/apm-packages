---
name: apm-hook-command-component-judge
description: Evaluate hook, command, and script components for stated purpose, trigger timing, side effects, user authorization, filesystem/network/secret access, observability, rollback behavior, and semantic fit in the package. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM Hook/Command Component Judge

Evaluate hooks, commands, and scripts as operational behavior.

## Scope

Review:

- hooks
- slash commands that execute or imply execution
- scripts referenced by package docs or manifests
- shell snippets embedded in prompts/instructions
- generated command wrappers

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| H1 Trigger Clarity | 15 | When it runs is explicit. |
| H2 Purpose/Behavior Match | 15 | Actual behavior matches stated purpose. |
| H3 Side-Effect Disclosure | 15 | Writes, deletes, network calls, git changes, installs are disclosed. |
| H4 Authorization Boundary | 15 | Destructive or external actions require clear user intent. |
| H5 Minimality | 10 | Does only what the package needs. |
| H6 Observability | 10 | Logs or reports enough for users to understand outcomes. |
| H7 Failure/Rollback | 10 | Failure behavior is safe and recoverable. |
| H8 Package Fit | 10 | Belongs in this package and does not surprise users. |

## Findings to detect

- hidden mutation
- network call without disclosure
- secret reads
- install-time side effects
- git state changes
- missing dry-run or confirmation
- broad command wrappers
- mismatch between docs and behavior

## Output

Use the standard component report format with Type `hook-command`.
