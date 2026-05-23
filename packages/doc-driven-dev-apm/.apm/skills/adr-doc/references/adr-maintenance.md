# ADR Maintenance Guidance

For ADR policy and conventions, follow `adr-conventions.md`. This file captures
tool-specific maintenance behavior.

## Safe Defaults

- Reports are safe to run repeatedly.
- `audit_adr.ts` does not write files.
- `migrate_report.ts` does not write files.
- `update_index.ts` writes only with `--write`.

## Review Focus

- Missing MADR sections.
- Missing or malformed metadata.
- Broken `relations` links between ADR files.
- Unresolved template placeholders.
- Local links that no longer resolve.
- Index entries that no longer match ADR files.

## Migration Reports

Migration reports should identify what would need human review. They must follow
the mutability rules in `adr-conventions.md`.
