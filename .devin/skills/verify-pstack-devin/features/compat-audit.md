# Compat audit & reference checks

The maintainer proves the shipped docs stay inside the known harness
contract — every API-shaped token is a registered vocabulary entry,
every cross-reference resolves to a real shipped target or a
classified skip kind, and every role label consumers name lives in
`roles.json` — three read-only, fully local audits (`verify:l2`).

## Sub-features

- `audit-vocab` — `audit:compat` classifies `Grep`/`Bash`-style tokens,
  backticked CamelCase, `subagent_type:` values, and agent-profile
  frontmatter keys; an unclassified token is an `unknown` and fails.
- `links-resolve` — `check:links` resolves `](…)` links, backticked
  anchored paths, `/pstack:<skill>`, `pstack:<agent>`, and "the `name`
  skill"/"the `name` principle" mentions against the shipped tree.
- `links-classify` — non-tree refs (URLs, runtime paths, placeholders,
  builtins, other plugins' commands, upstream paths, git refs) are
  counted per skip kind — audited, never silently passed.
- `roles-registry` — `check:roles` extracts role labels from
  role-reference phrasings; consumer labels ⊆ `roles.json` keys and no
  dead keys.

## How to get to it (user POV)

- `pnpm --dir scripts/pstack-devin run audit:compat`.
- `pnpm --dir scripts/pstack-devin run check:links`.
- `pnpm --dir scripts/pstack-devin run check:roles`.
- `pnpm --dir scripts/pstack-devin run verify:l2` — all three in one
  drive.

## Driving it with run-drive

Preconditions:

- Launch complete, `doctor.mjs` exit `0`.
- Fully local and read-only — no network, no fixture, writes nothing.

- **Audit.** `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs scripts/pstack-devin/fixtures/evidence/<run-id> audit:compat`
  → exit `0`; stdout ends `compat audit: <N> files scanned, <F>
  findings, 0 unknowns` (`supported`/`skipped` finding counts are
  informational).
- **Links.** Same with `check:links` → exit `0`; ends `link-check: <N>
  files scanned, <C> refs resolved, <S> skipped (<kind counts>), 0
  broken, 0 unresolved`.
- **Roles.** Same with `check:roles` → exit `0`; ends `role registry:
  <N> consumer docs scanned, <R> roles, <Re> references, 0 unknown, 0
  dead`.
- **Suite.** Same with `verify:l2` → one log, three checks, exit `0`
  only when all pass.
- **Proof.** Logs show each zero-failing-bucket summary and identical
  before/after `git status`.

## Gotchas

- All three scan the COMMITTED `devin-plugin/` tree — after a `build`
  but before its commit they measure the working tree.
- `audit:compat` exits `1` on ANY unknown — a genuinely new upstream
  API is a vocabulary task (add a `compat-vocabulary.ts` row), not a
  scan to weaken.
- `unresolved` ≠ `broken` in `check:links`: unresolved means the
  checker could not classify the ref — the fix is a real target or a
  justified `OUTSIDE_NAMES` row, never a blanket pass.
- `check:roles` `dead` findings mean `roles.json` drifted ahead of the
  docs — prune the registry rather than inventing references.
- The roles registry lives at
  `packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/roles.json`
  (an overlay path, not inside the generated tree) — findings name it
  verbatim.
