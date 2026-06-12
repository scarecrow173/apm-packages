---
name: apm-mcp-component-judge
description: Evaluate MCP server, tool, resource, and prompt declarations for natural-language tool description quality, trust boundaries, capability disclosure, argument clarity, error semantics, and production-safety assumptions. Use as a specialist reviewer inside modular APM package evaluation.
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
---

# APM MCP Component Judge

Evaluate MCP-related components semantically.

## Scope

Review:

- MCP server declarations
- MCP tool descriptions
- MCP resource descriptions
- MCP prompt descriptions
- package documentation describing MCP capability
- agent-scoped MCP declarations

## Rubric: 100 points

| Dimension | Max | Meaning |
|---|---:|---|
| M1 Capability Disclosure | 15 | Clearly states what the MCP component can do. |
| M2 Tool Description Quality | 15 | Purpose, arguments, constraints, and side effects are clear. |
| M3 Trust Boundary | 15 | User/data/service trust assumptions are explicit. |
| M4 Least Capability | 10 | Exposes minimal necessary operations. |
| M5 Error & Failure Semantics | 10 | Failures are understandable and recoverable. |
| M6 Safety Against Misuse | 15 | Reduces prompt-injection, exfiltration, and unintended write risks. |
| M7 Operational Readiness | 10 | Authentication, env vars, latency, and availability are documented. |
| M8 Context Efficiency | 10 | Tool descriptions are useful without being bloated. |

## Findings to detect

- vague tool descriptions
- unclear side effects
- missing argument constraints
- write operations not disclosed
- secret/env var ambiguity
- unsafe broad access
- no error semantics
- tool names that mislead the model
- transitive capability surprise

## Output

Use the standard component report format with Type `MCP`.
