# Validation Report Specification

## Overview

The Validation Report records the quality state of artifacts as the output of
`sdp validate`. It structures the results of the 3-layer gates plus blocking
validations.

## File Formats

- Canonical: `validation-report.json`
- Derivative: `validation-report.md` (for human review)

## JSON Schema (Outline)

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-28T00:00:00Z",
  "repository": "doc-driven-dev",
  "adapter_id": "briefing-flow-default",
  "schema_validation": {
    "result": "pass",
    "errors": []
  },
  "staleness_validation": {
    "result": "pass",
    "basis": "validated_at",
    "basis_date": "2026-05-28T00:00:00Z",
    "max_age_days": 30,
    "age_days": 0,
    "new_skills": [],
    "removed_skills": []
  },
  "deterministic_validation": {
    "result": "pass",
    "comparisons": [
      {
        "target": "profile",
        "diff_found": false
      },
      {
        "target": "profile+catalog-artifacts",
        "diff_found": false
      },
      {
        "target": "validation-report:exclude-timestamp",
        "diff_found": false
      }
    ]
  },
  "blocking_validations": {
    "result": "pass",
    "checks": [
      {
        "type": "unresolved_required",
        "result": "pass",
        "details": []
      },
      {
        "type": "unknown_skill_override",
        "result": "pass",
        "details": []
      },
      {
        "type": "capability_mismatch_override",
        "result": "pass",
        "details": []
      }
    ]
  },
  "catalog_validation": {
    "skill_count": 10,
    "reference_count": 25,
    "capability_count": 15,
    "orphan_skills": []
  },
  "profile_validation": {
    "flow_count": 1,
    "flow_stack_slot_count": 5,
    "unresolved_slots": [],
    "resolved_invocation_count": 8,
    "unused_override_warnings": []
  },
  "overall_result": "pass"
}
```

## Field Definitions

### Top-level

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | Report schema version |
| `generated_at` | ISO 8601 | yes | Report generation timestamp |
| `repository` | string | yes | Target repository name |
| `adapter_id` | string | yes | ID of the adapter used |
| `schema_validation` | object | yes | Schema gate result |
| `staleness_validation` | object | yes | Staleness gate result |
| `deterministic_validation` | object | yes | Deterministic gate result |
| `blocking_validations` | object | yes | Blocking validation result |
| `catalog_validation` | object | yes | Catalog consistency validation result |
| `profile_validation` | object | yes | Profile validation result |
| `overall_result` | `"pass"` \| `"fail"` | yes | Overall result |

### `overall_result` Formula

```
overall_result = schema_validation.result == "pass"
             && staleness_validation.result == "pass"
             && deterministic_validation.result == "pass"
             && blocking_validations.result == "pass"
```

### `schema_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | Validation result |
| `errors` | array | Failed items (key name, expected type, actual value, etc.) |

### `staleness_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | Validation result |
| `basis` | string | Basis field name |
| `basis_date` | ISO 8601 | Basis timestamp |
| `max_age_days` | number | Allowed age in days |
| `age_days` | number | Elapsed days |
| `new_skills` | string[] | Skills added since last validation |
| `removed_skills` | string[] | Skills removed since last validation |

### `deterministic_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | Validation result |
| `comparisons` | array | Result per comparison target |
| `comparisons[].target` | string | Comparison target identifier |
| `comparisons[].diff_found` | boolean | Whether a diff was found |

### `blocking_validations`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | Validation result |
| `checks` | array | Individual check results |
| `checks[].type` | string | Check type |
| `checks[].result` | `"pass"` \| `"fail"` | Individual result |
| `checks[].details` | array | Detail information |

**Checks included in blocking:**

- `unresolved_required`: required-resolution failures configured as `fail` in
  the adapter
- `unknown_skill_override`: `unknown_skill` configured as `fail` in the adapter
- `capability_mismatch_override`: `capability_mismatch` configured as `fail` in
  the adapter
- `override_not_allowed`: `override_not_allowed` configured as `fail` in the
  adapter

### `catalog_validation`

| Field | Type | Description |
| --- | --- | --- |
| `skill_count` | number | Total skill count |
| `reference_count` | number | Total reference count |
| `capability_count` | number | Total capability count |
| `orphan_skills` | string[] | Skills not bound to any classification or resolution |

### `profile_validation`

| Field | Type | Description |
| --- | --- | --- |
| `flow_count` | number | Flow count |
| `flow_stack_slot_count` | number | Number of `flow_stack.slots[]` definitions in the Flow Profile |
| `unresolved_slots` | string[] | Slots with no resolution target in the Flow Profile |
| `resolved_invocation_count` | number | Resolved invocation count |
| `unused_override_warnings` | array | Warnings for unused overrides |

## Warnings vs. Failures

- **Unused slot/override**: warning only
  (`profile_validation.unused_override_warnings`)
- **`blocking_validations` fail**: makes `overall_result` fail
- Non-blocking problems are recorded as warnings and do not affect
  `overall_result`
