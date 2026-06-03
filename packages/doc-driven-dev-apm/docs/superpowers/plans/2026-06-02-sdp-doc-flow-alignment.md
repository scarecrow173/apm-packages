# SDP Doc Flow Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `doc-driven-dev-apm` documentation with the current `sdp scan -> agent inference -> sdp infer -> sdp profile` workflow and adapter-scoped profile paths.

**Architecture:** Keep CLI behavior unchanged and limit scope to documentation. Update the distributed `SKILL.md` entry points first, then repair stale migration and deprecated reference docs so every operator-facing document describes the same artifact flow and path model.

**Tech Stack:** Markdown, existing SDP CLI, distributed `.apm` skill docs

---

## Task 1: Align the distributed flow entry points

**Files:**

- Modify: `.apm/skills/implementation-flow/SKILL.md`
- Modify: `.apm/skills/implementation-flow/SKILL.ja.md`
- Modify: `.apm/skills/briefing-flow/SKILL.md`
- Modify: `.apm/skills/briefing-flow/SKILL.ja.md`

- [ ] **Step 1: Update profile-generation wording to make agent inference explicit**

State that profiles are produced by `sdp scan`, agent review/update of inference entries, `sdp infer`, and `sdp profile`, rather than implying a single opaque generate step.

- [ ] **Step 2: Keep runtime examples on adapter-scoped profile paths**

Examples must use:

```text
.sdp/implementation-flow-default/implementation-flow-profile.json
.sdp/briefing-flow-default/briefing-profile.json
```

- [ ] **Step 3: Preserve the operational guardrail before `sdp profile`**

Document that after `sdp infer init`, the operator inspects or updates `provides` / `uses`, then runs:

```text
sdp infer check --in .sdp/skill-reference-inferences.json
```

before `sdp profile`.

## Task 2: Repair stale migration and deprecated schema references

**Files:**

- Modify: `.apm/skills/skill-discovery-protocol/docs/migration.md`
- Modify: `.apm/skills/skill-discovery-protocol/docs/migration.ja.md`
- Modify: `.apm/skills/implementation-flow/references/implementation-profile-schema.md`
- Modify: `.apm/skills/briefing-flow/references/briefing-profile-schema.md`

- [ ] **Step 1: Replace outdated profile filenames and artifact layout**

Migration docs must describe:

```text
shared artifacts:
  .sdp/skill-scan-list.json
  .sdp/skill-reference-inferences.json
  .sdp/skill-reference-catalog.json

flow-specific artifacts:
  .sdp/<adapter_id>/<flow_profile>.json
  .sdp/<adapter_id>/validation-report.json
```

- [ ] **Step 2: Replace outdated adapter examples with current schema keys**

Update old field names such as `id`, `label`, `required`, `default_skill`, `catalog`, `profile`, and `report` to the current adapter schema names:

```yaml
flow_stack:
  slots:
    - slot_id: "example_slot"
      slot_type: "exclusive"
      activation: "on_demand"
      default:
        skill: "example-skill"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "<your-flow>-profile.json"
    validation_report: "validation-report.json"
```

- [ ] **Step 3: Add the explicit public workflow to deprecated schema notes**

Deprecated profile-schema references should point readers to:

```text
sdp scan -> agent inference -> sdp infer -> sdp profile -> sdp validate -> sdp query
```

and mention adapter-scoped JSON output paths.

## Task 3: Verify the documentation set

**Files:**

- Test: `.apm/skills/implementation-flow/SKILL.md`
- Test: `.apm/skills/briefing-flow/SKILL.md`
- Test: `.apm/skills/skill-discovery-protocol/docs/migration.md`

- [ ] **Step 1: Run focused markdown lint on the edited docs**

Run:

```bash
pnpm exec markdownlint-cli2 \
  "packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.md" \
  "packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.ja.md" \
  "packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.md" \
  "packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.ja.md" \
  "packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/docs/migration.md" \
  "packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/docs/migration.ja.md" \
  "packages/doc-driven-dev-apm/.apm/skills/implementation-flow/references/implementation-profile-schema.md" \
  "packages/doc-driven-dev-apm/.apm/skills/briefing-flow/references/briefing-profile-schema.md"
```

Expected: exit `0`

- [ ] **Step 2: Spot-check the key strings**

Confirm the edited docs consistently mention:

```text
sdp scan -> agent inference -> sdp infer -> sdp profile
.sdp/<adapter_id>/
skill-reference-inferences.json
```

- [ ] **Step 3: Record the result**

Summarize which docs were aligned and note any remaining distributed references that are intentionally historical-only.
