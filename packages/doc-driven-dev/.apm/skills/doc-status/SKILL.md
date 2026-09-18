---
name: doc-status
description: Use when listing, auditing, or validating document-driven development artifacts, statuses, indexes, and semantic relations.
license: MIT
---

# Document Status Skill

Use this skill to inspect document lifecycle state and relation health across
specs, designs, plans, tasks, test specs, and the other canonical document
types. It is report-and-judge only by default and
should not modify project files unless a separate creation or index command is
used.

## Audit Role

This skill acts as the integrity gatekeeper for document-driven development.
Audit results serve the following verdicts:

- **Completable**: No blocking issues → the document set is consistent and traceable.
- **Returned**: Blocking issues found → the affected documents need correction.

Examples of blocking issues:

- Missing required front matter fields (id, type, status, relations)
- Broken internal relations (referenced file does not exist)
- Documents not registered in the index
- Unclassified follow-up items remaining at the `followup-triage` node before
  the `exit-audit` node
- Follow-up tasks missing required upstream relations or dependency links

## Output Contract

Return audit results using this structure:

- `Verdict`: `Completable` or `Returned`
- `Blocking findings`: issues that stop progression
- `Warnings`: non-blocking issues worth fixing
- `Relation errors`: broken internal links or inconsistent relations
- `Index gaps`: missing registry or index coverage
- `Next actions`: the minimum follow-up needed to pass the gate; when
  unclassified follow-up remains, name the smallest return point that can
  classify or repair it

## Workflow

The unified `doc_status.js` entry point exposes four read-only commands.
`list_docs.js` and `audit_docs.js` remain as compatibility wrappers.

1. List documents by type or status.

   ```bash
   node scripts/doc_status.js list --type spec
   node scripts/list_docs.js --type task --status in-progress
   ```

2. Enumerate findings (`lint`) or evaluate the gate summary (`audit`).

   ```bash
   node scripts/doc_status.js lint --type spec --rule broken-link
   node scripts/doc_status.js audit --type plan --json
   node scripts/audit_docs.js --type spec
   ```

3. Aggregate repository-wide health by category.

   ```bash
   node scripts/doc_status.js health
   node scripts/doc_status.js health --json
   ```

   `health` is an aggregate view over the same findings — it is not a second
   scanner and reports no numeric score.

   Shared filters: `--type`, `--dir`, `--rule`, `--severity`,
   `--blocking`, `--status` (list), `--json`, `--external-links`.
   Findings print in deterministic order; exit status is `0` unless the
   invocation itself is invalid.

   Named audits from `doc-driven-dev-graph` map to commands as follows:
   document types (`spec`, `adr`, `design`, `plan`, `task`, `test-spec`,
   `idea`, `brainstorm`, `discovery`) run as
   `audit_docs.js --type <name>`; `all` runs as `audit_docs.js --type all`
   covering every canonical document type; `impl-record` runs as
   `impl-doc/scripts/audit_impl_record.js`.

4. Treat `relations.source` as external evidence.
   HTTP, HTTPS, and mail links are allowed and should not be reported as missing
   local files.
5. Treat `relations.references` as supplementary material.
   Local reference paths should resolve; external references may be URLs.
6. Report broken internal relations, invalid statuses, missing required front
   matter, and missing index entries.

## Audit Coverage

Audits run on a shared document repository model and report every problem with
a stable rule ID. Covered checks include:

- `unparseable-front-matter`, `invalid-front-matter`, `invalid-type`,
  `invalid-status` — front matter and document contract violations.
- `invalid-id-format`, `invalid-id-prefix`, `duplicate-id` — artifact identity
  violations.
- `broken-relation-link`, `ambiguous-relation-target`,
  `relation-escapes-root`, `self-relation`, `inconsistent-reciprocal-relation`
  — semantic relation violations.
- `unresolved-legacy-reference` — body text references to legacy `TYPE-NNNN`
  artifact ids that no artifact provides, including `EXP-NNNN` experiment
  references without a matching numbered `.jsonl` log. Tokens that still
  resolve to an existing artifact or experiment file are not reported, so
  pre-migration repositories stay clean.
- `test-spec-missing-verifies`, `test-spec-invalid-verifies-target`,
  `plan-missing-test-spec-evidence`, `missing-required-relation`,
  `invalid-relation-target-type` — traceability category rules for
  contract-required upstream and verification evidence.
- `provenance-missing-source`, `provenance-invalid-source`,
  `provenance-unresolved-local-source` — `relations.source` provenance.
  Local source paths must resolve inside the repository; external URLs are
  classified as external evidence and only probed with `--external-links`.
- `traceability-missing-upstream` — type-aware upstream expectation.
  Types whose contract expects upstream artifacts (`spec`, `plan`, `task`,
  `design`) warn when no `implements`, `derives-from`, or `refines`
  relation is declared. Root-eligible types and terminal statuses
  (`superseded`, `rejected`, `archived`, `deprecated`, `abandoned`,
  `wont-do`) are exempt.
- `missing-index`, `index-missing-entry`, `index-missing-overview`,
  `missing-overview` — index and directory structure gaps.
- `broken-link`, `missing-image-link`, `broken-anchor`, `link-escapes-root`,
  `link-case-mismatch` — local Markdown link and anchor integrity.
- `index-stale-entry`, `index-duplicate-entry`, `index-metadata-mismatch`,
  `index-ordering`, `index-unparseable`, `index-escapes-root` — index table
  consistency.
- `orphan-index`, `orphan-navigation`, `orphan-relation` — documents not
  listed in the index, unreachable from any Markdown link, or lacking
  semantic relations. Severity is type-aware: types allowed as root
  artifacts report these as `info`, others as `warning`.
- `external-link-broken`, `external-link-redirect`,
  `external-link-unverifiable` — opt-in external link probing via
  `audit_docs.js --external-links`. Disabled by default so audits stay
  deterministic and offline-safe.

Relation targets resolve by unique artifact ID first, then by repository or
document-relative path. Missing relations are never inferred from filenames or
path proximity. Broken link targets and orphan remedies are never inferred
either; they are reported for review or explicit maintenance.

## Read-Only Invariant

`list_docs.js` and `audit_docs.js` never modify project documents. Repairs and
index regeneration are delegated to a separate maintenance capability.

## Resources

- `scripts/doc_status.js`: unified read-only entry point with `list`,
  `lint`, `audit`, and `health` commands, shared filters, and stable JSON
  output over the shared Finding contract.
- `scripts/list_docs.js`: list document metadata by type and status.
- `scripts/audit_docs.js`: validate front matter, statuses, relations, links,
  index coverage, and orphans. `--external-links` enables opt-in external
  link probing.

## Graph Effect Outcome

When `doc-driven-dev-graph` invokes this skill, return exactly the
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.md)
after each audit or delegate effect; do not create a local partial variant.

Use `completed` for a Completable result, `retry` for Returned with declared
repair evidence, and `yield` with `unrecoverable-blocker` for Returned without
a safe repair. The required `edgeId`, stage, effect identity, authoritative
input scope, and proof fields are defined by that footer.
