import type { E2ECase } from "../harness/case_types";
import type { HarnessEvidenceInput } from "../harness/evidence_ops";

/**
 * e2e-25 — a `passed` result whose package cannot stand must fail the gate
 * (mandatory scenario 10). Four ops-only siblings over one required check:
 * the Verification Summary is recomputed through the real
 * `evidence_store summary` CLI at validation time.
 *
 *  25a — `passed` with a known-dead artifact (`availability:"unavailable"`)
 *        → `artifact-unavailable`, integrity `invalid` → undetermined.
 *  25b — `passed` with an unfetched artifact (`availability:"unverified"`)
 *        → `artifact-unverified`, integrity `unverified` → undetermined.
 *  25c — `passed` with NO artifacts — attestation-only by construction →
 *        integrity `unverified` → undetermined.
 *  25d — positive control: `passed` + a digest-verified available
 *        artifact → `sufficient` → satisfied → `verified`.
 *
 * Artifact expiry uses wall-clock-relative deadlines nowhere: `expiresAt`
 * is either null or a fixed year-2000 date that is expired under any clock.
 */
const VERIFICATION_WITH_CHECK = {
  "docs/verification/0001-graph.md": {
    frontmatter: {
      id: "VD-0001", type: "verification", status: "approved", title: "Graph",
      checks: [
        {
          id: "CHK-01",
          target: "SPEC-0001::R-01",
          method: "unit",
          implementation: "node --test tests/graph.test.ts",
          // A required check must declare when it applies — empty
          // preconditions is `incomplete-required-check`, not a check.
          preconditions: ["the claimed routing behavior changed"],
          passCriteria: { kind: "unit", expect: "all assertions pass" },
          limitations: [],
          required: true,
        },
      ],
    },
    body: "# Graph\n",
  },
  "docs/specs/0001-graph.md": {
    frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Graph" },
    body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n\n<!-- claim:R-01 --> deterministic routing\n",
  },
};

const baseRecord = (evidenceId: string): HarnessEvidenceInput => ({
  evidenceId,
  claim: { ref: "SPEC-0001::R-01" },
  check: { ref: "VD-0001::CHK-01" },
  subject: { kind: "commit", commit: "HEAD" },
  method: "unit",
  provider: { kind: "repository", name: "e2e" },
  outcome: "passed",
  retention: "release",
  artifacts: [],
});

const artifact = (availability: "available" | "unverified" | "unavailable", expiresAt: string | null = null) => ({
  uri: "evidence/chk-01.txt",
  // `available` requires a verified digest; the others must not carry one.
  sha256: availability === "available" ? `sha256:${"a".repeat(64)}` : null,
  availability,
  retention: "release" as const,
  expiresAt,
});

export const case25a: E2ECase = {
  id: "e2e-25a",
  description: "passed result with an unretrievable artifact → integrity invalid → required check undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    {
      kind: "evidence",
      input: { ...baseRecord("EVID-E2E25A-1"), artifacts: [artifact("unavailable")] },
      resolve: true,
    },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "artifact-unavailable",
        "required-check-undetermined:VD-0001::CHK-01",
        "claim-uncovered:SPEC-0001::R-01",
      ],
    },
    evidence: { count: 1 },
  },
};

export const case25b: E2ECase = {
  id: "e2e-25b",
  description: "passed result with an unfetched artifact → integrity unverified → required check undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    {
      kind: "evidence",
      input: { ...baseRecord("EVID-E2E25B-1"), artifacts: [artifact("unverified")] },
      resolve: true,
    },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "artifact-unverified",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
    evidence: { count: 1 },
  },
};

export const case25c: E2ECase = {
  id: "e2e-25c",
  description: "passed result with no artifacts → attestation-only → integrity unverified → undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    { kind: "evidence", input: baseRecord("EVID-E2E25C-1"), resolve: true },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "attestation-only",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
    evidence: { count: 1 },
  },
};

export const case25d: E2ECase = {
  id: "e2e-25d",
  description: "passed result with a digest-verified artifact → sufficient → check satisfied → verified",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    {
      kind: "evidence",
      input: { ...baseRecord("EVID-E2E25D-1"), artifacts: [artifact("available")] },
      resolve: true,
    },
  ],
  expect: {
    verification: { verdict: "verified" },
    evidence: {
      count: 1,
      records: [{ outcome: "passed", check: "VD-0001::CHK-01", claim: "SPEC-0001::R-01" }],
    },
  },
};
