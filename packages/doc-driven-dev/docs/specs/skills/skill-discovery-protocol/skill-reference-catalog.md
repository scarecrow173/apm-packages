# Skill Reference Catalog Specification

## Overview

The Skill Reference Catalog is the **flow-neutral** canonical artifact that
joins the skills discovered by scan with agent-inference artifacts, listing
the capabilities each skill provides and uses together with its execution
policy.

The Catalog does not assume custom metadata in `SKILL.md`. `provides` /
`uses` / `execution_policy` / `tags` are values supplemented by the agent
reading the full `SKILL.md` text stored by scan and writing
`skill-reference-inferences.json`. As a prerequisite for catalog construction,
every inference entry must have `review_status = "reviewed"`.

## Input Artifacts

| Artifact | Role |
| --- | --- |
| `skill-scan-list.json` | Full text and location of each `SKILL.md` found by scan |
| `skill-reference-inferences.json` | Reviewed inference information supplemented by agent inference |

## File Formats

- Canonical: `skill-reference-catalog.json`
- Derivative: `skill-reference-catalog.md` (for human review)

## JSON Example

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-28T00:00:00Z",
  "validated_at": "2026-05-28T00:00:00Z",
  "skill_count": 1,
  "capability_count": 2,
  "skills": [
    {
      "name": "documentation-and-adrs",
      "description": "Document architecture decisions",
      "provides": [
        { "capability": "adr_authoring", "description": "Creates ADRs" }
      ],
      "uses": [
        {
          "capability": "code_review",
          "required": false,
          "default_skill": "code-review-and-quality",
          "override_allowed": true
        }
      ],
      "execution_policy": {
        "strictness": "flexible",
        "sequence_required": false,
        "allow_step_reordering": true,
        "allow_partial_application": true,
        "guidance": "Steps can be applied in any order based on context"
      },
      "runtime_guidance": [
        {
          "skill": "documentation-and-adrs",
          "context": "adr_authoring",
          "guidance": "Use when creating or updating architecture decision records",
          "priority_delta": 20,
          "prefer_when": ["adr_authoring", "design_decision"],
          "avoid_when": ["pure_copy_edit"]
        }
      ],
      "tags": ["architecture", "documentation"]
    }
  ]
}
```

## Top-level fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | catalog schema version |
| `generated_at` | ISO 8601 | yes | Generation timestamp |
| `validated_at` | ISO 8601 | yes | Last validation timestamp |
| `skill_count` | number | yes | Total skill count |
| `capability_count` | number | yes | Total capability count |
| `skills` | array | yes | Skill list |

## `skills[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Skill name |
| `description` | string | yes | Standard description obtained by scan |
| `provides` | array | yes | Inferred provided capabilities |
| `uses` | array | yes | Inferred used capabilities |
| `execution_policy` | object | yes | Inferred execution policy |
| `tags` | string[] | no | Inferred classification-assist tags |

## `skills[].provides[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability identifier |
| `description` | string | no | Description of what is provided |

## `skills[].uses[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability identifier |
| `required` | boolean | yes | Whether the dependency is required |
| `default_skill` | string | no | Default candidate for the capability dependency |
| `override_allowed` | boolean | yes | Whether a flow may override it |

## `skills[].execution_policy`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `strictness` | `"rigid"` \| `"flexible"` | yes | Execution strictness |
| `sequence_required` | boolean | yes | Whether step order is required |
| `allow_step_reordering` | boolean | yes | Whether step reordering is allowed |
| `allow_partial_application` | boolean | yes | Whether partial application is allowed |
| `guidance` | string | no | Runtime guidance |

## Constraints

- All capability identifiers are fixed `snake_case`
- `skills[]` is stable-sorted lexicographically by `name`
- `provides[]` / `uses[]` are stable-sorted lexicographically by `capability`
- A skill present in `skill-reference-inferences.json` that was not scanned
  fails as a stale inference
- A scanned skill with no corresponding inference fails as a missing inference
- A scanned skill with `review_status != reviewed` inference fails as an
  incomplete inference

## Relationship to the Flow Profile

- The Catalog holds only flow-neutral information
- The Catalog has no `slots` / `slot_count` / `resolved_invocations` /
  flow-specific classification
- Invocation slots are held by the Flow Profile's `flow_stack.slots[]`
- `skills[].uses[].default_skill` is the default candidate for a capability
  dependency, not the flow-specific `resolved_skill`
