---
name: knowledge-doc
description: Use when recording durable knowledge — codebase facts, architecture notes, operational runbooks, or lessons learned — as a canonical document in docs/knowledge/ that other documents can cite via informs/explains relations.
license: MIT
---

# Knowledge Documentation Skill

Use this skill to create durable knowledge documents under `docs/knowledge/`.
A knowledge document records information that stays true beyond a single
change: how a subsystem works, why an architecture looks the way it does, how
to operate a process, or what a lesson learned means for future work.

Knowledge documents are **durable** under Document Registry 3 — they live in
Git as canonical records with their own lifecycle (`draft`, `current`,
`superseded`, `retired`) separate from their type-specific `status`.

**Role boundaries:**

- `idea-doc` captures raw, unformalized signals — not yet knowledge.
- `discovery-doc` structures bounded exploration with source evidence.
- `knowledge-doc` records settled understanding meant to be cited later.
- `briefing-flow` orchestrates information gathering; `knowledge-doc`
  persists the durable result.

## Workflow

1. Check `docs/knowledge/` first.
   When the new fact refines an existing record, update that document (or
   supersede it via `relations.supersedes`) instead of creating a
   near-duplicate.
2. Choose the knowledge kind.
   Every knowledge document declares a top-level `knowledge_kind` field:
   `codebase`, `architecture`, `operation`, or `lesson`.
3. Create the knowledge document.

   **MANDATORY**: Load `references/knowledge-conventions.md` before this
   step — it defines required front matter fields, filename conventions,
   and valid status values.

   Preferred creation command:

   ```bash
   node scripts/new_knowledge.js --title "How the build cache works" \
     --kind codebase --informs docs/designs/0001-cache.md
   ```

   `--kind` is required. `--from`, `--informs`, and `--explains` may be
   repeated to record relations.

   If you cannot run the script, copy `assets/templates/knowledge.md` and
   fill it manually.
4. Record relations.
   Use `relations.source` for where the knowledge came from,
   `relations.informs` for documents this knowledge affects, and
   `relations.explains` for documents it clarifies.
5. Keep status current.
   `draft` while the record is unverified, `confirmed` once reviewed,
   `archived` when kept for reference only, `superseded` when replaced.

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
  tasks, and run outcomes belong to the Execution Store, not the durable
  registry
- NEVER treat `docs/knowledge/README.md` as source of truth — the index is
  a derived, materialized view regenerated via
  `doc_maintenance.js index plan|apply`

## Resources

- `scripts/new_knowledge.js`: create a knowledge document (index
  materialization is explicit: `doc_maintenance.js index plan|apply`).
- `references/knowledge-conventions.md`: directory, filename, status,
  relations, and required-field conventions — **load MANDATORY before any
  create operation**
- `assets/templates/knowledge.md`: default knowledge document body template
  — loaded automatically by `new_knowledge.js`, **do not load manually**
