# Skill Discovery Protocol — Operation Policy

Version: 1.0.0

This document defines the rules governing how SDP artifacts are created,
updated, and validated. Manual editing of generated artifacts is forbidden.

---

## 1. Script-Only Operation Rule

**All artifact operations MUST go through the `sdp` CLI.**

### 1.1 Forbidden Actions

- Hand-editing any JSON artifact (`*-catalog.json`, `*-profile.json`,
  `validation-report.json`, `resolved-invocations.json`)
- Hand-editing any derived Markdown artifact (`.md` sidecars generated
  by `sdp generate`)
- Modifying artifact content via external scripts that bypass `sdp`

### 1.2 Allowed Manual Edits

The following files are **configuration**, not generated output, and MAY
be edited manually:

- Adapter YAML files (`references/*.yaml`)
- `SKILL.md` / `SKILL.ja.md` (skill definition documents)
- `protocol-contract.md` and other reference documentation
- Source scripts (`src/skills/**/scripts/*.ts`)

### 1.3 Exception Conditions

Manual artifact editing is allowed ONLY when:

1. The `sdp` CLI is broken and cannot generate output (emergency recovery)
2. The edit is immediately followed by `sdp validate` to confirm conformance
3. A comment `# MANUAL_EDIT: <reason>` is added to the commit message

---

## 2. Script Responsibility Separation

The CLI is divided into three responsibility domains:

| Command | Responsibility | Verb |
| ------- | -------------- | ---- |
| `sdp generate` | Create and update artifacts | Write |
| `sdp validate` | Verify artifact correctness | Read + Check |
| `sdp query` | Extract information from artifacts | Read |

### 2.1 Generate Scripts

- Read adapter YAML (with `extends` resolution)
- Scan skill directories per `scan.scopes`
- Build Skill Reference Catalog
- Classify skills per adapter taxonomy
- Resolve invocations
- Build Flow Profile
- Render stable-sorted JSON + optional Markdown sidecars
- Exit `0` on success, `1` on input error, `2` on schema error

### 2.2 Validate Scripts

- Read generated artifacts (JSON)
- Execute 4 gates: schema → staleness → deterministic → blocking
- Produce `validation-report.json`
- Exit `0` if all gates pass, `1` if any gate fails, `2` on input error

### 2.3 Query Scripts

- Read Flow Profile JSON (never Markdown)
- Extract and present information via subcommands
- Pure read-only operation; never modifies files
- Exit `0` on success (empty result = empty array), `1` on input error,
  `2` on unknown subcommand

---

## 3. Build Pipeline

### 3.1 Source to Output Path

```text
src/skills/skill-discovery-protocol/scripts/*.ts
  → esbuild (bundled, ESM)
  → .apm/skills/skill-discovery-protocol/scripts/*.js
```

### 3.2 Build Command

```bash
pnpm run build:scripts
```

This invokes `tsx scripts/build-skill-scripts.ts` which uses esbuild to
compile all TypeScript sources under `src/skills/**/scripts/` into their
corresponding `.apm/skills/**/scripts/` output locations.

### 3.3 Invariants

- Output `.js` files are committed to the repository (they are the
  distributable form consumed by agents)
- Source `.ts` files are the single source of truth
- Any modification to `.ts` MUST be followed by `pnpm run build:scripts`
- The build MUST be deterministic (same source → same output bytes)

---

## 4. CLI Command Reference

### 4.1 `sdp generate`

```text
sdp generate --adapter <adapter-yaml>
```

Generates all artifacts defined in the adapter's `artifacts.protocol` section.

### 4.2 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: Full 4-gate validation of generated artifacts
- `--adapter`: Schema-only validation of adapter YAML configuration

### 4.3 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

Subcommands: `categories`, `category-skills`, `resolution`, `flow-stack`,
`execution-policy`, `capability-skills`, `skill-detail`, `runtime-guidance`,
`unresolved`, `validation-status`

---

## 5. Adapter YAML Schema

### 5.1 Required Keys

| Key | Type | Description |
| --- | ---- | ----------- |
| `schema_version` | string | Schema version (e.g., `"1.0"`) |
| `adapter_id` | string | Adapter identifier |
| `protocol` | object | Target protocol compatibility |
| `scan` | object | Active scope definitions |
| `profile` | object | Profile artifact output settings |
| `flow_stack` | object | Flow slot definitions |
| `classification` | object | Taxonomy and unmatched policy |
| `invocation_resolution` | object | Resolution settings |
| `validation` | object | Gate configuration |
| `render` | object | Deterministic output control |
| `artifacts` | object | Output paths |
| `readable_outputs` | object | Markdown sidecar control |

### 5.2 Recommended Keys

| Key | Type | Description |
| --- | ---- | ----------- |
| `extends` | string[] | Parent adapter reference names (no extensions) |
| `enabled` | boolean | Enable/disable toggle |
| `metadata` | object | Owner, description, last_validated_at |

### 5.3 `flow_stack.slots[]` Schema

Each slot entry has the following structure:

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `slot_id` | string | Yes | `snake_case` identifier |
| `slot_type` | enum | Yes | `"layerable"` or `"exclusive"` |
| `activation` | enum | Yes | `"always"`, `"conditional"`, `"on_demand"`, or `"gate"` |
| `default` | object | No | Default assignment (`skill` or `capability`) |

`default` sub-fields:

- `default.skill`: skill name (mutually exclusive with `default.capability`)
- `default.capability`: capability ID (mutually exclusive with `default.skill`)
- `default.reason`: explanation text (optional)

---

## 6. Invocation Resolution Rules

### 6.1 `resolved_invocations` Generation

The `resolved_invocations` array in Flow Profile is generated by:

1. Walking `flow_stack.slots[]` and resolving each slot's assignment
2. Walking `invocation_resolution.overrides.slots` for explicit overrides
3. Walking `invocation_resolution.overrides.capabilities` for capability routing
4. Applying `resolution_order` to determine precedence
5. Recording `unresolved` entries per policy (`fail` or `warn`)

### 6.2 Resolution Order

The `resolution_order` array defines precedence (first match wins):

1. `slot_override` — Explicit slot override in adapter
2. `capability_override` — Explicit capability override in adapter
3. `default_skill` — Default from `flow_stack.slots[].default`
4. `provider_lookup` — Skill that `provides` the required capability

### 6.3 Override Validation

| Condition | Setting Key | `fail` Behavior | `warn` Behavior |
| --------- | ----------- | --------------- | --------------- |
| Required unresolved | `unresolved.required` | Gate 4 fail | Warning only |
| Optional unresolved | `unresolved.optional` | — | Warning only |
| Unknown skill ref | `invalid_override.unknown_skill` | Gate 4 fail | Warning only |
| Capability mismatch | `invalid_override.capability_mismatch` | Gate 4 fail | Warning only |
| Override not allowed | `invalid_override.override_not_allowed` | Gate 4 fail | Warning only |

---

## 7. Naming Convention

### 7.1 `snake_case` Requirement

The following identifiers MUST use `snake_case`:

- `slot_id` in `flow_stack.slots[]`
- `capability` values in `provides[]` and `uses[]`
- Override keys in `invocation_resolution.overrides.slots`
- Override keys in `invocation_resolution.overrides.capabilities`
- `taxonomy[].id` in `classification`
- `taxonomy[].match.capabilities[]` values

### 7.2 Enforcement

Any identifier that does not match the pattern `^[a-z][a-z0-9]*(_[a-z0-9]+)*$`
is a **schema error** and causes Gate 1 (Schema Validation) to fail.

### 7.3 Rationale

- Consistency across all adapters and artifacts
- Machine-readable without ambiguity (no case-folding issues)
- Compatible with YAML keys and JSON field names

---

## 8. `extends` Resolution Rules

### 8.1 Reference Name Resolution

`extends` values are reference names, NOT file paths.

Resolution algorithm:

```text
for name in extends:
  candidates = [
    "references/{name}.yaml",
    "references/{name}.yml"
  ]
  if both exist → schema error
  if neither exists → schema error
  resolved = the one that exists
```

### 8.2 Merge Semantics

- Declaration order: `extends: [a, b]` → resolve `a` first, then `b`
- Merge direction: top-most parent → ... → direct parent → child adapter
- Object fields: recursive merge (child wins on conflict)
- Scalar fields: last writer wins
- Array fields: child replaces entirely (no append)

### 8.3 Constraints

- Direct path writing is FORBIDDEN (e.g., `extends: ["./my-adapter.yaml"]`)
- `priority` key is FORBIDDEN anywhere (schema error if present)
- Circular references are a schema error
- Nested extends are allowed (recursive resolution up to root)
- Schema validation runs on the FINAL merged result

---

## 9. `scan.scopes` Aggregation Rules

### 9.1 General Adapter Role

The `general-adapter.yaml` aggregates ALL known harness roots:

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
        - ".agents/skills"
        - ".github/skills"
        - ".github/agents"
        - ".cursor/rules"
        - ".claude/commands"
        - ".gemini/skills"
        - ".gemini/commands"
        - ".opencode/skills"
        - "apm_modules"
        - "."
```

### 9.2 Flow Override Pattern

Flow adapters extend `general-adapter` and override only what differs:

```yaml
extends:
  - "general-adapter"

scan:
  scopes:
    project:
      roots:
        - ".apm/skills"
        - ".agents/skills"
```

Since arrays replace entirely, the flow adapter's `roots` completely
overrides the general adapter's broader list.

### 9.3 Post-Merge Validation

After all `extends` merges complete:

- Every scope with `enabled: true` MUST have non-empty `roots`
- Violation → schema error

---

## 10. Classification Validation Rules

### 10.1 Taxonomy Validation

- `taxonomy` is the canonical key (NOT `vocab`, `categories`, etc.)
- Each entry MUST have: `id`, `label`, `description`, `match`
- `match` MUST have: `capabilities[]`, `tags[]`, `description_patterns[]`
- `id` values MUST be `snake_case`

### 10.2 Unmatched Policy Validation

- `unmatched` key is REQUIRED
- `action` and `severity` are REQUIRED

Invalid combinations (each is a schema error):

| Condition | Why Invalid |
| --------- | ----------- |
| `action=assign` without `category` | No target for assignment |
| `action=fail` with `severity=info` | Contradicts severity semantics |
| `action=ignore` with `severity=error` | Contradicts ignore semantics |
| `category` not in taxonomy | Dangling reference |

---

## 11. Execution Policy Contract

### 11.1 Skill Reference Catalog `execution_policy`

Each skill entry in the catalog MUST include an `execution_policy` object:

```json
{
  "execution_policy": {
    "requires_human_review": false,
    "max_parallel": 1,
    "timeout_seconds": null,
    "retry_on_failure": false,
    "idempotent": true
  }
}
```

### 11.2 Fields

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `requires_human_review` | boolean | `false` | Skill output needs human approval |
| `max_parallel` | number | `1` | Max concurrent executions |
| `timeout_seconds` | number or null | `null` | Execution timeout (null = no limit) |
| `retry_on_failure` | boolean | `false` | Auto-retry on transient failure |
| `idempotent` | boolean | `true` | Safe to re-execute with same input |

### 11.3 Query Access

```bash
sdp query --profile <json> execution-policy --skill <name>
```

Returns the `execution_policy` for the specified skill from the catalog.
