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

4. Record meaningful relations in YAML front matter.
   Use `relations.source` for external evidence and primary sources,
   `relations.references` for supplementary material, `relations.refines` for
   upstream docs being narrowed, and `relations.related` for contextual docs.
5. Review the spec before implementation planning.
   A plan should not be created from a draft with unclear requirements or
   unverifiable acceptance criteria.

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
one document. Do not create a separate PRD document in this package; route
product, user, value, behavior, and acceptance questions into `spec-doc`.

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
---
```

Status values: `draft`, `proposed`, `approved`, `implemented`, `superseded`,
`rejected`.

## Resources

- `scripts/new_spec.js`: create a spec and update its index.
