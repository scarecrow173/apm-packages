---
name: test-spec-doc
description: Use when recording what a test must guarantee and why, as a canonical test specification document with Feature/Rule/Example structure linked to the specs, designs, or ADRs it verifies.
license: MIT
---

# Test Spec Documentation Skill

Use this skill to write test specifications that record the *intent* of
verification: what a test guarantees, why it exists, and when it may be
retired. The document lets humans and coding agents judge what must be
preserved when the spec or design changes, and whether a test is still
necessary at all.

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
2. Create the test spec.

   ```bash
   node scripts/new_test_spec.js --title "Checkout total calculation" \
     --verifies docs/specs/0001-define-checkout-flow.md \
     --derives-from docs/designs/0001-checkout-design.md
   ```

   `--verifies` may be repeated and each target must exist
   (TEST-SPEC-DOC-GATE-001). Use `--derives-from` when the test spec
   elaborates a specific spec or design. The creation script uses
   `assets/templates/test-spec.md`; if you cannot run it, copy the template
   and fill it manually.
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

Inside `planning-flow`, test specs are created after plan approval and before
task breakdown. They derive from the approved spec and design — not from task
slices — because task boundaries may change while the guarantees must hold.

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

- `scripts/new_test_spec.js`: create a test spec and update its index.
- `references/test-spec-conventions.md`: directory, filename, status,
  relations, required content, and index conventions for test specs.
- `assets/templates/test-spec.md`: default test spec body template.
