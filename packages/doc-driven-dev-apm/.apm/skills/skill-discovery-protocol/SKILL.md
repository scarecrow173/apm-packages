---
name: skill-discovery-protocol
description: "Meta-skill that discovers, catalogs, classifies, and validates project skills via a flow-neutral protocol. Use when: generating skill catalogs, building flow profiles, validating discovery artifacts, querying skill capabilities. Keywords: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

A **meta-skill** that discovers, catalogs, and validates project skills through
a flow-neutral protocol. It produces structured artifacts consumed by any flow
(implementation, briefing, or future flows) without embedding flow-specific
language in the protocol itself.

## Purpose

- Scan project skill sources across multiple scopes
- Build a flow-independent Skill Reference Catalog
- Generate flow-specific profiles via adapter-driven classification
- Validate artifacts for schema compliance, staleness, and determinism

## When to Use

- Generating or updating the Skill Reference Catalog for a project
- Building a flow profile for any flow that needs skill routing
- Validating existing discovery artifacts after skill changes
- Querying the catalog for capability or slot information
- Onboarding a new flow that needs skill discovery

## Design Principles

- **Flow-neutral**: The protocol core holds no flow-specific vocabulary
- **Adapter separation**: Flow-specific logic lives in adapter YAML only
- **Script-only**: All artifacts are generated and validated via scripts
- **Idempotent**: Same input always produces the same output
- **Machine-readable first**: JSON is the canonical artifact; Markdown is derived

---

## Canonical Steps

```text
load_adapter → scan_skills → build_skill_reference_catalog
→ classify_skills → resolve_invocations → build_flow_profile
→ render_outputs → validate_outputs
```

| Step | Input | Output |
| ---- | ----- | ------ |
| `load_adapter` | Adapter YAML (with extends resolution) | Merged config |
| `scan_skills` | Scopes + roots | Raw skill list |
| `build_skill_reference_catalog` | Raw skill list | Skill Reference Catalog JSON |
| `classify_skills` | Catalog + taxonomy | Classified skills |
| `resolve_invocations` | Classified skills + overrides | Resolved invocations |
| `build_flow_profile` | All above | Flow Profile JSON |
| `render_outputs` | JSON artifacts | Stable-sorted JSON + optional MD |
| `validate_outputs` | Artifacts | Validation Report |

---

## 2-Layer Artifact Model

### Layer 1: Skill Reference Catalog (flow-independent)

`skill-reference-catalog.json` — Lists all discovered skills with:

- `provides[]` — capabilities the skill offers
- `uses[]` — capabilities the skill consumes
- `execution_policy` — how the skill should be executed
- `slots[]` — capability slot definitions
- `tags[]` — classification hints

### Layer 2: Flow Profile (flow-specific)

`*-profile.json` — Named per flow (e.g., `implementation-profile.json`):

- Classification of skills per adapter taxonomy
- `flow_stack.slots[]` — slot assignments for the flow
- `resolved_invocations` — fully resolved skill routing
- `runtime_guidance` — execution hints for the flow

### Validation Report

`validation-report.json` — Quality assurance output:

- Schema gate results
- Staleness gate results
- Deterministic gate results
- Blocking validation results
- `overall_result` — aggregate pass/fail

---

## Scan Scopes

The protocol supports 4 scan scopes. By default only `project` is enabled.

| Scope | Default | Description |
| ----- | ------- | ----------- |
| `project` | enabled | Local project skill directories |
| `user` | disabled | User-level shared skills |
| `organization` | disabled | Organization-wide skills |
| `builtin` | disabled | Agent built-in skills |

Each scope defines `enabled` (boolean) and `roots` (string array of paths).
The `general-adapter` aggregates roots for all major harness formats:

- `.apm/skills/`, `.agents/skills/`
- `.github/skills/`, `.github/agents/`
- `.cursor/rules/`, `.claude/commands/`
- `.gemini/skills/`, `.gemini/commands/`
- `.opencode/skills/`
- `apm_modules/` (installed packages)
- Root instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, etc.)

---

## Classification via Adapter

Classification is **not** part of the protocol core. Each flow defines its
taxonomy in the adapter YAML under `classification.taxonomy[]`. The protocol
provides the mechanism:

- `taxonomy[]` — ordered list of categories with `match` rules
- `unmatched` — policy for skills that match no category (`assign`/`warn`/`fail`/`ignore`)

This design allows any flow to define its own vocabulary without modifying
the protocol itself.

---

## Commands

| Command | Purpose |
| ------- | ------- |
| `sdp generate --adapter <yaml>` | Generate/update all artifacts |
| `sdp validate --profile <json>` | Validate artifacts against gates |
| `sdp query --profile <json> <sub>` | Extract information from artifacts |

### `sdp generate`

Input: Adapter YAML path (with `--adapter` flag).
Output: Skill Reference Catalog + Flow Profile + Validation Report.

### `sdp validate`

Runs 4 validation gates:

1. **Schema** — structural correctness
2. **Staleness** — freshness based on `validated_at`
3. **Deterministic** — re-run produces identical output
4. **Blocking** — invocation resolution failures

### `sdp query`

Subcommands for extracting catalog/profile data without full regeneration.

---

## Artifacts Summary

| Artifact | Format | Role |
| -------- | ------ | ---- |
| `skill-reference-catalog.json` | JSON | Skill capability catalog (flow-independent) |
| `skill-reference-catalog.md` | Markdown | Human-readable derived view |
| `*-profile.json` | JSON | Flow Profile (flow-specific) |
| `*-profile.md` | Markdown | Human-readable derived view |
| `validation-report.json` | JSON | Validation results |
| `validation-report.md` | Markdown | Human-readable derived view |

---

## References

- [Protocol Contract](references/protocol-contract.md) — formal contract specification
- Adapter YAML schema: defined per-flow in adapter references
- Spec details: `docs/specs/skills/skill-discovery-protocol/`
