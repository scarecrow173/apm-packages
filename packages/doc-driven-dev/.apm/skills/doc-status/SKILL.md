---
name: doc-status
description: Use when listing, auditing, or validating document-driven development artifacts, statuses, indexes, and semantic relations.
license: MIT
---

# Document Status Skill

Use this skill to inspect document lifecycle state and relation health across
specs, designs, plans, and tasks. It is report-and-judge only by default and
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

1. List documents by type or status.

   ```bash
   node scripts/list_docs.js --type spec
   node scripts/list_docs.js --type design
   node scripts/list_docs.js --type task --status in-progress
   ```

2. Audit front matter and relations.

   ```bash
   node scripts/audit_docs.js --type spec
      node scripts/audit_docs.js --type design
   node scripts/audit_docs.js --type plan --json
   ```

3. Treat `relations.source` as external evidence.
   HTTP, HTTPS, and mail links are allowed and should not be reported as missing
   local files.
4. Treat `relations.references` as supplementary material.
   Local reference paths should resolve; external references may be URLs.
5. Report broken internal relations, invalid statuses, missing required front
   matter, and missing index entries.

## Resources

- `scripts/list_docs.js`: list document metadata by type and status.
- `scripts/audit_docs.js`: validate front matter, statuses, relations, and
  index coverage.
