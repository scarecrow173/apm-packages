# Skill Discovery Protocol - Contract Specification

Version: 1.0.0

This document defines the formal contracts for the Skill Discovery Protocol.
All terms are flow-neutral; flow-specific vocabulary is defined exclusively in
adapter YAML files.

## 1. Public Command Contract

The public workflow is:

```text
sdp scan -> agent inference -> sdp infer -> sdp profile -> sdp validate -> sdp query
```

The internal canonical steps below are implementation steps, not a license for
`sdp profile` to run scan or inference implicitly.

## 2. Canonical Steps Contract

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

## 3. Scan Contract

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

## 4. Inference Contract

`skill-reference-inferences.json` is agent-authored data derived from
`skill-scan-list.json`. Agents decide `provides`, `uses`, `execution_policy`,
and `tags` by reading scanned `SKILL.md` bodies, then persist those decisions
through `sdp infer` subcommands.

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
| `review_status` | string | `pending` or `reviewed` |
| `provides` | array | Capabilities offered |
| `uses` | array | Capabilities consumed |
| `execution_policy` | object | Execution constraints |
| `tags` | string[] | Classification hints |

Every scanned skill MUST have exactly one matching inference entry. Every
inference entry MUST match a scanned skill. `sdp infer check` MUST fail if any
scanned skill remains `pending`, and `sdp profile` MUST refuse to generate
catalog/profile artifacts from incomplete inference data.

## 5. Skill Reference Catalog Contract

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

## 6. Flow Profile Contract

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

## 7. Validation Report Contract

**File:** `validation-report.json`

The report records schema, staleness, deterministic, and blocking validation
results. `overall_result` is `"pass"` only when all required gates pass.

## 8. Derived Outputs

Markdown sidecars are derived outputs and MUST NOT be treated as canonical
sources. They may be regenerated on every `sdp profile` run.
