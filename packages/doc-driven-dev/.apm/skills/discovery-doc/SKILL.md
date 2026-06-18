---
name: discovery-doc
description: Use when recording exploration results, issue framing, alternative comparisons, gap analysis, or hypothesis notes from briefing as a structured canonical document in docs/discovery/. Produces the source artifact that spec-doc and adr-doc derive from. Not a replacement for briefing-flow, which orchestrates; discovery-doc generates the document.
license: MIT
---

# Discovery Documentation Skill

Use this skill to create structured discovery documents under `docs/discovery/`.
A discovery document captures the intermediate output of a briefing or
exploration phase: exploration goals, key issues, alternative comparisons,
tentative conclusions, open questions, and candidates for promotion to
`spec-doc` or `adr-doc`.

**Role boundary with `briefing-flow`**: `briefing-flow` is the orchestrator —
it drives the information gathering process and decides which skills to invoke.
`discovery-doc` is the document generator — it creates the formal, front-matter
record of what was learned. Run `briefing-flow` first; invoke `discovery-doc`
to persist exploration outputs as a canonical artifact.

## Workflow

1. Scan existing docs before creating a new one.
   Use the directory and naming rules in `references/discovery-conventions.md`.
   Check `docs/discovery/`, `docs/specs/`, and `docs/adr/` to avoid duplicate
   exploration or contradicting existing conclusions.
2. Confirm the exploration scope with the human.
   Confirm the trigger, the open question being answered, what alternatives
   were considered, and what research evidence exists.
3. Create the discovery document.
   Preferred creation command:

   ```bash
   node scripts/new_discovery.js --title "Explore auth strategy options"
   ```

   The creation script uses `assets/templates/discovery.md`. If you cannot run
   the script, copy that template and fill it manually.

4. Record meaningful relations in YAML front matter.
   Use `relations.source` for external evidence, research reports, and issue
   links that prompted the exploration.
   Use `relations.derived-by` to point forward to specs or ADRs that were
   written from this discovery.
   Use `relations.related` for contextual docs without directional dependency.
5. Promote conclusions to downstream documents.
   When the exploration reaches a tentative conclusion, create `spec-doc` or
   `adr-doc` entries and link them via `relations.derived-by` in this document.
   Update status to `resolved` once all promotion candidates are addressed.

## Required Content

A discovery document should answer:

- What exploration goal or open question does this document address?
- What constraints (technical, product, policy, timeline) apply?
- What alternatives were considered, and what are their trade-offs?
- What tentative conclusions or hypotheses emerged?
- What open questions remain unresolved?
- Which downstream documents (spec, ADR, design) should be created from this?
- What research evidence or external sources support these conclusions?

Discovery documents intentionally cover intermediate reasoning, not final
decisions. Final decisions belong in ADRs. Final requirements belong in specs.

## Front Matter

Generated discovery documents use YAML front matter:

```yaml
---
id: "DISC-0001"
type: "discovery"
status: "draft"
title: "Explore auth strategy options"
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

Status values: `draft`, `active`, `resolved`, `archived`, `superseded`.

## Status Lifecycle

| Status | Meaning |
| --- | --- |
| `draft` | Exploration in progress; conclusions not yet stable. |
| `active` | Exploration is underway; being actively updated. |
| `resolved` | Conclusions promoted to spec-doc or adr-doc; no further work needed. |
| `archived` | Exploration halted without promotion; preserved for reference. |
| `superseded` | Replaced by a newer discovery document. |

Discovery documents are not approved or implemented. `resolved` signals that
the useful output has been captured in downstream documents. Link those
documents in `relations.derived-by` before setting `resolved`.

## Review Checklist

Before moving a discovery document from `draft` to `active` or `resolved`,
verify every item below. A discovery document that fails a gate needs
revision before being promoted to spec or ADR.

| # | Gate | Pass criteria |
|---|------|---------------|
| 1 | **Exploration goal stated** | The open question or trigger is concrete, not vague. |
| 2 | **Alternatives compared** | At least two options are described with trade-offs. |
| 3 | **Tentative conclusion present** | At least one hypothesis or working conclusion is documented. |
| 4 | **Open questions listed** | Remaining unknowns are explicit so they can be tracked. |
| 5 | **Source evidence linked** | External research, issue links, or user input is recorded in `relations.source`. |
| 6 | **Promotion candidates identified** | It is clear whether a spec, ADR, or neither is needed. |
| 7 | **No final decision included** | Architecture decisions belong in ADRs, requirements in specs. |
| 8 | **Status correct** | Front matter `status` reflects the actual exploration state. |

## Relationship with spec-doc and adr-doc

In this package's lifecycle, discovery documents are the upstream source for
spec and ADR creation. They are not required for every feature — skip discovery
when the requirements are already clear. Use discovery when the problem space
is ambiguous, alternatives exist, or significant research was done.

- **Discovery produces a spec**: when the exploration clarifies product intent,
  create a `spec-doc` and link it via `relations.derived-by` in the discovery
  document.
- **Discovery produces an ADR**: when the exploration resolves an architecture
  decision, create an `adr-doc` and link it in `relations.derived-by`.
- **Discovery produces both**: when briefing reveals both product requirements
  and technical decisions, create spec and ADR in parallel and link both.
- **No promotion needed**: when exploration ends without actionable output,
  set status to `archived`.

The upstream link: spec and ADR use `relations.derives-from` to point back to
the discovery document that produced them.

## Resources

- `scripts/new_discovery.js`: create a discovery document and update its index.
- `references/discovery-conventions.md`: directory, filename, status, relations,
  required content, and index conventions for discovery documents.
- `assets/templates/discovery.md`: default discovery document body template.
