---
name: skill-discovery-protocol
description: "Meta-skill that scans installed skills, builds inferred skill references, catalogs capabilities, classifies skills, and validates discovery artifacts via a flow-neutral protocol. Use when generating skill catalogs, building flow profiles, validating discovery artifacts, or querying skill capabilities. Keywords: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

A meta-skill that discovers installed skills, infers their capabilities, and
turns those discoveries into flow-neutral catalog, profile, and validation
artifacts. Use this skill when generating skill catalogs, building flow
profiles, validating discovery artifacts, or querying skill capabilities.

## Use When

- You need to scan installed skills from `project`, `user`, `organization`, or
  `builtin` scopes.
- You need to infer `provides`, `uses`, `execution_policy`, or `tags` from a
  scanned skill body.
- You need to build or inspect `.sdp` discovery artifacts.
- You need to validate freshness, determinism, schema compliance, or blocking
  invocation issues.
- You need to query a generated flow profile.

## Core Model

Installed skills are external inputs. Their `SKILL.md` files may contain only
standard metadata such as `name` and `description`. Do not require custom
front matter such as `provides`, `uses`, `tags`, or `execution_policy`.

The protocol is flow-neutral:

- `sdp scan` writes raw skill discovery data.
- Agent inference decides capability metadata.
- `sdp infer` stores that agent-authored metadata.
- `sdp profile` combines scan and inference into catalog and profile outputs.
- `sdp validate` and `sdp query` read and verify generated artifacts.

## Workflow

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
| `render_outputs` | JSON artifacts | Stable-sorted JSON + optional Markdown |
| `validate_outputs` | Artifacts | Validation Report |

## Agent Inference Rules

After `sdp scan`, inspect `.sdp/skill-scan-list.json` and infer metadata with
these rules:

- `provides[]` describes what the skill can directly do.
- `uses[]` describes what the skill depends on or expects from another skill.
- `execution_policy` is for strict ordering, verification, or tool-use
  requirements that materially constrain execution.
- `tags[]` are classification hints only. Do not use them as flow routing.

Write those decisions through `sdp infer`:

```text
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer apply --ops <jsonl> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --in .sdp/skill-reference-inferences.json
```

Do not manually edit generated catalog, profile, report, or Markdown sidecar
artifacts. The inference JSON is the agent-authored input, and it must still be
modified through `sdp infer` so schema checks and stable sorting are preserved.

## Command Rules

| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | Generate the raw scan list |
| `sdp infer init --scan <json>` | Create the editable inference artifact from scan output |
| `sdp infer set-skill --name <skill> --spec <json>` | Upsert one agent-authored inference entry |
| `sdp infer apply --ops <jsonl>` | Apply multiple inference edits atomically |
| `sdp infer check --in <json>` | Validate inference schema before profiling |
| `sdp profile --adapter <yaml> [--references <json>]` | Generate catalog and adapter-scoped profile from existing scan + inference artifacts |
| `sdp validate --profile <json>` | Validate artifacts against gates |
| `sdp query --profile <json> <sub>` | Extract information from artifacts |

If scan data is missing, run `sdp scan` first. If inference data is missing,
run `sdp infer init --scan .sdp/skill-scan-list.json`. Then rerun
`sdp profile`.

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

- classification of skills per adapter taxonomy
- `flow_stack.slots[]`: invocation slot assignments for the flow
- `resolved_invocations`: fully resolved skill routing
- `runtime_guidance`: execution hints for the flow

## NEVER

- Never hand-edit generated JSON artifacts.
- Never hand-edit derived Markdown sidecars.
- Never assume `sdp profile` runs scan or inference implicitly.
- Never put flow-specific routing data into the flow-independent catalog.
- Never treat `tags[]` as routing logic.
- Never require non-standard front matter in scanned skills.

## Reference Loading Guide

Load only the references you need.

- `references/cli-reference.md`
  - MANDATORY when the task is about CLI usage, command order, command
    arguments, or output shape.
  - DO NOT load just to re-read the workflow if the command table in this file
    is sufficient.
- `references/operation-policy.md`
  - MANDATORY when the task touches generated artifacts, manual edits, or
    write-vs-read rules.
  - DO NOT load for pure read-only query questions.
- `references/gate-spec.md`
  - MANDATORY when the task is about validation failures, gate behavior, or
    exit codes.
  - DO NOT load unless you are debugging validation or staleness behavior.
- `references/protocol-contract.md`
  - MANDATORY when the task is about artifact structure, required fields, or
    contract semantics.
  - DO NOT load if you only need the operator recipe.
- `references/schema-reference.md`
  - MANDATORY when the task is about adapter YAML, schema fields, or merge and
    extend resolution.
  - DO NOT load for query-only tasks.

## References

- [Protocol Contract](references/protocol-contract.md)
- [Protocol Contract (Japanese)](references/protocol-contract.ja.md)
- [CLI Reference](references/cli-reference.md)
- [CLI Reference (Japanese)](references/cli-reference.ja.md)
- [Operation Policy](references/operation-policy.md)
- [Operation Policy (Japanese)](references/operation-policy.ja.md)
- [Gate Specification](references/gate-spec.md)
- [Gate Specification (Japanese)](references/gate-spec.ja.md)
- [Schema Reference](references/schema-reference.md)
- [Schema Reference (Japanese)](references/schema-reference.ja.md)
- Spec details: `docs/specs/skills/skill-discovery-protocol/`
