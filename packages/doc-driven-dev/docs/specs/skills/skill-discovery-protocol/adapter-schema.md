# Adapter YAML Schema Specification

## Overview

Adapter YAML is a configuration file supplied as input to `sdp scan` /
`sdp profile` that customizes protocol behavior per flow.

## Required Keys

| Key | Type | Description |
| --- | --- | --- |
| `schema_version` | string | Schema version (e.g., `"1.0"`) |
| `adapter_id` | string | Adapter identifier |
| `protocol` | object | Target protocol compatibility info |
| `scan` | object | Enabled scope definitions |
| `profile` | object | Profile artifact output settings |
| `flow_stack` | object | Slot definitions for the stack the flow uses |
| `classification` | object | Flow-specific classification taxonomy |
| `invocation_resolution` | object | Resolution settings |
| `validation` | object | Gate settings |
| `render` | object | Reproducible output control |
| `artifacts` | object | Artifact output destinations |
| `readable_outputs` | object | Markdown derivative output control |

## Recommended Keys

| Key | Type | Description |
| --- | --- | --- |
| `extends` | string[] | Reference names of parent adapters (no extension) |
| `enabled` | boolean | Enable/disable the adapter |
| `metadata` | object | owner / last_validated_at / description |

## `protocol`

```yaml
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
```

## `scan`

Four scope kinds: `project` / `user` / `organization` / `builtin`.

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
        - ".apm/skills/*/references"
    user:
      enabled: false
      roots:
        - "${COPILOT_USER_SKILLS}"
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []
```

**Rules:**

- A scope with `enabled: true` requires non-empty `roots` (validated after merge)
- Defaults: `project.enabled = true`, all others `false`
- `general-adapter` aggregates roots for all major harnesses; flow adapters
  override the deltas

## `flow_stack`

```yaml
flow_stack:
  slots:
    - slot_id: "adr_authoring"
      slot_type: "exclusive"
      activation: "on_demand"
      default:
        skill: "documentation-and-adrs"
        reason: "ADR authoring tasks need architecture-focused output"
```

**Rules:**

- `slots` is a required array
- Required fields per element: `slot_id`, `slot_type`, `activation`
- `slot_id`: fixed `snake_case`; carried verbatim into the Flow Profile's
  `flow_stack.slots[]`
- `slot_type`: `layerable` | `exclusive`
- `activation`: `always` | `conditional` | `on_demand` | `gate`
- `default`: optional. MVP allows only `default.skill`
- Specifying both `default.skill` and `default.capability` is forbidden
- When `default.skill` is set, validate that the skill exists and provides the
  corresponding slot/capability

## `classification`

```yaml
classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback category"
      match:
        capabilities: []
        tags: []
        description_patterns: []
```

**Rules:**

- `taxonomy` is the canonical form (`vocab` is not used)
- Each element requires `id`, `label`, `description`, `match`
- `match` requires `capabilities[]`, `tags[]`, `description_patterns[]`
- Values in `capabilities[]` are fixed `snake_case`
- `unmatched` is required and carries `action`, `severity`
- `action`: `assign` | `warn` | `fail` | `ignore`
- `severity`: `info` | `warn` | `error`
- `category`: required when `action = assign`; must match a taxonomy `id`

**Contradictory combinations (schema error):**

- `action = assign` with no `category`
- `action = fail` with `severity = info`
- `action = ignore` with `severity = error`
- `category` not present in the taxonomy

## `invocation_resolution`

```yaml
invocation_resolution:
  overrides:
    slots:
      adr_authoring:
        use: "documentation-and-adrs"
        reason: "..."
        fallback: null
    capabilities:
      code_review:
        prefer: "code-review-and-quality"
        fallback: null
        reason: "..."
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"
```

**Rules:**

- `overrides.slots` keys are `snake_case` and must match the adapter's
  `flow_stack.slots[].slot_id`
- `overrides.capabilities` keys are `snake_case` capability identifiers
- `resolution_order`: defines priority with no duplicates
- `unresolved.required`: `fail` | `warn`
- `unresolved.optional`: `warn` | `ignore`
- `invalid_override.*`: `fail` | `warn`

## `validation`

```yaml
validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
  invocation:
    enabled: true
```

**`validation.schema` rules:**

- `true` (default) — run the baseline schema gate over the adapter,
  catalog, and profile
- `false` — skip the schema gate; `validation-report` records
  `schema_validation.result = "skipped"` with no errors
- A skipped schema gate never counts as freshness evidence: the
  `validated_at` re-stamp requires an actual schema pass, so with
  `schema: false` age-stale artifacts are not repaired in-band

**`validation.deterministic.compare` rules:**

- Entries select which regenerated artifacts are compared:
  `"profile"` → Flow Profile, `"catalog"` → Skill Reference Catalog,
  `"profile+catalog-artifacts"` → both
- `"validation-report:exclude-timestamp"` is documentational — the gate
  regenerates artifacts, never a validation report, so the entry selects
  nothing; it records that timestamp fields are stripped from every
  comparison
- A `compare` list selecting no artifacts leaves the gate with no
  targets and it reports `result: "skipped"`

**`validation.invocation` rules:**

- `enabled: true` — run the invocation gate (blocking_validations)
- `enabled: false` — disable the invocation gate entirely (used during early
  development or experimental configuration)
- Even when disabled, `validation-report` records `invocation.enabled = false`

## `render`

```yaml
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"
```

## `artifacts`

```yaml
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "briefing-profile.json"
    validation_report: "validation-report.json"
    resolved_invocations: "resolved-invocations.json"  # optional
```

**Output base directories:**

- Shared protocol artifacts (`skill_reference_catalog`, scan, inference) are
  placed directly under `.sdp/`.
- Flow-specific artifacts (`flow_profile`, `validation_report`) are placed in
  `.sdp/<adapter_id>/`.
- `artifacts.protocol.flow_profile` and `artifacts.protocol.validation_report`
  are resolved as filenames relative to the adapter directory.

## `readable_outputs`

```yaml
readable_outputs:
  enabled: true
  include:
    - "skill_reference_catalog"
    - "flow_profile"
    - "validation_report"
```

**Rules:**

- `enabled: true` → auto-generate `.md` for artifacts in `include`
- `enabled: false` → generate no Markdown at all
- A key in `include` that does not exist in `artifacts.protocol` is a schema
  error
- `sdp query` always takes JSON as input and never treats Markdown as canonical
  input

## `extends` Resolution Rules

- No path strings (reference names only)
- Resolution target: `skill-discovery-protocol/references/{name}.yaml` or
  `.yml`
- Both exist → schema error
- Parent adapters merge in declaration order; the child adapter applies last
- Recursive resolution allowed (parents may have their own `extends`)
- Circular references → schema error
- Merge rules:
  - Objects: recursive merge (last wins)
  - Scalars: last-wins override
  - Arrays: replaced by the child side
- The `priority` key is forbidden (presence → schema error)
- Schema validation runs on the final result after all `extends` merges

## Minimal Example

```yaml
schema_version: "1.0"
adapter_id: "briefing-flow-default"

protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"

scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"

profile:
  title: "Briefing Flow Profile"

flow_stack:
  slots:
    - slot_id: "adr_authoring"
      slot_type: "exclusive"
      activation: "on_demand"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []

invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"

validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"

render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill"]
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "flow-profile.json"
    validation_report: "validation-report.json"

readable_outputs:
  enabled: false
  include: []

extends:
  - "general-adapter"
enabled: true
```
