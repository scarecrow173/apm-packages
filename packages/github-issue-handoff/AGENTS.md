# AGENTS.md

Guide for agents maintaining `packages/github-issue-handoff`.

## Scope

This directory is the distributed `github-issue-handoff` APM package: a
documentation-only skill package (no runtime). Distributed assets under
`.apm/` are the authority; there is no generated code to rebuild. Structural
tests live in `scripts/github-issue-handoff/tests/`.

## Localization

Every English document has a `.ja.md` sibling with identical heading
structure and synchronized meaning: `README`, `AGENTS`, `SKILL`, all
`references/*`, and `assets/templates/responder-prompt`. Update both in the
same change.

## Protocol invariants

When editing skill content, preserve:

- **Five mandatory artifacts** — reviewable branch, pushed checkpoint commit,
  handoff Issue, linked Draft PR, rendered Responder prompt shown to the
  user. Issue-only or PR-only handoffs are never complete.
- **Push before Issue** — no local-only handoff; if policy forbids push,
  fail explicitly rather than silently degrading.
- **Closing linkage** — PR body must use `Closes`/`Fixes`/`Resolves #<n>`;
  after merge the Issue's closure is verified, and a completed Issue is
  closed explicitly if auto-close failed. An unmerged PR is never a
  completed handoff.
- **Label contract** — `handoff` plus exactly one of
  `handoff:needs-response` / `handoff:needs-requester` (mutually exclusive),
  plus `handoff:blocking` only when all remaining work is
  response-dependent. Responders are never required to change labels.
- **Responder prompt** — repository-wide (all open `handoff:needs-response`
  Issues, never a single Issue), responder-agnostic (no product, identity,
  or tooling requirements), and rendered+displayed to the user at handoff
  time. `responder-guide` describes the protocol; `responder-prompt` is the
  executable instruction — keep them distinct.
- **Response evaluation** — plain comments are valid responses; responses
  rank below verified repository evidence.

## Validation

From the repository root:

```bash
pnpm --dir scripts/github-issue-handoff test
pnpm --dir scripts/github-issue-handoff run lint:md
```

From this package directory:

```bash
apm compile --dry-run
apm compile --validate
```

Then inspect `git diff --check`.
