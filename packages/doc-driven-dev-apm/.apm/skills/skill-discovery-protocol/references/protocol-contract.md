# Skill Discovery Protocol — Contract Specification

Version: 1.0.0

This document defines the formal contracts for the Skill Discovery Protocol.
All terms are flow-neutral; flow-specific vocabulary is defined exclusively
in adapter YAML files.

---

## 1. Canonical Steps Contract

The protocol executes exactly these steps in order:

```text
load_adapter → scan_skills → build_skill_reference_catalog
→ classify_skills → resolve_invocations → build_flow_profile
→ render_outputs → validate_outputs
```

### Step Contracts

| Step | Pre-condition | Post-condition |
| ---- | ------------- | -------------- |
| `load_adapter` | Valid adapter YAML path exists | Merged config with all `extends` resolved |
| `scan_skills` | Merged config has ≥1 enabled scope with non-empty roots | Raw skill list populated |
| `build_skill_reference_catalog` | Non-empty raw skill list | Valid Skill Reference Catalog JSON |
| `classify_skills` | Catalog + taxonomy available in merged config | Each skill assigned to ≥1 category or handled by `unmatched` policy |
| `resolve_invocations` | Classification complete + overrides loaded | All required invocations resolved or reported |
| `build_flow_profile` | Classification + resolution complete | Valid Flow Profile JSON |
| `render_outputs` | Profile + catalog generated | Stable-sorted JSON files + optional Markdown sidecars |
| `validate_outputs` | All artifacts rendered | Validation Report JSON with `overall_result` |

### Failure Propagation

- If any step fails, subsequent steps are not executed
- The failure is recorded in the validation report if reachable
- Exit code is non-zero on any step failure

---

## 2. Scan Contract

### 2.1 Scopes

The protocol defines exactly 4 scan scopes:

| Scope | ID | Description |
| ----- | -- | ----------- |
| Project | `project` | Skills local to the repository |
| User | `user` | User-level shared skills (e.g., `$COPILOT_USER_SKILLS`) |
| Organization | `organization` | Organization-distributed skills |
| Built-in | `builtin` | Agent built-in/system skills |

### 2.2 Default Configuration

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots: [".apm/skills"]
    user:
      enabled: false
      roots: []
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []
```

**Invariant:** Only `project` scope is enabled by default.

### 2.3 Scope Schema

Each scope MUST have the following structure:

```yaml
scan.scopes.<scope_id>:
  enabled: boolean    # Whether this scope is active
  roots: string[]    # Paths to scan (relative to project root)
```

**Rules:**

- If `enabled: true`, then `roots` MUST be non-empty (validated after extends merge)
- If `enabled: false`, `roots` MAY be empty
- `roots` entries are relative paths from the project root
- Environment variables in `roots` (e.g., `${COPILOT_USER_SKILLS}`) are expanded at runtime
- Duplicate roots across scopes are deduplicated; first occurrence wins

### 2.4 General Adapter Root Aggregation

The `general-adapter` MUST aggregate roots for all supported harness formats:

```yaml
# general-adapter scan.scopes.project.roots
scan:
  scopes:
    project:
      enabled: true
      roots:
        # Primary skill directories
        - ".apm/skills"
        - ".agents/skills"
        # GitHub Copilot
        - ".github/skills"
        - ".github/agents"
        # Cursor
        - ".cursor/rules"
        # Claude Code
        - ".claude/commands"
        # Gemini CLI
        - ".gemini/skills"
        - ".gemini/commands"
        # OpenCode
        - ".opencode/skills"
        # Installed packages
        - "apm_modules"
        # Root instruction files (scanned for skill references)
        - "."
```

Flow-specific adapters extend `general-adapter` and override only what differs.

### 2.5 Scan Priority

Within a scope, sources are scanned in priority order:

| Priority | Source Pattern | Discovery Method |
| -------- | ------------- | ---------------- |
| 1 | `.apm/skills/` | Directories containing `SKILL.md` |
| 2 | `.agents/skills/` | Directories containing `SKILL.md` |
| 3 | `.github/skills/`, `.github/agents/`, `.cursor/rules/`, `.claude/commands/`, `.gemini/skills/`, `.gemini/commands/`, `.opencode/skills/` | Format-specific files |
| 4 | System skills | Skills listed in agent context/instructions |
| 5 | `apm_modules/` | Installed packages with skills |
| 6 | Root files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`) | Inline or referenced skills |

---

## 3. Classification Contract

### 3.1 Taxonomy Structure

Classification is adapter-defined via `classification.taxonomy[]`:

```yaml
classification:
  taxonomy:
    - id: "<snake_case_id>"
      label: "<Human Label>"
      description: "<Category description>"
      match:
        capabilities: []     # snake_case capability IDs
        tags: []             # tag strings
        description_patterns: []  # regex patterns
  unmatched:
    action: "assign" | "warn" | "fail" | "ignore"
    category: "<taxonomy_id>"    # Required when action=assign
    severity: "info" | "warn" | "error"
```

### 3.2 Taxonomy Rules

- `taxonomy` is the canonical key (not `vocab` or `categories`)
- Each entry MUST have: `id`, `label`, `description`, `match`
- `match` MUST have: `capabilities[]`, `tags[]`, `description_patterns[]`
- `id` values MUST be `snake_case`
- `capabilities[]` values MUST be `snake_case`
- Matching is evaluated in taxonomy array order; first match wins
- A skill may match multiple categories if the adapter permits

### 3.3 Unmatched Policy

The `unmatched` key is REQUIRED and governs skills matching no category:

| `action` | Behavior |
| -------- | -------- |
| `assign` | Assign to `category` (which MUST reference a taxonomy `id`) |
| `warn` | Emit a warning; skill remains unclassified |
| `fail` | Fail the classification step |
| `ignore` | Silently skip the skill |

**Invalid combinations (schema error):**

- `action=assign` without `category`
- `action=fail` with `severity=info`
- `action=ignore` with `severity=error`
- `category` value not found in taxonomy `id` list

### 3.4 Flow Neutrality

The protocol core defines the classification **mechanism** only.
It MUST NOT define or assume any specific taxonomy categories.
All category semantics are the adapter's responsibility.

---

## 4. Artifact Contract

### 4.1 Skill Reference Catalog

**File:** `skill-reference-catalog.json`

**Nature:** Flow-independent. Contains no flow-specific classification.

**Required top-level fields:**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Generation timestamp |
| `validated_at` | ISO 8601 | Last validation timestamp |
| `skill_count` | number | Total skills discovered |
| `capability_count` | number | Total unique capabilities |
| `slot_count` | number | Total slot definitions |
| `slots` | array | Slot definitions |
| `skills` | array | Skill entries |

**Skill entry required fields:**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Skill identifier |
| `description` | string | Skill summary |
| `provides` | array | Capabilities offered (`{capability, description?}`) |
| `uses` | array | Capabilities consumed (`{capability, required, default_skill?, override_allowed?}`) |
| `execution_policy` | object | Execution constraints |

**Slot entry required fields:**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `slot_id` | string | `snake_case` identifier |
| `description` | string | Slot purpose |

**Constraints:**

- `slot_id` and `capability` identifiers MUST be `snake_case`
- The catalog MUST NOT contain `resolved_invocations` or flow-specific data
- `provides[].capability` values MUST be unique within a skill

### 4.2 Flow Profile

**File:** `<flow-name>-profile.json`

**Nature:** Flow-specific. Named per the adapter's flow.

**Required top-level fields:**

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

**Constraints:**

- The profile MUST reference skills that exist in the Skill Reference Catalog
- `resolved_invocations` MUST only contain skills present in the catalog
- `flow_stack.slots[].slot_id` MUST match catalog slot definitions

### 4.3 Validation Report

**File:** `validation-report.json`

**Required top-level fields:**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | Report generation timestamp |
| `repository` | string | Target repository name |
| `adapter_id` | string | Adapter used for generation |
| `schema_validation` | object | Gate 1 results |
| `staleness_validation` | object | Gate 2 results |
| `deterministic_validation` | object | Gate 3 results |
| `blocking_validations` | object | Gate 4 results |
| `overall_result` | string | `"pass"` or `"fail"` |

**Overall result formula:**

```text
overall_result = schema ∧ staleness ∧ deterministic ∧ blocking_validations
```

### 4.4 Derived Outputs

For each JSON artifact, an optional Markdown sidecar MAY be generated:

- `skill-reference-catalog.md`
- `*-profile.md`
- `validation-report.md`

Markdown files are **derived** and MUST NOT be treated as source of truth.
They are regenerated on every `sdp generate` invocation.

---

## 5. Validation Contract

### 5.1 Gate Structure

Validation comprises 4 gates executed in order:

| Gate | ID | Purpose |
| ---- | -- | ------- |
| 1 | `schema` | Structural correctness of artifacts |
| 2 | `staleness` | Freshness based on `validated_at` |
| 3 | `deterministic` | Re-execution produces identical output |
| 4 | `blocking` | Critical invocation resolution checks |

### 5.2 Schema Gate

Validates:

- All required fields present with correct types
- Enum values within allowed ranges
- `snake_case` enforcement on identifiers
- `classification` consistency (unmatched.category exists in taxonomy)
- `extends` does not use forbidden keys (e.g., `priority`)
- Enabled scopes have non-empty roots (post-merge)

**Result schema:**

```json
{
  "result": "pass" | "fail",
  "errors": [
    { "path": "<json_path>", "message": "<description>", "severity": "error" }
  ]
}
```

### 5.3 Staleness Gate

Validates artifact freshness:

- `now - validated_at <= max_age_days`
- No new skills added since last validation
- No skills removed since last validation

**Configuration (adapter):**

```yaml
validation:
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
```

**Result schema:**

```json
{
  "result": "pass" | "fail",
  "basis": "validated_at",
  "basis_date": "<ISO 8601>",
  "max_age_days": 30,
  "age_days": 5,
  "new_skills": [],
  "removed_skills": []
}
```

### 5.4 Deterministic Gate

Validates reproducibility:

1. Stash current artifacts
2. Re-run `sdp generate`
3. Compare outputs byte-for-byte (excluding timestamps where configured)
4. Any diff → fail

**Configuration (adapter):**

```yaml
validation:
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
```

**Result schema:**

```json
{
  "result": "pass" | "fail",
  "comparisons": [
    { "target": "<comparison_target>", "diff_found": false }
  ]
}
```

### 5.5 Blocking Gate

Validates critical invocation constraints:

| Check | Trigger |
| ----- | ------- |
| `unresolved_required` | A required invocation has no resolution |
| `unknown_skill_override` | Override references a non-existent skill |
| `capability_mismatch_override` | Override skill doesn't provide the capability |

**Configuration (adapter):**

```yaml
invocation_resolution:
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
```

**Result schema:**

```json
{
  "result": "pass" | "fail",
  "checks": [
    {
      "type": "<check_type>",
      "result": "pass" | "fail",
      "details": []
    }
  ]
}
```

---

## 6. Adapter Extends Contract

### 6.1 Mechanism

Adapters MAY declare `extends` as a string array:

```yaml
extends:
  - "general-adapter"
```

### 6.2 Merge Rules

- Extends are resolved in declaration order (left to right)
- Later values override earlier values for scalar keys
- Arrays are replaced (not merged) unless otherwise specified
- `roots` arrays within `scan.scopes` are merged (union)
- The `priority` key is FORBIDDEN in adapter YAML

### 6.3 Constraints

- Circular extends are a schema error
- Maximum extends depth: 3 levels
- All referenced adapters MUST exist at resolution time
