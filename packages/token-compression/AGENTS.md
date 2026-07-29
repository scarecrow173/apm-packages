# Related Agents

## Agent Overview

The `token-compression` package provides the local `cheap-action` advisory skill for simple, mechanically verifiable work.

### cheap-action

- **Purpose:** Advisory low-cost routing for simple, mechanically verifiable work
- **Use Cases:** Running named commands, grep-based search, scoped renames, routine Git operations, structured config edits, syntax-level fixes
- **Boundary:** Use only when the action has a deterministic verification step and does not need deep reasoning

## Integration Points

This skill can be combined with other packages in this repo:

- `agent-intelligence` — evaluating compression effectiveness
- `recommended-dev-suite` — incorporating bounded work into standard development workflows
- `basic-dev-foundation` — applying cheap routing to routine Git and repository operations

See [apm.yml](./apm.yml) for the definitive local asset list.
