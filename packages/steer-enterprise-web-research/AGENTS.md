# AGENTS.md

This file is a practical guide for AI agents modifying `packages/steer-enterprise-web-research`.

## 1. Scope

- Paths in this document are repository-root-relative unless a command block says otherwise.
- Distributed package assets live under `packages/steer-enterprise-web-research/`.
- Build workspace code and tests live under `scripts/steer-enterprise-web-research/`.

## 2. Responsibility Boundaries

- Edit distributed package files in:
  - `packages/steer-enterprise-web-research/.apm/**`
  - `packages/steer-enterprise-web-research/README.md`
  - `packages/steer-enterprise-web-research/README.ja.md`
  - `packages/steer-enterprise-web-research/apm.yml`
- Edit audit-script source and tests in:
  - `scripts/steer-enterprise-web-research/src/**`
  - `scripts/steer-enterprise-web-research/build/**`
  - `scripts/steer-enterprise-web-research/tests/**`
- Generated audit-script output is:
  - `packages/steer-enterprise-web-research/scripts/research_audit.js`

## 3. Workflow

1. Read the package README and distributed `.apm/` files first.
2. If behavior changes, edit `scripts/steer-enterprise-web-research/src` first.
3. Regenerate the distributed audit script with `pnpm --dir scripts/steer-enterprise-web-research build`.
4. Run `pnpm --dir scripts/steer-enterprise-web-research test`.
5. If package-facing behavior or usage changes, update `packages/steer-enterprise-web-research/README.md` and `README.ja.md` in the same change.

## 4. Commands

Run from the repository root:

```bash
pnpm --dir scripts/steer-enterprise-web-research build
pnpm --dir scripts/steer-enterprise-web-research test
```

Run these from `packages/steer-enterprise-web-research/` when validating the APM package itself:

```bash
apm compile --dry-run
apm compile --validate
apm pack --archive -o dist
```

## 5. Checklist

- Updated distributed `.apm/` docs when user-facing behavior changed.
- Rebuilt `packages/steer-enterprise-web-research/scripts/research_audit.js` after source changes.
- Ran `pnpm --dir scripts/steer-enterprise-web-research test`.
- Kept `README.md` and `README.ja.md` aligned in meaning and structure.
