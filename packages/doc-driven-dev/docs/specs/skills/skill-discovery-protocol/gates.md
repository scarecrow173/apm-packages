# Gates Specification

## Overview

Skill Discovery Protocol guarantees artifact quality through a 3-layer +
blocking validation gate design.

```
overall_result = schema && staleness && deterministic && blocking_validations
```

## Gate 1: Schema Validation

Validates the structural correctness of artifacts.

### Targets

- Required keys and types of the Flow Profile JSON
- Required keys and types of the Skill Reference Catalog JSON
- Required keys and constraints of the Adapter YAML

### Checks

| Check | Condition |
| --- | --- |
| Required keys present | All required fields exist |
| Type match | Each field has the expected type |
| Enum values | `slot_type`, `activation`, etc. within allowed values |
| `snake_case` enforced | slot_id, capability identifiers, override keys |
| `classification` consistent | unmatched.category exists in the taxonomy |
| `extends` forbidden keys | No `priority` key present |
| `scan.scopes` consistent | Scopes with `enabled=true` have non-empty `roots` (post-merge) |
| `readable_outputs` consistent | `include` keys exist in `artifacts.protocol` |

### On Failure

- `schema_validation.result = "fail"`
- Details recorded in `schema_validation.errors[]`
- Exit code: non-zero

---

## Gate 2: Staleness Validation

Validates artifact freshness.

### Criteria

- Basis date: `validated_at`
- Allowed age: adapter `validation.staleness.max_age_days` (default: 30)

### Checks

| Check | Condition |
| --- | --- |
| Elapsed days | `now - validated_at <= max_age_days` |
| Skills added | No new skills added since last validation |
| Skills removed | No skills removed since last validation |

### On Failure

- `staleness_validation.result = "fail"`
- Diffs recorded in `new_skills[]` / `removed_skills[]`
- Exit code: non-zero

---

## Gate 3: Deterministic Validation

Validates that re-running with the same input produces identical output.

### Comparison Targets

Specified by the adapter's `validation.deterministic.compare`:

| Target | Description |
| --- | --- |
| `profile` | Full comparison of the Flow Profile JSON |
| `profile+catalog-artifacts` | Comparison of Flow Profile + Skill Reference Catalog |
| `validation-report:exclude-timestamp` | validation-report comparison excluding timestamps |

### Procedure

1. Stash the current artifacts
2. Re-run `sdp profile`
3. Compare stashed artifacts with newly generated ones
4. Any diff → fail

### Stability Mechanisms

- Stable sort (defined by `render.stable_sort`)
- Normalization (`render.normalize_whitespace`, `render.newline`)
- Deterministic rendering (same input → same byte sequence)

### On Failure

- `deterministic_validation.result = "fail"`
- Records targets where `comparisons[].diff_found = true`
- Exit code: non-zero

---

## Gate 4: Blocking Validations

Runs the invocation validations configured as `fail` in the adapter.

### Checks Included in Blocking

| Source Setting | Check Type |
| --- | --- |
| `invocation_resolution.unresolved.required = "fail"` | Unresolved required capability |
| `invocation_resolution.invalid_override.unknown_skill = "fail"` | Override to a non-existent skill |
| `invocation_resolution.invalid_override.capability_mismatch = "fail"` | Override with a capability mismatch |
| `invocation_resolution.invalid_override.override_not_allowed = "fail"` | Disallowed override |

### Non-blocking (Warning Only)

| Setting Value | Behavior |
| --- | --- |
| `unresolved.required = "warn"` | Recorded as warning; does not affect overall |
| `unresolved.optional = "warn"` | Recorded as warning; does not affect overall |
| `invalid_override.* = "warn"` | Recorded as warning; does not affect overall |
| Unused slot/override | Always warning only |

### On Failure

- `blocking_validations.result = "fail"`
- Details recorded for each `checks[].result = "fail"`
- Exit code: non-zero

---

## Exit Code Conventions

| Code | Meaning |
| --- | --- |
| `0` | All gates pass |
| `1` | One or more gates fail |
| `2` | Input error (file not found, etc.) |

## Gate Execution Order

1. Schema → 2. Staleness → 3. Deterministic → 4. Blocking

Even when Schema fails, the other gates still run so all problems are reported
at once.
