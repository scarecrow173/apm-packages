---
name: verification-doc
description: Use when recording verification intent — what must be checked, against which contract, and why — as a durable Verification Design document in docs/verification/. Supersedes the legacy test-spec format.
license: MIT
---

# Verification Design Documentation Skill

Use this skill to create durable Verification Design documents under
`docs/verification/`. A Verification Design document records verification
*intent*: what must be checked, which contract or claim it protects, and why
the check exists.

Verification Design documents are **durable** under Document Registry 3 —
they replace the legacy `test-spec` format, which is now a migration-only
artifact. Runnable commands still belong to a task's `## Verification`
section; execution outcomes belong to the Evidence Store.

**Scope note:** the Check contract — `checks[]` entries targeting Claim IDs —
is defined by follow-up work (Knowledge Relations / Evidence issues). This
skill creates the durable container document; do not invent check syntax here.

## Workflow

1. Scan `docs/verification/` and `docs/specs/` first.
   Do not duplicate an existing verification design; supersede it via
   `relations.supersedes` when it is genuinely replaced.
2. Create the Verification Design document.

   **MANDATORY**: Load `references/verification-conventions.md` before this
   step — it defines required front matter fields, filename conventions,
   and valid status values.

   Preferred creation command:

   ```bash
   node scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/checkout-flow.md
   ```

   `--from` and `--supersedes` may be repeated.

   If you cannot run the script, copy `assets/templates/verification.md` and
   fill it manually.
3. Keep status current.
   `draft` while intent is being captured, `proposed` once written,
   `approved` once reviewed, `deprecated` when the check is no longer needed,
   `superseded` when replaced by a newer design.

## Front Matter

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "Checkout total calculation"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  supersedes: []
---
```

Status values: `draft`, `proposed`, `approved`, `deprecated`, `superseded`.
`deprecated` and `superseded` are settled — rows partition into the index's
`## Settled` tier.

## NEVER

- NEVER create `test-spec` documents — `test-spec` is a legacy,
  migration-only type under Registry 3; `new_test_spec.js` refuses at the
  registry gate
- NEVER record pass/fail outcomes in this document — execution results are
  volatile evidence, not durable verification intent
- NEVER treat `docs/verification/README.md` as source of truth — the index
  is a derived view materialized via `doc_maintenance.js index plan|apply`

## Resources

- `scripts/new_verification.js`: create a Verification Design document
  (index materialization is explicit: `doc_maintenance.js index plan|apply`).
- `references/verification-conventions.md`: directory, filename, status,
  and relations conventions — **load MANDATORY before any create operation**
- `assets/templates/verification.md`: default Verification Design body
  template — loaded automatically by `new_verification.js`, **do not load
  manually**
