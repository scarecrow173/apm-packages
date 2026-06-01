# Skill Discovery Protocol - Contract Specification

Version: 1.0.0

This document defines the formal contracts for the Skill Discovery Protocol.
All terms are flow-neutral; flow-specific vocabulary is defined exclusively in
adapter YAML files.

## 1. Canonical Steps Contract

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

| Step | Pre-condition | Post-condition |
| ---- | ------------- | -------------- |
| `load_adapter` | Valid adapter YAML path exists | Merged config with all `extends` resolved |
| `scan_skills` | Merged config has enabled scopes and roots | Raw skill list populated |
| `write_scan_list` | Raw skill list exists | `skill-scan-list.json` written with full `SKILL.md` bodies |
| `read_skill_reference_inferences` | Inference JSON exists | Valid inferred capability data loaded |
| `build_skill_reference_catalog` | Scan list and inferences available | Valid Skill Reference Catalog JSON |
| `classify_skills` | Catalog and taxonomy available | Each skill assigned or handled by `unmatched` policy |
| `resolve_invocations` | Classification complete and overrides loaded | Required invocations resolved or reported |
| `build_flow_profile` | Classification and resolution complete | Valid Flow Profile JSON |
| `render_outputs` | Profile and catalog generated | Stable-sorted JSON files and optional Markdown sidecars |
| `validate_outputs` | Artifacts rendered | Validation Report JSON with `overall_result` |

## 2. Scan Contract

The scanner finds directories containing `SKILL.md` across the enabled
`project`, `user`, `organization`, and `builtin` scopes.

The scanner MUST read the full `SKILL.md` body for every discovered skill.
It MUST NOT require non-standard metadata fields such as `provides`, `uses`,
`tags`, or `execution_policy`.

`skill-scan-list.json` contains:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Generation timestamp |
| `skills` | array | Raw scanned skills |

Each skill entry contains:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Skill identifier from standard metadata or directory |
| `description` | string | Standard description metadata or empty string |
| `body` | string | Full Markdown body from `SKILL.md` |
| `skill_path` | string | Absolute or resolved path to the skill directory |
| `scope` | string | Scan scope that discovered the skill |

## 3. Inference Contract

`skill-reference-inferences.json` is authored by an agent after reading
`skill-scan-list.json`. It contains inferred capability and policy data.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Optional inference timestamp |
| `inference_source` | string | `"agent"` |
| `skills` | array | Inferred skill entries |

Each inference entry contains:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Must match a scanned skill |
| `provides` | array | Capabilities offered |
| `uses` | array | Capabilities consumed |
| `execution_policy` | object | Execution constraints |
| `tags` | string[] | Classification hints |

Every scanned skill MUST have exactly one matching inference entry. Every
inference entry MUST match a scanned skill.

## 4. Skill Reference Catalog Contract

**File:** `skill-reference-catalog.json`

**Nature:** Flow-independent. It contains no flow-specific classification,
invocation slots, or resolved invocations.

Required top-level fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Generation timestamp |
| `validated_at` | ISO 8601 | Last validation timestamp |
| `skill_count` | number | Total skills discovered |
| `capability_count` | number | Total unique capabilities |
| `skills` | array | Skill entries |

Skill entry required fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Skill identifier |
| `description` | string | Skill summary from scan metadata |
| `provides` | array | Capabilities offered |
| `uses` | array | Capabilities consumed |
| `execution_policy` | object | Execution constraints |
| `tags` | string[] | Classification hints |

Constraints:

- `capability` identifiers MUST be `snake_case`
- `provides[].capability` values MUST be unique within a skill
- The catalog MUST NOT contain `slots`, `slot_count`, `resolved_invocations`, or flow-specific classification

## 5. Flow Profile Contract

**File:** `<flow-name>-profile.json`

**Nature:** Flow-specific. Named per the adapter's flow.

Required top-level fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Generation timestamp |
| `adapter_id` | string | Source adapter identifier |
| `flow_name` | string | Flow this profile serves |
| `classification` | object | Skills classified per adapter taxonomy |
| `flow_stack` | object | Slot assignments for this flow |
| `resolved_invocations` | array | Fully resolved skill routing |
| `runtime_guidance` | object | Execution-time hints |

Constraints:

- The profile MUST reference only skills that exist in the Skill Reference Catalog
- `resolved_invocations` MUST contain only skills present in the catalog
- `flow_stack.slots[]` is adapter-owned and stored only in the Flow Profile

## 6. Validation Report Contract

**File:** `validation-report.json`

The report records schema, staleness, deterministic, and blocking validation
results. `overall_result` is `"pass"` only when all required gates pass.

## 7. Derived Outputs

Markdown sidecars are derived outputs and MUST NOT be treated as canonical
sources. They may be regenerated on every `sdp profile` run.
