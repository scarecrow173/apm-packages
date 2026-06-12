# Review Gate Contract

## Purpose

The Phase E review gate in `implementation-flow` ensures that all tasks pass verification before code is integrated. This contract specifies the canonical review skill to prevent naming drift and maintain integration stability.

## Canonical Review Skill

**Official Skill Name**: `requesting-code-review`

This skill is the authoritative implementation for Phase E review gatekeeping. All references to the Phase E review workflow must resolve to this skill name.

## Canonical Location

- **Primary**: `packages/doc-driven-dev/.apm/skills/requesting-code-review/SKILL.md`
- **Alternative Context**: External environment skills (e.g., from apm_modules or agent-toolkit)

## Contract Binding

1. **Immutable Name**: The skill name `requesting-code-review` is a stable contract. Changes require a deprecation notice and migration path.
2. **Phase E Responsibility**: Phase E of `implementation-flow` explicitly invokes `requesting-code-review` for review gate enforcement.
3. **Skill Discovery**: The `skill-discovery-protocol` resolves this skill by exact name match before attempting fuzzy discovery.
4. **Failure Mode**: If the skill cannot be discovered, Phase E must fail fast with a clear error message identifying the missing skill by canonical name.

## References

- [implementation-flow SKILL.md](../SKILL.md) - Phase E documentation
- [skill-discovery-protocol SKILL.md](../skill-discovery-protocol/SKILL.md) - Skill resolution semantics

## Testing

Regression tests ensure:
- Canonical name resolution does not drift.
- Phase E can locate the skill without ambiguity.
- Integration failures are traceable to skill availability, not naming confusion.

See: `scripts/doc-driven-dev/tests/integration/review-gate-contract.test.ts`

## Amendments

**Last Updated**: (Date of this commit)
**Amendment Count**: 0
**Status**: Active
