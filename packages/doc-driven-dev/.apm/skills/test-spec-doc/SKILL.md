---
name: test-spec-doc
description: "Read and migrate the legacy test-spec corpus under docs/test-specs/.
  Migration-only under Document Registry 3 — no normal-run creation path exists;
  durable verification intent records via verification-doc in docs/verification.
  Keywords: test spec, test specification, verifies, docs/test-specs"
license: MIT
---

# Test Spec Documentation Skill

Use this skill to read, audit, and migrate pre-v3 test specifications — as
migration input only. The test spec records the *intent* of verification:
what a test guarantees, why it exists, and when it may be retired. The
document lets humans and coding agents judge what must be preserved when the
spec or design changes, and whether a test is still necessary at all.

## Document Registry v3 status

`test-spec` is a **legacy format** under Document Registry 3: it is
interpreted only by migration tooling (`migrate_docs` / `migrate_ids` in
doc-maintenance) and cannot be created or linted as a durable document.
`docs/test-spec` and `docs/test-specs` are migration-owned scopes.
No `new_test_spec.js` creator ships (Issue #249 removed it) — the only
`test-spec` interpreter left is the registry, whose type name still refuses
on the shared query surface with:

`Document type "test-spec" is a legacy format under Document Registry 3: it is interpreted only by migration tooling and cannot be created or linted as a durable document`

Durable verification intent is now recorded as `verification` documents in
`docs/verification` via the **verification-doc** skill (`new_verification.js`).
The conventions below remain the contract for reading and migrating a pre-v3
`docs/test-specs` corpus; they no longer describe a file this skill mints.

A test spec is not executable Gherkin and not a test result log. It uses the
shared front matter contract plus fixed sections: Purpose, Feature, Rules,
Examples, Guarantees, Non-goals, and Risk. Runnable verification commands
belong to a task's `## Verification` section; execution outcomes belong to
`impl-doc` experiment logs.

## Preconditions

<HARD-GATE>
To create a test spec, at least one upstream document must be recorded in
`relations.verifies` and must resolve to an existing file. A test spec
without a verifiable upstream contract loses its purpose: do not create one.
</HARD-GATE>

## Workflow

1. Scan existing docs before writing.
   Check `docs/specs/`, `docs/designs/`, `docs/test-specs/`, and related
   acceptance criteria so the new test spec does not duplicate an existing
   guarantee.
2. Record the verification intent as a `verification` document.

   Under Document Registry 3 no `new_test_spec.js` creator ships (see
   *Document Registry v3 status* above). Durable verification intent
   lives in `docs/verification` and is created by
   **verification-doc**:

   ```bash
   node ../verification-doc/scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/define-checkout-flow.md
   ```

   `references/test-spec-conventions.md` remains the contract for reading and
   migrating a pre-v3 corpus; `assets/templates/test-spec.md` stays the
   reference structure for the legacy body.
3. Fill every fixed section.
   See `references/test-spec-conventions.md` for what each section must
   answer. Rules and Examples follow the Gherkin `Rule`/`Example` keywords
   but stay prose-readable; they are not step definitions.
4. Link the implementing tasks.
   Tasks that implement the behavior record the test spec in
   `relations.verified-by`. Do not point the test spec's `verifies`
   relation back at tasks; `verifies` always targets the upstream
   contract the test spec protects (spec, design, or ADR).
5. Keep status current.
   Use `draft`, `proposed`, `approved`, `deprecated`, or `superseded`.
   Never record pass/fail in `status`; runtime results are volatile and
   belong to `impl-doc` experiment logs.

## Lifecycle Position

This section describes the **pre-v3 (Registry 2) flow**, retained as
migration context — Registry 3 ships no `test-spec` creation path, so no
normal run performs it. In the pre-v3 `planning-flow`, test specs were
created after plan approval and before task breakdown. They derived from the
approved spec and design — not from task slices — because task boundaries
could change while the guarantees had to hold. When the plan declared no
verifiable behavior, creation was skipped and `test-spec-skip: "<reason>"`
was recorded under `relations:` in the plan front matter — a reason string,
not a link target — so audits could tell a deliberate skip from an omission.

## Required Content

- **Purpose**: why this test spec exists and when it may be retired.
- **Feature**: the behavior under specification.
- **Rules**: invariants or contracts the feature must satisfy.
- **Examples**: concrete scenarios that pin the rules down.
- **Guarantees**: what a correct implementation must guarantee.
- **Non-goals**: behavior or coverage deliberately not verified here.
- **Risk**: what is lost or breaks if these guarantees are dropped.

## Boundary with Other Documents

Verification content exists in several document types; keep each in its lane:

| Document | Verification content | Question it answers |
| --- | --- | --- |
| `spec` | Acceptance Criteria | What must be true for the work to be correct. |
| `test-spec` | Purpose, Feature, Rules, Examples, Guarantees, Non-goals, Risk | Which behaviors are guaranteed and why the test exists. |
| `plan` | Verification / Verification Matrix | Which check proves each implementation step. |
| `task` | Done When / Verification | Which commands must pass for this slice. |
| `design` | Verification Notes | What validates the design before planning. |
| `adr` | Review-checklist Verification | How the decision's success is confirmed. |
| `impl-doc` | Implementation Record / Experiment Log | What was tried and what resulted. |

Rules of thumb:

- Do not copy a spec's acceptance criteria into a test spec verbatim. A test
  spec decomposes them into rules and examples and records *why* each
  guarantee must hold.
- Not every acceptance criterion needs a test spec. Write one where the
  guarantee carries intent that must survive redesigns: boundary rules,
  invariants, or behavior a future change might silently drop.
- A task's `## Verification` holds runnable commands; never move them into a
  test spec. Link the task to the test spec with `relations.verified-by`.

## Resources

- `new_test_spec.js`: *removed* under Registry 3 — `test-spec` is a
  legacy, migration-only format with no creator path. Create verification
  intent via **verification-doc** (`new_verification.js`) instead.
- `references/test-spec-conventions.md`: the legacy corpus contract —
  directory, filename, status, relations, and required content, used by
  migration tooling and for reading pre-v3 files.
- `assets/templates/test-spec.md`: legacy test spec body template — reference
  structure only; no Registry 3 creation path fills it.
