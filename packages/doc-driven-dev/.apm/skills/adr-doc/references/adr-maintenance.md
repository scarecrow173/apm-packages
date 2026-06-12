# ADR Maintenance Guidance

For ADR policy and conventions, follow `adr-conventions.md`. This file captures
tool-specific maintenance behavior.

## Safe Defaults

- Reports are safe to run repeatedly.
- `audit_adr.js` does not write files.
- `review_adr.js` does not write files.
- `list_adrs.js` does not write files.
- `check_code_links.js` does not write files.
- `migrate_report.js` does not write files.
- `update_index.js` writes only with `--write`.
- `relate_adr.js` writes only with `--write`.

## Review Focus

- Missing MADR sections.
- Missing or malformed metadata, parsed with `gray-matter` and validated with `zod`.
- Broken `relations` links between ADR files.
- Unresolved template placeholders.
- Local links that no longer resolve.
- Index entries that no longer match ADR files.
- Agent-readiness gaps in Implementation Plan and Verification sections.
- Missing affected paths referenced by Implementation Plan sections.

## Migration Reports

Migration reports should identify what would need human review. They must follow
the mutability rules in `adr-conventions.md`.

## Operational Workflows

### Consult Existing ADRs

Read existing ADRs before implementing changes that touch architecture, data
flow, APIs, infrastructure, dependencies, or cross-cutting conventions.

1. Find the ADR directory and index with `scripts/list_adrs.js` or
   `adr-conventions.md`.
2. Scan titles, statuses, and relations, prioritizing `accepted` ADRs.
3. Read relevant ADRs fully, including Implementation Plan and Verification.
4. Report ADR/code conflicts instead of silently choosing one.
5. Add lightweight ADR references in code comments or PR descriptions only
   where they improve discoverability.

### Update Accepted ADRs

Prefer narrow edits:

- Accept or reject: update status and add final context when needed.
- Deprecate: set status to `deprecated` and explain the replacement path.
- Supersede: create a new ADR and link both ways with `relations`.
- Refine: create or update a related ADR and use `relations.refines`.
- Add learnings: append to `## More Information` with a date stamp.

Validate after edits:

```bash
node scripts/audit_adr.js --dir docs/adr
node scripts/review_adr.js --dir docs/adr
node scripts/update_index.js --dir docs/adr --write
node scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write
```

### Post-Acceptance Lifecycle

After an ADR is accepted:

1. Turn Implementation Plan items and follow-up consequences into trackable
   tasks.
2. Reference the ADR in PRs, for example `Implements ADR-0004`.
3. Add sparse code references at the main implementation entry points.
4. Check Verification items after implementation.
5. Revisit the ADR when its stated revisit conditions fire.

### Index, Bootstrap, and Categories

- Keep ADR index files updated with `node scripts/update_index.js --dir docs/adr --write`.
- If the repo has no ADRs yet, bootstrap with a first ADR such as
  `Adopt architecture decision records`, then replace boilerplate with
  repository-specific context.
- Use subdirectories only when a flat ADR directory becomes hard to scan; keep
  numbering local to each category and document the scheme in the index.

## Script Examples

From the target repo root:

```bash
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --status proposed
node /path/to/adr-doc/scripts/new_adr.js --title "Use local cache" --template minimal
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --template full --dir docs/decisions
node /path/to/adr-doc/scripts/list_adrs.js --dir docs/adr
node /path/to/adr-doc/scripts/audit_adr.js --dir docs/adr
node /path/to/adr-doc/scripts/review_adr.js --dir docs/adr
node /path/to/adr-doc/scripts/check_code_links.js --dir docs/adr
node /path/to/adr-doc/scripts/update_index.js --dir docs/adr --write
node /path/to/adr-doc/scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write
node /path/to/adr-doc/scripts/migrate_report.js --dir docs/adr
```

Notes:

- Scripts auto-detect ADR directory and filename strategy.
- Use `--dir` to override directory detection.
- Use `--json` on reporting scripts when machine-readable output is needed.
- Reporting scripts do not write files by default.
