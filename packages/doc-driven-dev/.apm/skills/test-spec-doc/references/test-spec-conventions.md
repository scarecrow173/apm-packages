# Test Spec Conventions

These conventions define how `test-spec-doc` creates, audits, indexes, and
links test specification documents.

A test spec records the intent of verification: what a test guarantees, why
it exists, and when it may be retired. It is not executable Gherkin and not
a test result log — it is the durable contract a coding agent consults when
deciding which behavior must survive a spec or design change, and whether a
test is still necessary.

## Directory

If a repository already has a test spec directory, keep it. Do not move
existing test specs just to match this package's defaults.

When no test spec directory exists, use `docs/test-specs/` by default.

Detection order used by scripts:

1. `docs/test-specs/`
2. `docs/test-spec/`
3. `test-specs/`
4. `test-spec/`

## Filenames

Default filename pattern:

```text
title-with-dashes.md
```

Rules:

- Filenames are slug-only: lowercase ASCII words separated by dashes.
- Name the guaranteed behavior, not the test file or suite.
- Examples: `checkout-total-calculation.md`, `session-expiry.md`.

Document identity lives in the front matter `id`, not in the filename or its
sort position. Existing `NNNN-<slug>.md` filenames remain valid, but new
documents always use slug-only names. Run `migrate_ids.js` under `doc-driven-dev-graph/scripts` to upgrade existing files.

## Required Front Matter

Test specs use the shared document front matter with `type: "test-spec"` and
IDs prefixed `TSPEC-`:

```yaml
---
id: "TSPEC-6NbVcXzAsDfGhJkLpOiUyT"
type: "test-spec"
status: "draft"
title: "Checkout total calculation"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  verifies: []
  verified-by: []
  derives-from: []
---
```

All shared relation fields are available; the ones above carry the
contract's core semantics.

## Status Values

| Status | Meaning |
| --- | --- |
| `draft` | Being written or refined. |
| `proposed` | Ready for review but not approved. |
| `approved` | Accepted as verification intent for implementation. |
| `deprecated` | No longer needed; kept as history of why it existed. |
| `superseded` | Replaced by a newer test spec. |

Do not record runtime pass/fail in `status`. Test outcomes are volatile;
record them in `impl-doc` experiment logs or CI evidence instead.

## Relations

| Field | Meaning |
| --- | --- |
| `verifies` | Specs, designs, or ADRs whose behavior this test spec verifies. At least one entry is required (TEST-SPEC-DOC-GATE-001). |
| `verified-by` | Tasks or test specs that verify this document, when applicable. |
| `derives-from` | Specs or designs this test spec elaborates into verifiable guarantees. |
| `depends-on` | Documents that must remain valid for this test spec to hold. |
| `supersedes` / `superseded-by` | Replacement links between test specs. |
| `related` | Contextual docs without directional dependency. |

Tasks that implement the behavior should point back with their own
`verified-by` relation to this test spec.

Relation targets may be written as repo-relative paths or document IDs
(`TSPEC-<id>` style). `doc-status` audits warn when a `verifies` target
resolves to a document type other than spec, design, or ADR
(`test-spec-invalid-verifies-target`), and when an approved, in-progress,
or completed plan neither links a test spec via `verified-by` nor records
`test-spec-skip` (`plan-missing-test-spec-evidence`).

## Required Content

Every test spec uses the fixed sections from the template:

| Section | Must answer |
| --- | --- |
| `Purpose` | Why this test spec exists, which intent it preserves, and when it may be retired. |
| `Feature` | The behavior under specification, named like a Gherkin Feature. |
| `Rules` | Invariants or contracts the feature must satisfy. |
| `Examples` | Concrete scenarios pinning the rules down. Given/When/Then phrasing is allowed but not required; step-definition executability is not a goal. |
| `Guarantees` | What a correct implementation must guarantee. |
| `Non-goals` | Behavior or coverage this spec deliberately does not verify. |
| `Risk` | What is lost or breaks if these guarantees are dropped. |

`Purpose`, `Non-goals`, and `Risk` are what let a future agent judge whether
the test is still necessary after a large design or spec change. Do not leave
them empty.

## Boundary with Other Documents

Verification content is split across document types. A test spec owns the
*intent* of verification; the others own their own slice:

| Document | Owns | Does not own |
| --- | --- | --- |
| `spec` | Acceptance criteria — what must be true. | Why a specific guarantee matters or when it may be retired. |
| `plan` | Per-step verification commands (Verification Matrix). | Behavior-level guarantees independent of step slicing. |
| `task` | Runnable `## Verification` commands for the slice. | The durable intent behind the guarantee. |
| `design` | Verification Notes that validate the design itself. | Post-implementation behavior guarantees. |
| `adr` | Decision confirmation checks. | Ongoing behavior verification. |
| `impl-doc` | What was tried and what resulted (ir/exp). | The contract that should have held beforehand. |
| `test-spec` | Why the test exists, what it guarantees, when it may be retired. | Runnable commands and execution results. |

If a guarantee can be checked without preserving its intent — a trivial
acceptance criterion, a one-off manual check — keep it in the spec or task
instead of creating a test spec.

## Mutability

- `draft` and `proposed` test specs may be edited freely.
- `approved` test specs may receive clarifications that do not change the
  guaranteed behavior.
- When the guarantee itself changes, prefer a new test spec or an explicit
  `supersedes`/`superseded-by` pair over rewriting approved intent.
- Mark a test spec `deprecated` rather than deleting it when the guarantee is
  dropped; the record of why it existed is the point.

## Index

Use `README.md` as the default index. List test specs as a Markdown table, in
filename order, with the four shared columns:

| ID | Title | Status | File |
| --- | --- | --- | --- |
| TSPEC-6NbVcXzAsDfGhJkLpOiUyT | Checkout total calculation | approved | [checkout-total-calculation.md](checkout-total-calculation.md) |
