# Migration Guide: Old Protocol → Skill Discovery Protocol (SDP)

## Overview

The Skill Discovery Protocol (SDP) replaces the flow-specific inline
discovery protocols previously embedded in each flow skill.

| Aspect | Old Protocol | New Protocol (SDP) |
| ------ | ------------ | ------------------ |
| Location | Inline 7-step protocol in each flow SKILL.md | Common `skill-discovery-protocol` skill |
| Output format | Markdown (`.md`) | JSON (`.json`) |
| Operations | Manual editing allowed | Script-only (`sdp` CLI) |
| Categories | Hardcoded per flow | Adapter YAML taxonomy |
| Validation | Informal checks | 4-gate pipeline (schema, staleness, deterministic, blocking) |

## What Changed

### Profile Format

- `implementation-profile.md` → `implementation-profile.json` (via `sdp scan` / `sdp infer` / `sdp profile`)
- `briefing-profile.md` → `briefing-profile.json` (via `sdp scan` / `sdp infer` / `sdp profile`)

### Discovery Steps

- Inline 7-step protocol in each flow → `sdp` CLI commands
- Manual profile editing → script-only operations via `sdp scan` / `sdp infer` / `sdp profile`

### Classification

- Flow-specific categories hardcoded in SKILL.md → adapter YAML taxonomy
- Each flow defines its own adapter extending `general`

### Artifacts

- Single `.md` file → Three co-located JSON artifacts:
  - `<flow>-profile.json` — Classified skill assignments
  - `skill-reference-catalog.json` — Full skill catalog
  - `validation-report.json` — Gate results

## Adopting the Common Protocol for New Skills

Follow these steps to integrate SDP into a new flow skill:

### Step 1: Create an Adapter YAML

Place a flow-specific adapter at `<skill>/references/<name>-adapter.yaml`.

### Step 2: Extend `general`

The adapter MUST include `extends: ["general"]` to inherit scan roots
and base configuration.

### Step 3: Define Classification Taxonomy

Add `classification.taxonomy` entries for the flow's categories.
Each entry requires `id`, `label`, `description`, and `match` rules.

### Step 4: Define Flow Stack Slots

Configure `flow_stack.slots` for the flow's default skill assignments.
Each slot specifies `id`, `label`, `required`, and `default_skill`.

### Step 5: Generate Artifacts

```bash
sdp scan --adapter <adapter-yaml>
sdp infer init --scan .sdp/skill-scan-list.json
sdp profile --adapter <adapter-yaml>
```

This produces the profile, catalog, and validation report.

### Step 6: Reference `sdp query` in SKILL.md

Use `sdp query` commands in your flow's SKILL.md to access profile data
at runtime:

```bash
sdp query --profile <profile-json> flow-stack
sdp query --profile <profile-json> resolution
sdp query --profile <profile-json> execution-policy
```

### Step 7: Set Up Validation

```bash
sdp validate --profile <profile-json>
sdp validate --adapter <adapter-yaml>
```

Run validation after generation and periodically to detect staleness.

## Command Reference

| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | Generate scan list |
| `sdp infer init --scan <json>` | Create or update inference data |
| `sdp profile --adapter <yaml>` | Generate/update profile, catalog, report |
| `sdp validate --profile <json>` | Validate artifacts (4 gates) |
| `sdp validate --adapter <yaml>` | Validate adapter YAML structure |
| `sdp query --profile <json> <subcommand>` | Extract information from profile |

### Query Subcommands

- `categories` — List all classification categories
- `category-skills` — List skills in a specific category
- `flow-stack` — Show flow stack slot assignments
- `resolution` — Show invocation resolution chain
- `execution-policy` — Show execution policy
- `capability-skills` — Find skills by capability
- `skill-detail` — Show detail for a specific skill
- `runtime-guidance` — Show runtime guidance for a skill
- `unresolved` — List unresolved invocations
- `validation-status` — Show last validation status

## Adapter Template (Minimal)

Use this template when creating a new flow adapter:

```yaml
schema_version: "1.0"
adapter_id: "<your-flow>-default"
extends:
  - "general"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
profile:
  title: "<Your Flow> Profile"
flow_stack:
  slots: []
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
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
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
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
  invocation:
    enabled: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"
artifacts:
  protocol:
    catalog: "skill-reference-catalog.json"
    profile: "<your-flow>-profile.json"
    report: "validation-report.json"
readable_outputs:
  enabled: true
  include:
    catalog: true
    profile: true
```

## Extending Query Subcommands

To add a new query subcommand:

1. Create `src/skills/skill-discovery-protocol/scripts/lib/query/<name>.ts`
2. Export a handler implementing the `QueryHandler` interface
3. Import and register in `query.ts`
4. Add tests in `tests/skills/skill-discovery-protocol/query-regression.test.ts`

### Handler Template

```typescript
import { QueryHandler } from "./registry.js";

export const handler: QueryHandler = {
  name: "<subcommand-name>",
  description: "<what it does>",
  usage: "sdp query --profile <json> <subcommand-name> [args...]",
  execute(profile, catalog, report, args) {
    // Implementation
    return { /* result object */ };
  },
};
```

## Deprecation Timeline

| Phase | Status | Description |
| ----- | ------ | ----------- |
| Immediate | **Active** | Old `.md` profile schemas marked deprecated |
| Transition | Planned | Both old and new formats coexist |
| Removal | Future | Old `.md` schema documents removed |

The old profile schema documents are retained as reference only.
All new work MUST use the SDP JSON-based approach.
