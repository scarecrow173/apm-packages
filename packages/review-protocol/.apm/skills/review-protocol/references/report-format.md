# Report Format

Contracts for the artifacts passed between the roles — Reviewer A,
Reviewer B, Validator, Judge, and the Coordinator — in the review
protocol.

## Issue Candidate

Every reviewer finding is an **Issue Candidate** — a hypothesis, not a
confirmed problem. Required fields:

| Field | Content |
| --- | --- |
| Claim | What is wrong, in one sentence. |
| Location | Where in the artifact the problem lives (file, section, line). |
| Failure Scenario | A concrete description of how this fails in practice. |
| Impact | What happens if the artifact is accepted as-is. |
| Evidence | The basis for the claim — quotes, diffs, reproduction, references. |
| Proposed Severity | The reviewer's suggested severity (P0–P3). |
| Validation Method | How the claim can be checked objectively. |

A candidate without a concrete Failure Scenario is not an issue — send it
back or drop it. The artifact is never modified on a reviewer's claim
alone.

## Validator Verdicts

| Verdict | Meaning | Disposition |
| --- | --- | --- |
| CONFIRMED | Verified against evidence. | Enters severity judgment; P0/P1 are blocking. |
| REJECTED | False positive. | Excluded from further processing. |
| UNVERIFIED | Cannot be sufficiently verified. | Non-blocking in principle; escalate to a human if the potential impact is severe. |

Deduplicate candidates that share the same root cause before reporting
verdicts.

## Severity Levels

| Severity | Meaning | Blocking |
| --- | --- | --- |
| P0 — Critical | Accepting the artifact leads to a severe, hard-to-recover failure. | Blocking |
| P1 — Major | Unmet requirements, serious contradictions, realistic failures, or important design defects that materially prevent the purpose. | Blocking |
| P2 — Minor | Limited-scope problems, or improvements that do not prevent the purpose. | Non-blocking |
| P3 — Nit | Expression, style, preference, optional cleanup or optimization. | Non-blocking |

Severity is assigned by actual impact — never by reviewer confidence.

## Final Verdicts

- `ACCEPT` — the artifact meets its acceptance criteria and no unresolved
  CONFIRMED P0/P1 remain.
- `ACCEPT WITH NON-BLOCKING NOTES` — same, with P2/P3 findings recorded.
- `BLOCKED` — unresolved CONFIRMED P0/P1 remain, or the review cycles were
  exhausted. Escalate to a human.

## Final Report

The Coordinator — the agent running the protocol — reports, in order:

- **Confirmed P0/P1** — each confirmed blocking issue and how it was
  resolved.
- **Rejected false positives** — notable REJECTED candidates and why they
  were rejected.
- **Remaining P2/P3** — recorded, not fixed (unless explicitly requested).
- **Validation performed** — the objective checks that ran.
- **Residual Risk / Uncertainty** — unresolved UNVERIFIED items and open
  risks.
- **Final verdict** — `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or
  `BLOCKED`.
