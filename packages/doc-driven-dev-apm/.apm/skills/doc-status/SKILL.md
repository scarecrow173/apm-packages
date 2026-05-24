---
name: doc-status
description: Use when listing, auditing, or validating document-driven development artifacts, statuses, indexes, and semantic relations.
license: MIT
---

# Document Status Skill

Use this skill to inspect document lifecycle state and relation health across
specs, plans, and tasks. It is report-only by default and should not modify
project files unless a separate creation or index command is used.

## Workflow

1. List documents by type or status.

   ```bash
   node scripts/list_docs.js --type spec
   node scripts/list_docs.js --type task --status in-progress
   ```

2. Audit front matter and relations.

   ```bash
   node scripts/audit_docs.js --type spec
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
