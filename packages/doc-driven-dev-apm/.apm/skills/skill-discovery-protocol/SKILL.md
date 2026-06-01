---
name: skill-discovery-protocol
description: "Meta-skill that scans installed skills, builds inferred skill references, catalogs capabilities, classifies skills, and validates discovery artifacts via a flow-neutral protocol. Use when: generating skill catalogs, building flow profiles, validating discovery artifacts, querying skill capabilities. Keywords: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

A meta-skill that discovers, catalogs, and validates installed skills through a
flow-neutral protocol. It produces structured artifacts consumed by any flow
without embedding flow-specific language in the protocol itself.

## Purpose

- Scan project, user, organization, and builtin skill sources
- Save the full `SKILL.md` body for every discovered skill
- Use agent-authored inference data to populate skill capabilities
- Build a flow-independent Skill Reference Catalog
- Generate flow-specific profiles via adapter-driven classification
- Validate artifacts for schema compliance, staleness, and determinism

## Important Model

Installed skills are external inputs. Their `SKILL.md` files may only contain
standard metadata such as `name` and `description`. Do not require custom
front matter such as `provides`, `uses`, `tags`, or `execution_policy`.

The protocol uses three stages:

1. `skill-scan-list.json`: raw scan result with each discovered `SKILL.md` body.
2. `skill-reference-inferences.json`: agent-authored inferences for capabilities and policy.
3. `skill-reference-catalog.json`: normalized flow-independent catalog.

## Canonical Steps

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

| Step | Input | Output |
| ---- | ----- | ------ |
| `load_adapter` | Adapter YAML | Merged config |
| `scan_skills` | Scopes + roots | Raw skill list |
| `write_scan_list` | Raw skill list | `skill-scan-list.json` |
| `read_skill_reference_inferences` | Inference JSON | Inferred skill references |
| `build_skill_reference_catalog` | Scan list + inferences | Skill Reference Catalog JSON |
| `classify_skills` | Catalog + taxonomy | Classified skills |
| `resolve_invocations` | Classified skills + overrides | Resolved invocations |
| `build_flow_profile` | All above | Flow Profile JSON |
| `render_outputs` | JSON artifacts | Stable-sorted JSON + optional MD |
| `validate_outputs` | Artifacts | Validation Report |

## Artifact Model

### Skill Scan List

`skill-scan-list.json` records `name`, `description`, full `body`,
`skill_path`, and `scope` for each discovered skill.

### Skill Reference Inferences

`skill-reference-inferences.json` records agent-inferred `provides`, `uses`,
`execution_policy`, and `tags`. Each entry must match a scanned skill.

### Skill Reference Catalog

`skill-reference-catalog.json` lists discovered skills with:

- `provides[]`: capabilities the skill offers
- `uses[]`: capabilities the skill consumes
- `execution_policy`: how the skill should be executed
- `tags[]`: classification hints

The catalog is flow-independent. It must not contain `slots`, `slot_count`,
`resolved_invocations`, or flow-specific classification.

### Flow Profile

`*-profile.json` is named per flow and contains:

- Classification of skills per adapter taxonomy
- `flow_stack.slots[]`: invocation slot assignments for the flow
- `resolved_invocations`: fully resolved skill routing
- `runtime_guidance`: execution hints for the flow

## Commands

| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | Generate the scan list |
| `sdp infer init --scan <json>` | Generate/edit inference artifacts |
| `sdp profile --adapter <yaml> [--references <json>]` | Generate/update catalog and profile artifacts |
| `sdp validate --profile <json>` | Validate artifacts against gates |
| `sdp query --profile <json> <sub>` | Extract information from artifacts |

If scan data is missing, run `sdp scan` first. If inference data is missing,
run `sdp infer init --scan .sdp/skill-scan-list.json`. Then rerun
`sdp profile`.

## Artifacts Summary

| Artifact | Format | Role |
| -------- | ------ | ---- |
| `skill-scan-list.json` | JSON | Raw scan list with full `SKILL.md` bodies |
| `skill-reference-inferences.json` | JSON | Agent-inferred skill capabilities |
| `skill-reference-catalog.json` | JSON | Skill capability catalog |
| `skill-reference-catalog.md` | Markdown | Human-readable derived view |
| `*-profile.json` | JSON | Flow Profile |
| `*-profile.md` | Markdown | Human-readable derived view |
| `validation-report.json` | JSON | Validation results |
| `validation-report.md` | Markdown | Human-readable derived view |

## References

- [Protocol Contract](references/protocol-contract.md)
- [Protocol Contract (Japanese)](references/protocol-contract.ja.md)
- Spec details: `docs/specs/skills/skill-discovery-protocol/`
