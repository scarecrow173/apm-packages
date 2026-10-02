# review-protocol

`review-protocol` is an APM package containing a single skill of the same
name. It turns artifact review — specs, designs, plans, implementations,
code, documents — into a bounded, evidence-gated process instead of an
open-ended comment loop.

## Install

Register this repository as a marketplace, then install the package by name:

```bash
apm marketplace add scarecrow173/apm-packages
apm install review-protocol@apm-packages
```

Or reference the monorepo subdirectory directly with a version selector:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/review-protocol#main
```

The distributed skill lives under `.apm/skills/review-protocol/`.

## How it works

1. **Fix the evaluation criteria** — purpose, must requirements,
   constraints, assumptions, unacceptable failures, and scope. Unclear
   criteria become risks, never invented ideals.
2. **Objective checks first** — build, type check, lint, tests, schema
   validation, diff review — before any subjective review.
3. **Two independent reviewers in parallel** — Reviewer A checks the
   artifact is necessary and sufficient for its purpose; Reviewer B hunts
   failure modes. They never see each other's findings mid-review.
4. **Findings are Issue Candidates** — each carries Claim, Location,
   Failure Scenario, Impact, Evidence, Proposed Severity, and Validation
   Method. Nothing changes on a claim alone.
5. **Validator** — a separate role verifies each candidate as `CONFIRMED`,
   `REJECTED`, or `UNVERIFIED` using the most objective method available.
6. **Judge** — a separate role drops false positives, dedupes by root
   cause, assigns severity, and decides blocking.
7. **Fix only CONFIRMED P0/P1** — scoped to the confirmed root cause;
   P2/P3 are reported, not iterated.
8. **Stop** — when acceptance criteria hold and no confirmed blocking
   issues remain. Full re-review is capped at two cycles before human
   escalation.

## Roles

| Role | Responsibility |
| --- | --- |
| Coordinator | Runs the protocol; the agent holding the artifact. |
| Reviewer A | Cooperative review — purpose fit, sufficiency, consistency. |
| Reviewer B | Adversarial review — edge cases, failure modes, hidden assumptions. |
| Validator | Verifies Issue Candidates against evidence. |
| Judge | Integrates verified results; decides severity and blocking. |

## Severity

| Level | Meaning | Blocking |
| --- | --- | --- |
| P0 | Severe, hard-to-recover failure if accepted | Yes |
| P1 | Materially prevents the artifact's purpose | Yes |
| P2 | Limited problem or non-blocking improvement | No |
| P3 | Style, preference, optional cleanup | No |

## Final verdicts

`ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`. Reaching either
`ACCEPT` verdict ends the review; `BLOCKED` escalates to a human.

## Validate

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
