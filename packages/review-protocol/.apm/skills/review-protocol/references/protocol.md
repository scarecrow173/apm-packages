# Review Protocol

## Overview

Applies when reviewing artifacts: specs, designs, plans, implementations,
code, and documents. The purpose is to find and verify important problems
efficiently — not to idealize the artifact without limit.

Never loop fixes until reviewers have nothing left to say.

## 1. Establish evaluation criteria first

Before reviewing, confirm the artifact's purpose and acceptance criteria.
At minimum, make explicit:

- what the artifact is meant to achieve
- must requirements
- constraints
- assumptions
- consistency requirements with existing specs, designs, and systems
- unacceptable failures
- the scope of this review

If evaluation criteria are unclear, do not invent an ideal on your own.
Treat the unknowns themselves as risks.

## 2. Verify objectively verifiable properties first

Prefer mechanical, deterministic, objective verification over subjective
LLM review. Examples:

- cross-checking against specs and requirements
- schema / format validation
- consistency checks
- computation and data validation
- prototypes and simulation
- build, type check, lint
- automated tests
- static analysis
- security scans
- diff review against existing artifacts

Do not judge by LLM guesswork what can be judged objectively.

## 3. Independent parallel reviewers

Launch at least two independent reviewers in parallel. Reviewers do not
share findings with each other until each one's exploration is complete.

### Reviewer A — cooperative review

Checks whether the artifact achieves its purpose correctly and is
necessary and sufficient. Hunt for:

- mismatches with requirements and purpose
- missing required items
- internal contradictions
- incorrect assumptions
- inconsistency with existing specs, designs, or systems
- feasibility problems
- unnecessary complexity
- design defects that become serious problems in later phases

The goal is judging whether the artifact is acceptable for its current
purpose — not idealizing it. Preferences, taste, and arbitrary improvements
whose concrete impact cannot be explained are not reported as blocking
issues.

### Reviewer B — adversarial review

Asks: "if this artifact fails, how does it fail?" Hunt for:

- edge cases
- failure modes
- implicit assumptions
- boundary conditions
- unexpected usage, input, or state
- contradictions
- security and safety problems
- operational problems
- breakage on extension or integration
- unrecoverable or high-cost failures
- overlooked risks

Every finding must include a concrete **Failure Scenario**. Do not treat
something as a problem merely because "it might be possible" or "it could
be better".

## 4. Reviewers do not confirm problems

Everything a reviewer outputs is an **Issue Candidate**. Each candidate
carries the seven fields defined in `report-format.md`: Claim, Location,
Failure Scenario, Impact, Evidence, Proposed Severity, Validation Method.

Never change the artifact based on a reviewer's claim alone.

## 5. The Validator verifies Issue Candidates

A Validator separate from the reviewers verifies every candidate. Use the
most objective method available for the artifact type:

- cross-checking against primary sources and original requirements
- checking against existing specs
- constructing concrete examples and counterexamples
- computation and simulation
- prototypes
- tests
- running the actual code
- static analysis
- data validation
- checking logical reachability

Classify each candidate:

- `CONFIRMED` — verified against evidence
- `REJECTED` — a false positive; excluded from further processing
- `UNVERIFIED` — could not be sufficiently verified; non-blocking in
  principle, but if the potential impact is severe, surface it to a human
  as an unresolved risk

Deduplicate candidates that share the same root cause before reporting.

## 6. The Judge makes the final call

A Judge — separate from both the reviewers and the Validator — integrates
the verified results:

- evaluates the evidence
- excludes false positives
- deduplicates by root cause
- decides severity
- decides Blocking / Non-blocking

The Judge never starts a new review. If the Judge notices a new problem,
it is not decided on the spot — it becomes a new Issue Candidate routed
to the Validator.

## 7. Severity levels

### P0 — Critical

Accepting the artifact leads to a severe, hard-to-recover failure.

**Blocking**

### P1 — Major

Unmet requirements, serious contradictions, realistic failures, or
important design defects that materially prevent the purpose.

**Blocking**

### P2 — Minor

Limited-scope problems, or improvements that do not prevent the purpose.

**Non-blocking**

### P3 — Nit

Expression, style, preference, optional cleanup or optimization.

**Non-blocking**

Severity is determined by actual impact, not by reviewer confidence.

## 8. Fix only CONFIRMED P0/P1

Automatic fixes are limited to `CONFIRMED P0` and `CONFIRMED P1`. P2/P3
may be recorded and reported, but produce no fix loop unless explicitly
requested.

Fixes are limited to the confirmed root cause — do not expand scope or
attach unrelated improvements.

## 9. Verify the fix

After fixing, run targeted verification first — not a full review:

- is the original problem resolved?
- are the acceptance criteria met?
- did the fix introduce new contradictions or regressions?
- do the relevant objective checks pass?

Do not restart every reviewer from scratch for each small fix. A full
re-review happens only when a fix significantly changed assumptions,
structure, responsibilities, boundaries, or key decisions.

A full review runs at most **two** cycles. If blocking issues still cannot
be resolved, stop the autonomous fix loop and defer to a human.

## 10. Stop conditions

End the review when all of the following hold:

- acceptance criteria are met
- required objective verifications pass
- no unresolved CONFIRMED P0
- no unresolved CONFIRMED P1
- no severe regression caused by the fixes

Remaining P2/P3 do not prevent completion. Do not continue a review only
because "more improvement is possible", "another reviewer might find
something", or "a more ideal form exists". The goal is not zero Issue
Candidates — it is an artifact that meets its purpose and acceptance
criteria with no evidence-confirmed blocking issues remaining.

## 11. Final report

Report concisely (format: `report-format.md`):

- confirmed P0/P1 and their resolutions
- notable rejected false positives
- remaining P2/P3
- validations performed
- residual risk and uncertainty
- final verdict: `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`

Stop when reaching `ACCEPT` or `ACCEPT WITH NON-BLOCKING NOTES`. Do not
start additional review cycles without an explicit request.
