---
name: idea-doc
description: Use when capturing raw, unformalized ideas, candidate topics, or deferred points before they are ready for discovery or spec. Creates a lightweight canonical record in docs/ideas/ that becomes the upstream source for discovery-doc or spec-doc.
license: MIT
---

# Idea Documentation Skill

Use this skill to capture lightweight idea documents under `docs/ideas/`.
An idea document records an early, unformalized thought — a candidate topic,
a problem signal, a deferred point — before it is ready for deeper exploration
or specification.

Idea documents are deliberately minimal. Write one idea per file. The goal is
not to analyze or decide, but to preserve a thought so it can be picked up
later.

**Role boundaries:**

- `idea-doc` captures raw ideas — quick, lightweight, no analysis required.
- `discovery-doc` structures exploration — alternatives, trade-offs, hypotheses.
- `briefing-flow` orchestrates the full briefing process.
- `spec-doc` formalizes what to build.

Use `idea-doc` when you have a spark but not yet a question to investigate.
Move to `discovery-doc` when the idea needs deeper exploration. Move directly
to `spec-doc` when requirements are already clear.

## Workflow

1. Capture the idea promptly.
   Do not wait for the idea to be fully formed. An incomplete record is better
   than no record. Check `docs/ideas/` to avoid duplicates.
2. Create the idea document.
   Preferred creation command:

   ```bash
   node scripts/new_idea.js --title "Support offline mode for mobile"
   ```

   The creation script uses `assets/templates/idea.md`. If you cannot run the
   script, copy that template and fill it manually.

3. Record sources if available.
   Use `relations.source` for the link, issue, or conversation that prompted
   the idea. External links (URLs) are valid source values.
4. Set next action.
   Decide immediately whether to promote, park, or discard.
   Fill in the `Next Action` section of the template.
5. Promote when ready.
   When the idea is worth exploring, create a `discovery-doc` or `spec-doc`
   and link it via `relations.derived-by` in this document.
   Update status to `promoted`.

## Required Content

An idea document should answer:

- What is the core idea in one or two sentences?
- What problem, pain, or opportunity does it address?
- Who benefits and how?
- What open questions remain before this can be formalized?
- What is the immediate next action?

Keep it short. If the idea requires more than a few paragraphs, it is ready
for `discovery-doc` or `spec-doc`.

## Front Matter

Generated idea documents use YAML front matter:

```yaml
---
id: "IDEA-0001"
type: "idea"
status: "draft"
title: "Support offline mode for mobile"
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

Status values: `draft`, `exploring`, `promoted`, `parked`, `archived`,
`superseded`.

## Status Lifecycle

| Status | Meaning |
| --- | --- |
| `draft` | Just captured; next action not yet decided. |
| `exploring` | Actively thinking about it; may gather initial evidence. |
| `promoted` | Handed off to discovery-doc or spec-doc; no further action here. |
| `parked` | Deferred for later; preserved but not active. |
| `archived` | Evaluated and not pursued; kept for reference. |
| `superseded` | Replaced by a newer idea document. |

Set `promoted` only after creating the downstream document and linking it in
`relations.derived-by`.

## Resources

- `scripts/new_idea.js`: create an idea document and update its index.
- `references/idea-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for idea documents.
- `assets/templates/idea.md`: default idea document body template.
