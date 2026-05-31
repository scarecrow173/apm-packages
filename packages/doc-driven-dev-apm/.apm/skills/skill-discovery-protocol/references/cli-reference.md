# Skill Discovery Protocol — CLI Reference

Version: 1.0.0

This document describes the CLI commands for the Skill Discovery Protocol.

For adapter YAML schema, invocation resolution, and validation rules,
see `schema-reference.md`.
For operational rules and constraints, see `operation-policy.md`.

---

## 1. CLI Command Reference

### 1.1 `sdp generate`

```text
sdp generate --adapter <adapter-yaml>
```

Generates all artifacts defined in the adapter's `artifacts.protocol` section.

### 1.2 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: Full 4-gate validation of generated artifacts
- `--adapter`: Schema-only validation of adapter YAML configuration

### 1.3 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

Subcommands: `categories`, `category-skills`, `resolution`, `flow-stack`,
`execution-policy`, `capability-skills`, `skill-detail`, `runtime-guidance`,
`unresolved`, `validation-status`

