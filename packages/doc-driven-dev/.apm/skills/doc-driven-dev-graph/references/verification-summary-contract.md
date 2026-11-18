# Verification Summary Contract v1

The Verification Summary (Issue `#241`) is the pure aggregate the
Verification Gate consumes: for one declared **target subject** — the
"current change" — it classifies every in-scope Verification Check, rolls
checks up per Claim, and reduces the scope to a single verdict —
`verified`, `failed`, or `indeterminate`. It is computed from the live
Knowledge Graph (check designs), the immutable Evidence Store (measured
outcomes), and caller-supplied exemptions — never from a caller-asserted
"implementation verified" signal.

Runtime: `scripts/evidence_store.js` (`assess`, `summary` subcommands) and
`route_graph.js` (`--verification-summary`, auto-compute). Source of truth:
`src/skills/lib/verification_assessment/`.

## Three contracts

| Contract | Role |
| --- | --- |
| `EvidenceAssessment` | Derived per-record judgment: does this measured outcome still speak for the target? |
| `VerificationSummary` | Per-Claim/Check coverage aggregate for one target — the gate input. |
| `VerificationWaiver` / `NotApplicableVerdict` | Validated exemption assertions — rejected entries are reported, never silently applied. |

An Evidence Record is immutable truth about a measurement. An assessment
recomputes against the live graph and the declared target; nothing here
writes to the Evidence Store.

## EvidenceAssessment — per record, four axes

```jsonc
{
  "schemaVersion": 1,
  "evidenceId": "EVID-…",
  "claim": "SPEC-…::R-01",
  "check": "VD-…::CHK-01",
  "outcome": "passed",
  "applicability": "applicable",      // does the record measure THIS target?
  "availability": "available",        // is the recorded package retrievable now?
  "integrity": "verified",            // is the measurement internally trustworthy?
  "assessment": "sufficient",         // the per-record bottom line
  "reasons": [{ "code": "…", "detail": "…" }]
}
```

### `applicability`

- `applicable` — claim and check resolve in the live graph, both pinned
  revisions still match, the check targets the credited claim, the
  recorded method is the designed method, and the record's subject digest
  equals the target's.
- `not-applicable` — everything resolves but something differs: a claim or
  check revision moved on, the check does not target the claim, the
  recorded method is not the designed one, or the subject digest differs.
  A `passed` outcome that measured a *different* target is never
  sufficient for this one.
- `unknown` — a reference cannot resolve, the record's subject cannot be
  digested, or the target itself is unnamable. The assessment never
  guesses.

### `availability`

- `unavailable` — a declared artifact is known-inaccessible or past its
  `expiresAt` deadline.
- `unknown` — no dead references, but some were never fetched.
- `available` — every declared artifact is digest-verified and within
  retention, or none were declared.

### `integrity`

- `invalid` — the record's own package contradicts it: a declared artifact
  is dead/expired, or the recorded method is not the designed one.
- `unverified` — support was never digest-verified (unfetched artifacts),
  or the record declares no artifacts at all — an attestation-only
  outcome.
- `verified` — every declared artifact is digest-verified and current.

### `assessment`

- `sufficient` — `applicable` + `passed` + integrity `verified`.
- `insufficient` — `applicable` + recorded `failed` (a measured failure is
  never upgraded by broken support).
- `indeterminate` — everything else.

### Reason codes

`target-unverifiable`, `subject-unverifiable`, `subject-mismatch`,
`claim-unresolved`, `check-unresolved`, `claim-revision-mismatch`,
`check-revision-mismatch`, `check-target-mismatch`, `method-mismatch`,
`artifact-unavailable`, `artifact-expired`, `artifact-unverified`,
`outcome-failed`, `outcome-not-passed`.

## VerificationSummary — schemaVersion 1

```jsonc
{
  "schemaVersion": 1,
  "kind": "verification-summary",
  "target": {
    "subject": { "kind": "commit", "commit": "<full oid>" },
    "subjectDigest": "sha256:<64-hex>"   // null → every record target-unverifiable
  },
  "assessedAt": "<iso>",
  "scope": { "claims": ["…"], "checks": ["…"] },
  "claims": [{ "ref", "status", "checks", "requiredChecks", "reasons" }],
  "checks": [{ "ref", "claim", "method", "required", "designRevision",
               "constraints", "executed", "status",
               "evidence": { "sufficient": [], "insufficient": [], "indeterminate": [] },
               "latestConclusiveAt", "waiver", "notApplicable", "reasons" }],
  "evidence": [EvidenceAssessment],
  "rejectedWaivers": [{ "waiver", "reasons" }],
  "rejectedNotApplicable": [{ "verdict", "reasons" }],
  "counts": { "checks": {…}, "claims": {…}, "evidence": {…} },
  "verdict": "verified | failed | indeterminate",
  "reasons": ["…"]
}
```

### Check status

| Status | Meaning |
| --- | --- |
| `satisfied` | the newest conclusive applicable assessment is `sufficient` |
| `failed` | the newest conclusive applicable assessment is `insufficient` — a measured failure for this target |
| `waived` | no conclusive evidence; a validated waiver exempts the check |
| `out-of-scope` | no conclusive evidence; a validated impact-analysis verdict exempts the check |
| `undetermined` | in scope, no usable outcome, no valid exemption — the bucket an unexecuted check lands in; never silently out-of-scope |
| `unresolved` | the check ref does not resolve — gates as required |

A measured outcome outranks any exemption: a failed check stays failed
even under a valid waiver (a waiver exempts obligation, not reality), and
a satisfied check reports `satisfied`, not `waived`. Advisory checks
(`required: false`) are classified and reported but never gate the
verdict.

Method-derived `constraints` make special obligations gate-visible:
`manual-review` evidence is human attestation; `runtime-monitoring`
evidence is a point-in-time sample of a continuous obligation —
`latestConclusiveAt` is the recency datum a gate policy can require.

### Claim status

`covered` (every required check targeting the claim is satisfied, waived,
or out-of-scope), `partial` (some but not all), `uncovered` (none —
including the zero-required-checks gap), `failed` (a required check
measured a failure).

### Verdict

- `failed` — any required check or claim measured a failure.
- `indeterminate` — any required check is undetermined/unresolved, any
  claim is uncovered/partial, any check-design graph issue made the
  declared inventory untrustworthy, or the target is unverifiable.
- `verified` — otherwise. An empty scope verifies with an explicit
  `no-required-coverage` / `no-required-checks` reason — never silently.

## Exemptions — validated, never trusted

### VerificationWaiver

`{ scope: { kind: "check" | "claim", ref }, authority, reason, grantedAt,
expiresAt }`. Applied only when the shape is complete, `authority` sits in
the caller-supplied trusted allowlist (no allowlist → every waiver
rejects), `scope.ref` resolves in the live graph, and `expiresAt` is a
future deadline at the assessment instant (`expiresAt` at or before
`grantedAt` is a malformed window). Rejection reasons:
`waiver-malformed`, `waiver-untrusted-authority`,
`waiver-scope-unresolved`, `waiver-expired`, `waiver-invalid-window`.

### NotApplicableVerdict

`{ check, revision, paths, rule, judger, method, reason }` — a positive
declaration that a check does not apply to the current change, backed by
the change-impact analysis. Every field is required and `check` must
resolve. Rejection reasons: `not-applicable-malformed`,
`not-applicable-check-unresolved`. An unexecuted check is never
out-of-scope by default — only this explicit verdict makes it so.

Rejections land in `rejectedWaivers` / `rejectedNotApplicable` on the
summary and attach to the check they tried to exempt with
`status: "rejected"` — a refused exemption is data, not silence.

## Graph Gate binding

The implementation gate's authority is a Verification Summary bound to
the checkout's `HEAD` through the canonical subject digest — the digest
*is* the content identity, so commit and workspace spellings bind the
same way and a summary targeting another subject is a stale artifact:

- no summary → gate blocked on `verification-summary`;
- `subjectDigest` ≠ HEAD's → blocked on `verification-summary-target-mismatch`;
- `verdict` ≠ `verified` → blocked on `verification-<verdict>` plus the
  summary's own reasons, so the operator sees *which* coverage failed.

`route_graph.js` always supplies the gate a summary: with
`--verification-summary <file>` the file must satisfy this contract's
validator before it is read (unreadable or unverifiable input is
refused); without a file the router computes the summary itself from the
live Evidence Store and Knowledge Graph against `HEAD`. The summary file
is the caller's exemption channel — waivers and conditional
out-of-scope verdicts are judgments only a caller can supply.

## CLI

```bash
# Per-record assessment for a declared target
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js \
  assess <evidence-id> (--commit <sha> | --snapshot <digest>) --cwd <repo> --json

# Verification Summary — exemptions as JSON files; --out writes the bare
# summary a `route_graph --verification-summary` consumes
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js \
  summary (--commit <sha> | --snapshot <digest>) \
  [--scope-claim <ref>]… [--scope-check <ref>]… [--run-id <id>] \
  [--waivers <file>] [--waiver-authority <name>]… \
  [--not-applicable <file>] [--out <file>] --cwd <repo> --json

# Route on a caller-supplied summary (validated before it is read)
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --verification-summary <file> --cwd <repo> --json
```

`--commit` accepts any git revision — `HEAD`, a branch, a tag, an oid —
the summary records the resolved full oid and the canonical subject
digest. `--snapshot` takes the adapter-attested `sha256:<64-hex>`
workspace digest verbatim.

## Library API

`assessEvidence / assessEvidenceIn / recordSubjectDigest`,
`buildVerificationSummary / buildVerificationSummaryIn / normalizeTarget`,
`validateVerificationSummary / validateAssessment / validateWaiver /
validateNotApplicableVerdict`, and the `NOT_APPLICABLE_REASONS` /
`WAIVER_REASONS` vocabularies from `src/skills/lib/verification_assessment`.
