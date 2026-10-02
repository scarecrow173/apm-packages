# AGENTS.md

Guide for agents maintaining `packages/review-protocol`.

## Scope

This directory is the distributed `review-protocol` APM package: a
documentation-only skill package (no runtime). Distributed assets under
`.apm/` are the authority; there is no generated code to rebuild.
Structural tests live in `scripts/review-protocol/tests/`.

## Localization

Every English document has a `.ja.md` sibling with identical heading
structure and synchronized meaning: `README`, `AGENTS`, `SKILL`, and all
`references/*`. Update both in the same change.

## Protocol invariants

When editing skill content, preserve:

- **Evidence gate** — reviewer output is Issue Candidates only; the
  artifact is never modified on a claim alone. Only a Validator's
  `CONFIRMED` verdict authorizes a fix.
- **Role separation** — at least two independent reviewers (A cooperative,
  B adversarial) in parallel with no cross-talk before exploration
  completes; Validator and Judge are separate roles and never start a
  review on their own initiative.
- **Issue Candidate contract** — every candidate carries Claim, Location,
  Failure Scenario, Impact, Evidence, Proposed Severity, and Validation
  Method; a candidate without a concrete Failure Scenario is not an issue.
- **Severity contract** — P0/P1 blocking, P2/P3 non-blocking; severity by
  actual impact, never by reviewer confidence.
- **Bounded iteration** — automatic fixes only for CONFIRMED P0/P1, scoped
  to the confirmed root cause; full re-review capped at two cycles, then
  human escalation.
- **Stop conditions** — done means acceptance criteria met + objective
  checks pass + no unresolved CONFIRMED P0/P1; leftover P2/P3 never block.
- **Verdict contract** — the final verdict is exactly one of `ACCEPT`,
  `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`.
- **Harness neutrality** — the skill never requires a specific product,
  runtime, or subagent mechanism and never names AI products.

## Validation

From the repository root:

```bash
mise exec -- pnpm --dir scripts/review-protocol test
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

From this package directory:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```

Then inspect `git diff --check`.
