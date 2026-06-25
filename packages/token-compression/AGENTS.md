# Related Agents

## Agent Overview

The `token-compression` package pulls in the [genshijin](https://github.com/InterfaceX-co-jp/genshijin) suite and provides token compression plus multi-agent crew capabilities:

### genshijin

- **Purpose:** Core token compression engine
- **Use Cases:** Reducing prompt length while preserving intent

### genshijin-compress

- **Purpose:** Compression-focused skill for condensing context and instructions
- **Use Cases:** Shrinking large context windows, minimizing redundant tokens

### genshijin-crew

- **Purpose:** Multi-agent crew orchestration optimized for compressed workflows
- **Use Cases:** Running parallel agents with lean, compressed prompts

### genshijin-review

- **Purpose:** Reviews and audits compression quality
- **Use Cases:** Verifying compressed output retains semantic fidelity

### cheap-action

- **Purpose:** Advisory low-cost routing for simple, mechanically verifiable work
- **Use Cases:** Running named commands, grep-based search, scoped renames, routine Git operations, structured config edits, syntax-level fixes
- **Boundary:** Use only when the action has a deterministic verification step and does not need deep reasoning

## Integration Points

These skills can be combined with other packages in this repo:

- `agent-intelligence` — evaluating compression effectiveness
- `recommended-dev-suite` — incorporating compression into standard development workflows
- `basic-dev-foundation` — applying cheap routing to routine Git and repository operations

See [apm.yml](./apm.yml) for the definitive dependency and local asset list.
