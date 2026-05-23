# MADR 4.0.0 Reference

This skill uses MADR 4.0.0 as the ADR template baseline.

## Sources

- Homepage: <https://adr.github.io/madr/>
- Repository: <https://github.com/adr/madr>
- 4.0.0 template directory: <https://github.com/adr/madr/tree/4.0.0/template>
- 4.0.0 release: <https://github.com/adr/madr/releases/tag/4.0.0>

## Version

- MADR version: 4.0.0
- Release date: 2024-09-17

## License

The MADR project states that its work is dual-licensed under:

- MIT
- CC0-1.0

SPDX expression: `MIT OR CC0-1.0`

This package is MIT licensed. MADR-derived template content keeps this source
and license note so consumers can trace the template origin.

## Template Mapping

- `assets/templates/madr-4-full.md` is based on `adr-template.md`.
- `assets/templates/madr-4-minimal.md` is based on `adr-template-minimal.md`.
- `assets/templates/madr-4-bare.md` is based on `adr-template-bare.md`.
- `assets/templates/madr-4-bare-minimal.md` is based on `adr-template-bare-minimal.md`.

The package templates replace original placeholder style with script-friendly
tokens such as `{{title}}`, `{{number}}`, `{{date}}`, and `{{status}}`.

## Package Extension: ADR Relations

This package adds an optional `relations` block to the YAML front matter. This
is not part of upstream MADR 4.0.0. It is a package-level extension for
machine-readable ADR relationships.

The field structure and usage rules are defined in `adr-conventions.md`.
