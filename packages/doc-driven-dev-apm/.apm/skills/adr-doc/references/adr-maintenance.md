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
