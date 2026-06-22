# Skill Discovery Protocol — CLI Reference

Version: 1.0.0

This document describes the CLI commands for the Skill Discovery Protocol.

For adapter YAML schema, invocation resolution, and validation rules,
see `schema-reference.md`.
For operational rules and constraints, see `operation-policy.md`.

---

## Operator Recipe

> **Note:** `sdp` is not a globally installed binary. Invoke it via your runtime manager:
>
> ```powershell
> # Example: mise (recommended)
> mise exec -- node <skill-root>/skill-discovery-protocol/scripts/sdp.js <subcommand>
> ```
>
> Where `<skill-root>` is the directory containing your installed skills (e.g., `.agents/skills/`, `.apm/skills/`, or `.claude/skills/`).
> In examples below, `sdp` is used as shorthand for the full invocation above.

```text
sdp scan --adapter <adapter-yaml>
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --scan .sdp/skill-scan-list.json --in .sdp/skill-reference-inferences.json
sdp profile --adapter <adapter-yaml>
sdp validate --profile .sdp/<adapter_id>/<flow-profile-json> --adapter <adapter-yaml>
```

`sdp profile` consumes existing scan and inference artifacts. It does not
decide capabilities by itself.

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
sdp infer check [--scan <json>] --in <json> [--cwd <dir>]
sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
```

Initializes, edits, and validates `skill-reference-inferences.json`. Agents
use this command family after reading scan output to record inferred
`review_status`, `provides`, `uses`, `execution_policy`, and `tags`.

### 1.3 `sdp profile`

```text
sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
```

Loads existing scan + inference artifacts and generates:

- shared catalog: `.sdp/skill-reference-catalog.json`
- flow profile: `.sdp/<adapter_id>/<flow_profile>`

`sdp profile` does not run scan/infer. Run `sdp scan`, complete inference
review, then `sdp infer check` before profiling.

### 1.4 `sdp validate`

```text
sdp validate --profile <flow-profile-json> --adapter <adapter-yaml>
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile --adapter` (both): Full 4-gate validation (Schema, Staleness, Deterministic, Blocking)
- `--profile` only: Schema and Staleness gates run; Deterministic and Blocking gates are **skipped**
- `--adapter` only: Schema-only validation of adapter YAML configuration

### 1.5 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

Subcommands: `categories`, `category-skills`, `resolution`, `flow-stack`,
`execution-policy`, `capability-skills`, `skill-detail`, `runtime-guidance`,
`unresolved`, `validation-status`

---

## Windows PowerShell Notes

When generating JSON for `sdp infer set-skill` from PowerShell, two pitfalls apply.

### BOM-encoded UTF-8

PowerShell `Out-File -Encoding utf8` writes UTF-8 with BOM. Node.js `JSON.parse` cannot read BOM-prefixed JSON and throws:

```
Unexpected token '﻿', "﻿{..." is not valid JSON
```

Use `System.Text.UTF8Encoding($false)` to write without BOM:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
```

### Single-element array serialized as object

`ConvertTo-Json` flattens a single-element array to a bare object:

```powershell
# Produces: {"capability":"problem_framing"}  ← NOT an array
@(@{capability="problem_framing"}) | ConvertTo-Json
```

Build the JSON as a literal string instead:

```powershell
$prov = '[{"capability":"problem_framing"}]'
$json = "{`"review_status`":`"reviewed`",`"provides`":$prov,...}"
```
