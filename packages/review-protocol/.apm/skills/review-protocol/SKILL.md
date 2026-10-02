---
name: review-protocol
description: Use when reviewing a spec, design, plan, implementation, code, or document before accepting it — especially when a missed defect is expensive, when reviews tend to rubber-stamp or nitpick without end, or when findings need evidence before they justify changes. Not for trivial changes that a diff read, linter, type check, or test run already settles.
license: MIT
---

# Review Protocol

A bounded, evidence-gated protocol for reviewing artifacts — specs, designs,
plans, implementations, code, and documents. The goal is to find and verify
important problems efficiently, not to iterate until reviewers run out of
comments.

- **Coordinator**: the agent running the review — fixes evaluation criteria,
  dispatches reviewers, routes candidates, applies approved fixes, decides
  when to stop.
- **Reviewer A / Reviewer B**: two independent reviewers who explore different
  failure space and never see each other's findings before finishing.
- **Validator**: a separate role that verifies each Issue Candidate against
  objective evidence.
- **Judge**: a separate role that integrates verified results and decides
  severity and blocking status.

Dispatch the roles as independent subagents where the runtime supports it;
otherwise run them as clearly separated passes. Never collapse Reviewer,
Validator, and Judge into a single actor.

## When to Use

- reviewing an artifact against explicit acceptance criteria before sign-off
- high-stakes artifacts where a missed blocking defect is expensive
- review loops that risk endless polish or unverified findings

Do NOT use for:

- trivial changes a diff read, linter, type check, or test run settles
- open-ended improvement with no acceptance criteria — define criteria first
- style preferences with no concrete failure scenario

## Lifecycle

1. **Fix the evaluation criteria** — purpose, must requirements, constraints,
   assumptions, consistency requirements, unacceptable failures, scope.
   Unclear criteria are themselves risks; do not invent ideals.
2. **Objective checks first** — run every mechanical, deterministic check
   available (spec diff, schema validation, build, type check, lint, tests,
   static analysis) before any subjective review.
3. **Dispatch at least two independent reviewers in parallel** — Reviewer A
   (cooperative) and Reviewer B (adversarial). Their output is Issue
   Candidates only.
4. **Validate every candidate** — the Validator classifies each as
   `CONFIRMED`, `REJECTED`, or `UNVERIFIED`. `REJECTED` is dropped;
   `UNVERIFIED` is non-blocking unless the potential impact is severe —
   then escalate to a human.
5. **Judge** — evaluate evidence, drop false positives, dedupe by root
   cause, assign severity `P0`–`P3`, decide Blocking / Non-blocking.
6. **Fix only CONFIRMED P0/P1** — scoped to the confirmed root cause.
   P2/P3 are reported, not iterated.
7. **Re-verify the fix** — targeted checks only; a full re-review happens
   at most two cycles, only when a fix changed assumptions, structure,
   responsibilities, boundaries, or key decisions.
8. **Stop** — when acceptance criteria hold and no unresolved CONFIRMED
   P0/P1 remain. Emit the final report with verdict `ACCEPT`,
   `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`.

## Invariants

- A reviewer's claim never modifies the artifact — only a Validator's
  `CONFIRMED` verdict authorizes a fix.
- Automatic fixes are limited to CONFIRMED P0/P1; P2/P3 produce no fix loop
  unless explicitly requested.
- Every Issue Candidate carries a concrete Failure Scenario — "this could
  be better" is not an issue.
- Severity is decided by actual impact, never by reviewer confidence.
- Full re-review is capped at two cycles; unresolved blocking issues after
  that are escalated to a human, not retried forever.
- The Judge never starts a new review on its own — new observations become
  new Issue Candidates routed to the Validator.
- The goal is no remaining evidence-confirmed blocking issues — not zero
  comments.

## References

- `references/protocol.md` — the full eleven-phase protocol: evaluation
  criteria, objective checks, reviewer scopes, validation, judgment,
  severity, fix scope, re-verification, stop conditions, final report.
- `references/report-format.md` — the Issue Candidate field contract,
  verdict and severity definitions, and the final report format.
