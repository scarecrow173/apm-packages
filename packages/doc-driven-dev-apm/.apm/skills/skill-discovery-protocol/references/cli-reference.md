# Skill Discovery Protocol — CLI Reference

Version: 1.0.0

This document describes the CLI commands for the Skill Discovery Protocol.

For adapter YAML schema, invocation resolution, and validation rules,
see `schema-reference.md`.
For operational rules and constraints, see `operation-policy.md`.

---

## 1. CLI Command Reference

### 1.1 `sdp scan`

```text
sdp scan --adapter <adapter-yaml> [--cwd <dir>]
```

Scans skill sources declared by adapter `scan.scopes` and writes `.sdp/skill-scan-list.json`.

### 1.2 `sdp infer`

```text
sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]
sdp infer apply --ops <jsonl> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer check --in <json> [--cwd <dir>]
sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
```

Initializes and edits `skill-reference-inferences.json`.

### 1.3 `sdp profile`

```text
sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
```

Loads existing scan + inference artifacts and generates:

- shared catalog: `.sdp/skill-reference-catalog.json`
- flow profile: `.sdp/<adapter_id>/<flow_profile>`

`sdp profile` does not run scan/infer. Run `sdp scan` then `sdp infer init` first.

### 1.4 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: Full 4-gate validation of generated artifacts
- `--adapter`: Schema-only validation of adapter YAML configuration

### 1.5 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

Subcommands: `categories`, `category-skills`, `resolution`, `flow-stack`,
`execution-policy`, `capability-skills`, `skill-detail`, `runtime-guidance`,
`unresolved`, `validation-status`

