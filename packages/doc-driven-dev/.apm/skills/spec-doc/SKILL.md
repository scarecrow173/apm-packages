---
name: spec-doc
description: Use when defining, refining, approving, superseding, or auditing what should be built, why it is needed, and what acceptance criteria must hold before implementation work starts.
license: MIT
---

# Spec Documentation Skill

Use this skill to write project specs that become the source document for
implementation plans and tasks. A spec defines what should be built, why it is
needed, who it serves, what is in and out of scope, and how success will be
verified before code is written.

## Workflow

1. Scan existing docs before asking questions.
   Use the directory and naming rules in `references/spec-conventions.md`.
   Check `docs/specs/`, `docs/adr/`, `docs/plans/`, and related code so the new
   spec does not duplicate or contradict existing decisions.
2. Capture intent with the human.
   Confirm goal, trigger, audience, user value, constraints, non-goals,
   acceptance criteria, and source material.
3. Create or update the spec.
   Preferred creation command:

   ```bash
   node scripts/new_spec.js --title "Define checkout flow"
   ```

   The creation script uses `assets/templates/spec.md`. If you cannot run the
   script, copy that template and fill it manually.

4. Record meaningful relations in YAML front matter.
   Use `relations.source` for external evidence and primary sources,
   `relations.references` for supplementary material, `relations.refines` for
   upstream docs being narrowed, and `relations.related` for contextual docs.
   If a brainstorming discovery artifact exists in `docs/discovery/`, record it
   in `relations.derives-from`.
5. Review the spec before implementation planning.
   A plan should not be created from a draft with unclear requirements or
   unverifiable acceptance criteria.
   To proceed to plan creation, the spec must have status `proposed` or above.

## Required Content

A spec should answer:

- What should be built?
- Why is it needed now?
- Who benefits from it?
- What is in scope?
- What is explicitly out of scope?
- What behavior, interface, workflow, or document outcome must exist?
- What acceptance criteria prove the work is correct?
- Which source evidence, ADRs, or discovery notes informed it?

Specs intentionally cover product intent and implementation-facing behavior in
one document. Do not split product, user, value, behavior, and acceptance
questions into a separate requirements document; route them into `spec-doc`.

## Front Matter

Generated specs use YAML front matter:

```yaml
---
id: "SPEC-0001"
type: "spec"
status: "draft"
title: "Define checkout flow"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
  defers: []
  deferred-by: []
---
```

Status values: `draft`, `proposed`, `approved`, `implemented`, `superseded`,
`rejected`.

## Review Checklist

Before moving a spec from `draft` to `proposed` or `approved`, verify every item
below. A spec that fails any gate must be revised before implementation planning.

| # | Gate | Pass criteria |
|---|------|---------------|
| 1 | **Problem stated** | The "why" is concrete — not "improve UX" but a measurable gap or pain. |
| 2 | **Audience identified** | At least one named persona, role, or system consumer. |
| 3 | **Scope bounded** | Both in-scope and out-of-scope sections are explicit and non-empty. |
| 4 | **Acceptance criteria testable** | Each criterion can be verified by a human or automated test without subjective judgment. |
| 5 | **No implementation leakage** | The spec describes *what* and *why*, not *how*. Technology choices belong in ADRs or plans. |
| 6 | **Relations linked** | Relevant ADRs, upstream specs, and source evidence are recorded in front matter `relations`. |
| 7 | **No contradictions** | Cross-check against existing specs and ADRs — no silent overrides. |
| 8 | **Owner assigned** | `owners` field is non-empty; at least one person accountable for approval. |
| 9 | **Status correct** | Front matter `status` reflects the actual review state. |

## Relationship with ADRs

In this package's lifecycle, spec and ADR are created in parallel from the same
discovery output. All decisions are recorded as ADRs.

- **Spec reveals an architecture decision:** Write the ADR in parallel with
  the spec. Link with `relations.related` in both directions.
- **ADR already exists:** If an accepted ADR constrains this spec (e.g., "we
  use PostgreSQL"), reference it in `relations.derives-from` or
  `relations.related`.
- **No architecture decision needed:** Proceed directly from approved spec to
  `plan-doc`. ADR is not required for purely product-only work.

The dual-track: **spec + ADR (parallel) → plan → task**.

## Resources

- `scripts/new_spec.js`: create a spec and update its index.
- `references/spec-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for specs.
- `assets/templates/spec.md`: default spec body template.
