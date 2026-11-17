---
name: knowledge-doc
description: Use when consolidating durable knowledge — codebase facts, architecture notes, operational runbooks, or lessons learned — into docs/knowledge/, preferring search/update/integrate of existing documents over creating new ones.
license: MIT
---

# Knowledge Documentation Skill

Use this skill to consolidate durable knowledge under `docs/knowledge/`.
A knowledge document records information that stays true beyond a single
change: how a subsystem works, why an architecture looks the way it does, how
to operate a process, or what a lesson learned means for future work.

Knowledge documents are **durable** under Document Registry 3 — they live in
Git as canonical records with their own lifecycle (`draft`, `current`,
`superseded`, `retired`) separate from their type-specific `status`.

**Role boundaries:**

- `idea-doc` captures raw, unformalized signals — not yet knowledge.
- `discovery-doc` structures bounded exploration with source evidence.
- `knowledge-doc` consolidates settled understanding — **integration into
  existing documents before creation**; a `none` decision (nothing worth
  persisting) is a valid outcome.
- `briefing-flow` orchestrates information gathering; `knowledge-doc`
  persists the durable result.

## Workflow

**MANDATORY** for implementation findings: load
`references/knowledge-extraction.md` — it defines what counts as durable
knowledge (rationale, recurrence prevention, confirmed constraints and
properties — never timelines, command logs, or chat records) and the full
decision contract.

1. Decide whether anything is worth persisting.
   A normal implementation change completes with **no** new documents —
   IR/EXP/Knowledge creation is never forced. If important findings remain
   unorganized, report them to the run's exit gate instead of silently
   completing.
2. Assess before creating.
   `consolidate_knowledge.js assess --title "…" --kind <kind>` screens every
   durable directory and reports candidates (`integrate` for knowledge,
   owning-skill routes for spec/design/ADR), conflicts, and the gate.
3. Choose exactly one decision via `consolidate_knowledge.js apply
   --decision <d>` (full flag contract in the conventions reference):
   - `integrate` — merge into an existing knowledge document (`--into`
     required); preferred whenever an existing record can carry the finding.
   - `route` — the finding belongs to spec/design/ADR etc.: consolidation
     writes nothing; apply through that type's owning skill.
   - `create` — only when nothing existing can carry it; refuses until every
     reported conflict is passed via `--acknowledge` — review is mandatory,
     duplicates are never added unconditionally.
   - `none` — persist nothing.
   Every persist path requires `--from` (extraction source) and `--basis`
   (evidence) — both are recorded.
4. Direct ad-hoc creation (user-requested, not extraction) still uses
   `new_knowledge.js --title "…" --kind <kind>`; `--kind` is required and
   `--status confirmed` requires `--from` provenance.
5. Keep status current.
   `draft` while the record is unverified, `confirmed` once reviewed
   (requires recorded provenance), `archived` when kept for reference only,
   `superseded` when replaced (`--supersedes` on the successor).

## Front Matter

```yaml
---
id: "KNOW-<22-char base62>"
type: "knowledge"
status: "draft"
lifecycle: "draft"
knowledge_kind: "codebase"
title: "How the build cache works"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  informs: []
  explains: []
  supersedes: []
---
```

Status values: `draft`, `confirmed`, `archived`, `superseded`.
`archived` and `superseded` are settled — rows partition into the index's
`## Settled` tier.

## NEVER

- NEVER drop `knowledge_kind` — it is a required top-level field; the lint
  contract rejects documents without it
- NEVER record volatile execution state in a knowledge document — plans,
  tasks, run outcomes, command logs, and chat-like work records belong to
  the Execution Store / run trace, not the durable registry
- NEVER create while `assess` reports unacknowledged conflicts — review each
  duplicate/contradiction candidate and pass `--acknowledge`
- NEVER write into a spec, design, or ADR through this skill — consolidation
  routes those changes to their owning skills
- NEVER save an unverified guess as `confirmed` — recorded provenance
  (`--from`/`--basis`) is required
- NEVER treat `docs/knowledge/README.md` as source of truth — the index is
  a derived, materialized view regenerated via
  `doc_maintenance.js index plan|apply`

## Resources

- `scripts/consolidate_knowledge.js`: consolidation entrypoint — `assess`
  (read-only screening) and `apply --decision none|route|integrate|create`.
- `scripts/new_knowledge.js`: create a knowledge document directly (index
  materialization is explicit: `doc_maintenance.js index plan|apply`).
- `references/knowledge-extraction.md`: the extraction and consolidation
  decision contract — **load MANDATORY when persisting implementation
  findings**
- `references/knowledge-conventions.md`: directory, filename, status,
  relations, CLI, and required-field conventions — **load MANDATORY before
  any create/integrate operation**
- `assets/templates/knowledge.md`: default knowledge document body template
  — loaded automatically by `new_knowledge.js`, **do not load manually**
