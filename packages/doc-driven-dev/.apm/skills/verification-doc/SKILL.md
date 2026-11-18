---
name: verification-doc
description: Use when recording verification intent — what must be checked, against which claim, and by which method — as a durable Verification Design document in docs/verification/ whose checks[] contract targets Claim IDs. Supersedes the legacy test-spec format.
license: MIT
---

# Verification Design Documentation Skill

Use this skill to create and maintain durable Verification Design documents
under `docs/verification/`. A Verification Design document records
verification *intent*: what must be checked, which claim it protects, how
the check is performed, and why the check exists.

Verification Design documents are **durable** under Document Registry 3 —
they replace the legacy `test-spec` format, which is now a migration-only
artifact. Runnable commands still belong to a task's `## Verification`
section; execution outcomes belong to the Evidence Store.

**Check contract (Verification Design v1):** the front-matter `checks:`
array is the sole Check→Claim authority. Each entry is a
`VerificationCheckV1`:

```yaml
checks:
  - id: CHK-01                      # stable, unique per document
    target: SPEC-<id>::R-01         # qualified Claim reference — the only link
    method: unit                    # unit | integration | e2e | property |
                                    # static | model-checking | formal-proof |
                                    # runtime-monitoring | manual-review
    implementation: cart.test.ts::total_sums_lines
    preconditions: [cart has at least one line]
    passCriteria:
      kind: unit                    # must equal `method`
      expect: total equals the sum of line subtotals
    limitations: [rounding beyond 2dp out of scope]
    required: true                  # required checks declare preconditions
```

Check ids (`CHK-<digits>`) are stable across edits and unique inside the
document; the qualified check reference is `VD-<id>::CHK-NN` — what task
`checks` entries and Evidence Records cite. The `checkHighWater`
front-matter field is the durable allocation mark the scripts maintain so
a removed check id is never reissued. `passCriteria.kind` is a typed
discriminant that must equal `method` — each method carries its own
criterion field, so one boolean never flattens different verification
methods. Optional body anchors of the form `<!-- check:CHK-NN -->` bind a
check's id to its prose description.

## Workflow

1. Reuse before creating. Resolve coverage for the claim you want to
   verify:

   ```bash
   node scripts/resolve_verification.js --for-claim SPEC-<id>::R-01
   ```

   Also scan `docs/verification/` and the relevant spec/design. When an
   existing design covers the intent, **update it — do not create a new
   document**. Supersede via `relations.supersedes` only when it is
   genuinely replaced.
2. Update the existing design.

   ```bash
   node scripts/update_verification.js --doc VD-<id> \
     --check '{"target":"SPEC-<id>::R-01","method":"unit",...}' \
     --status proposed
   ```

   `--check` upserts by check id (an idless payload allocates the next
   `CHK-NN`); `--remove-check CHK-NN` deletes a check. `--title`,
   `--status`, `--lifecycle`, `--from`, and `--supersedes` update the
   document's fields in place — check ids are never renumbered.

   **MANDATORY**: Load `references/verification-conventions.md` before any
   write — it defines the full Check schema, the per-method criteria
   fields, filename conventions, and status values.
3. Create a new design only when nothing reusable exists.

   ```bash
   node scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/checkout-flow.md \
     --check '{"target":"SPEC-<id>::R-01","method":"unit",...}'
   ```

   `--check` may be repeated; each payload is validated against the full
   Check schema and its `target` must resolve to a live Claim — an
   unknown Claim ID refuses the write. If you cannot run the script, copy
   `assets/templates/verification.md` and fill it manually.
4. Lint the design.
   `doc_status lint --type verification` reports check issues: duplicate
   or malformed check ids, targets that do not resolve to a declared
   Claim, `passCriteria.kind` contradicting `method`, required checks
   missing preconditions, and body anchors that name no declared check.
5. Keep status current.
   `draft` while intent is being captured, `proposed` once written,
   `approved` once reviewed, `deprecated` when the check is no longer
   needed, `superseded` when replaced by a newer design.

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
checks: []            # VerificationCheckV1 entries — the Check contract
# checkHighWater: N   # script-maintained once ids exist — removed CHK ids are never reissued
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
  registry gate and preflight routes legacy files to migration
- NEVER record pass/fail outcomes in this document — execution results are
  volatile evidence, not durable verification intent
- NEVER duplicate Check→Claim links in `relations` — `checks[].target` is
  the sole authority; the graph derives `checks`/`checked-by` edges and
  any hand-maintained copy is wrong by definition
- NEVER create a new Verification Design when an existing one covers the
  claim — reuse and update it (`resolve_verification.js --for-claim`)
- NEVER renumber or rewrite check ids — `CHK-NN` keys are stable; edits
  keep the id and change only the check's design revision
- NEVER treat `docs/verification/README.md` as source of truth — the index
  is a derived view materialized via `doc_maintenance.js index plan|apply`

## Resources

- `scripts/new_verification.js`: create a Verification Design document —
  `--check '<json>'` appends schema-validated checks (index
  materialization is explicit: `doc_maintenance.js index plan|apply`).
- `scripts/update_verification.js`: update an existing design's fields and
  checks in place — `--check` upserts by id, `--remove-check` deletes.
- `scripts/resolve_verification.js`: read-only resolution — `--for-claim`
  for reuse-first coverage lookup, `--doc` for a design's check inventory,
  `--ref` for the `VD-<id>::CHK-NN` check-reference boundary task `checks`
  entries and Evidence Records use.
- `references/verification-conventions.md`: directory, filename, status,
  relations, and the full Check schema — **load MANDATORY before any
  create or update operation**
- `assets/templates/verification.md`: default Verification Design body
  template — loaded automatically by `new_verification.js`, **do not load
  manually**
