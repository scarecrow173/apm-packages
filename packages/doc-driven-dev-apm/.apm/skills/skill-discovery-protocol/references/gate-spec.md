# Skill Discovery Protocol — Gate Specification

Version: 1.0.0

This document defines the 4 validation gates, exit code conventions,
and error message format for the Skill Discovery Protocol.

---

## 1. Gate Overview

Validation comprises 4 gates executed in sequence:

| Gate | ID | Purpose |
| ---- | -- | ------- |
| 1 | `schema` | Structural correctness of artifacts and adapter |
| 2 | `staleness` | Artifact freshness based on `validated_at` |
| 3 | `deterministic` | Re-execution produces identical output |
| 4 | `blocking` | Critical invocation resolution checks |

### Overall Result Formula

```text
overall_result = schema ∧ staleness ∧ deterministic ∧ blocking
```

All gates are executed regardless of earlier failures; the full set of
issues is reported in a single pass.

---

## 2. Exit Code Conventions

| Code | Meaning | When |
| ---- | ------- | ---- |
| `0` | Success | All gates pass |
| `1` | Validation failure | One or more gates fail |
| `2` | Input error | File not found, YAML/JSON parse error, unknown subcommand |

### Rules

- Exit code `1` is used when the input is valid but the content fails validation
- Exit code `2` is used when the tool cannot even begin validation
- A single validation run reports ALL failures (does not short-circuit)
- When both input errors and validation failures exist, `2` takes precedence

---

## 3. Error Message Format

All validation errors follow a consistent structure:

```json
{
  "path": "<dot-notation path to the failing field>",
  "message": "<human-readable description of the failure>",
  "severity": "error",
  "gate": "<gate_id>"
}
```

### Fields

| Field | Type | Description |
| ----- | ---- | ----------- |
| `path` | string | JSON path to the error location (e.g., `"scan.scopes.project.roots"`) |
| `message` | string | Clear description of what failed and why |
| `severity` | enum | `"error"` (blocks pass) or `"warning"` (informational) |
| `gate` | string | Which gate produced this error |

### Message Guidelines

- Messages MUST be actionable (explain what to fix)
- Messages MUST reference the offending value when possible
- Messages MUST NOT contain stack traces or internal implementation details
- Example: `"slot_id 'adrAuthoring' does not match snake_case pattern ^[a-z][a-z0-9]*(_[a-z0-9]+)*$"`

---

## 4. Gate 1: Schema Validation

Validates structural correctness of artifacts and adapter configuration.

### Checks Performed

| Check | Target | Condition |
| ----- | ------ | --------- |
| Required keys | Adapter, Catalog, Profile | All required fields exist |
| Type correctness | All fields | Each field matches expected type |
| Enum values | `slot_type`, `activation`, `action`, `severity` | Value within allowed set |
| `snake_case` enforcement | Identifiers | Matches `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` |
| Classification consistency | `unmatched.category` | Exists in `taxonomy[].id` |
| Forbidden keys | `priority` | Must not exist anywhere |
| Scope integrity | `scan.scopes` | `enabled: true` scopes have non-empty `roots` (post-merge) |
| Readable outputs integrity | `readable_outputs.include` | All entries exist in `artifacts.protocol` |
| Unmatched policy validity | `classification.unmatched` | No contradictory combinations |
| Default exclusivity | `flow_stack.slots[].default` | `skill` and `capability` not both set |

### `snake_case` Enforcement Detail

The following identifiers are validated:

- `flow_stack.slots[].slot_id`
- `classification.taxonomy[].id`
- `classification.taxonomy[].match.capabilities[]`
- `invocation_resolution.overrides.slots.<key>`
- `invocation_resolution.overrides.capabilities.<key>`
- `provides[].capability` (in catalog)
- `uses[].capability` (in catalog)

A non-conforming identifier produces:

```json
{
  "path": "flow_stack.slots[0].slot_id",
  "message": "slot_id 'adrAuthoring' does not match snake_case pattern ^[a-z][a-z0-9]*(_[a-z0-9]+)*$",
  "severity": "error",
  "gate": "schema"
}
```

### Invalid `classification.unmatched` Combinations

| `action` | `severity` | `category` | Result |
| -------- | ---------- | ---------- | ------ |
| `assign` | any | missing | error |
| `fail` | `info` | any | error |
| `ignore` | `error` | any | error |
| any | any | not in taxonomy | error |

### Result Schema

```json
{
  "result": "pass" | "fail",
  "errors": [
    {
      "path": "scan.scopes.project.roots",
      "message": "enabled scope 'project' has empty roots after merge",
      "severity": "error",
      "gate": "schema"
    }
  ],
  "warnings": []
}
```

---

## 5. Gate 2: Staleness Validation

Validates that artifacts are fresh enough to be trusted.

### Configuration

```yaml
validation:
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
```

### Checks Performed

| Check | Condition |
| ----- | --------- |
| Age limit | `now - validated_at <= max_age_days` |
| New skills | No skills added since last `validated_at` |
| Removed skills | No skills removed since last `validated_at` |

### Detection of Skill Changes

- Compare current scan results against the skill list in existing catalog
- New directories with `SKILL.md` → `new_skills[]`
- Directories removed or `SKILL.md` deleted → `removed_skills[]`

### Result Schema

```json
{
  "result": "pass" | "fail",
  "basis": "validated_at",
  "basis_date": "2025-01-15T10:30:00Z",
  "max_age_days": 30,
  "age_days": 5,
  "new_skills": [],
  "removed_skills": []
}
```

---

## 6. Gate 3: Deterministic Validation

Validates that re-execution produces byte-identical output.

### Configuration

```yaml
validation:
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
```

### Procedure

1. Stash current artifact files
2. Re-run `sdp profile` with the same adapter
3. Compare each target pair byte-for-byte
4. Restore original artifacts
5. If any comparison finds a diff → fail

### Comparison Targets

| Target | What Is Compared |
| ------ | ---------------- |
| `profile` | Flow Profile JSON |
| `profile+catalog-artifacts` | Flow Profile + Skill Reference Catalog |
| `validation-report:exclude-timestamp` | Validation Report with `generated_at` stripped |

### Stability Mechanisms

- Stable sort keys defined in `render.stable_sort`
- Whitespace normalization via `render.normalize_whitespace`
- Newline normalization via `render.newline`
- No random values, no environment-dependent content

### Result Schema

```json
{
  "result": "pass" | "fail",
  "comparisons": [
    {
      "target": "profile",
      "diff_found": false,
      "details": null
    },
    {
      "target": "profile+catalog-artifacts",
      "diff_found": true,
      "details": "catalog.skills[3].description differs"
    }
  ]
}
```

---

## 7. Gate 4: Blocking Validations

Validates critical invocation resolution constraints.

### Configuration Source

Blocking checks are derived from `invocation_resolution` settings:

| Setting | Value | Behavior |
| ------- | ----- | -------- |
| `unresolved.required` | `"fail"` | Required unresolved → gate fail |
| `unresolved.required` | `"warn"` | Warning only |
| `unresolved.optional` | `"warn"` | Warning only |
| `unresolved.optional` | `"ignore"` | Silently skip |
| `invalid_override.unknown_skill` | `"fail"` | Unknown skill → gate fail |
| `invalid_override.capability_mismatch` | `"fail"` | Mismatch → gate fail |
| `invalid_override.override_not_allowed` | `"fail"` | Not allowed → gate fail |
| Any of above | `"warn"` | Warning only, does not block |

### Non-blocking Items (Always Warnings)

- Unused slot overrides (slot defined but never referenced)
- Unused capability overrides
- Optional unresolved invocations (when `unresolved.optional = "warn"`)

### Invocation Gate Toggle

```yaml
validation:
  invocation:
    enabled: true
```

When `enabled: false`, Gate 4 is skipped entirely but recorded in the report:

```json
{
  "result": "skip",
  "reason": "invocation validation disabled in adapter"
}
```

### Result Schema

```json
{
  "result": "pass" | "fail" | "skip",
  "checks": [
    {
      "type": "unresolved_required",
      "target": "code_review",
      "result": "fail",
      "message": "Required capability 'code_review' has no provider and no override"
    }
  ],
  "warnings": [
    {
      "type": "unused_override",
      "target": "deprecated_slot",
      "message": "Override for slot 'deprecated_slot' is never referenced"
    }
  ]
}
```

---

## 8. Overall Validation Report

The validation report aggregates all gate results:

```json
{
  "schema_version": "1.0",
  "generated_at": "2025-01-20T14:00:00Z",
  "repository": "my-project",
  "adapter_id": "implementation-flow-default",
  "schema_validation": { "result": "pass", "errors": [], "warnings": [] },
  "staleness_validation": { "result": "pass", "basis_date": "...", "age_days": 2 },
  "deterministic_validation": { "result": "pass", "comparisons": [] },
  "blocking_validations": { "result": "pass", "checks": [], "warnings": [] },
  "overall_result": "pass"
}
```

### Gate Execution Order

1. Schema (always runs)
2. Staleness (always runs)
3. Deterministic (always runs)
4. Blocking (runs unless `validation.invocation.enabled = false`)

Even if Gate 1 fails, all subsequent gates still execute to provide
a complete picture of all issues.

---

## 9. `snake_case` as Schema Error

### Scope

Any identifier subject to the `snake_case` rule that fails the pattern
check `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` is classified as a **schema error**,
not a warning.

### Implications

- Reported in Gate 1 (Schema Validation)
- Causes `schema_validation.result = "fail"`
- Causes `overall_result = "fail"`
- Exit code = `1`

### Examples

| Value | Valid | Reason |
| ----- | ----- | ------ |
| `adr_authoring` | Yes | Correct snake_case |
| `code_review` | Yes | Correct snake_case |
| `adrAuthoring` | No | camelCase |
| `ADR_AUTHORING` | No | UPPER_CASE |
| `adr-authoring` | No | kebab-case |
| `_private` | No | Leading underscore |
| `123_slot` | No | Leading digit |
