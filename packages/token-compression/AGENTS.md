# Related Agents

## Agent Overview

The `token-compression` package pulls in the [genshijin](https://github.com/InterfaceX-co-jp/genshijin) suite, which provides token compression and multi-agent crew capabilities:

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
- **Use Cases:** Verifying that compressed output retains semantic fidelity

## Integration Points

These skills can be combined with other packages in this repo:
- `agent-intelligence` — For evaluating compression effectiveness
- `recommended-dev-suite` — For incorporating compression into standard dev workflows

See [apm.yml](./apm.yml) for the definitive dependency list.
