import type { E2ECase } from "../harness/case_types";
import type { HarnessEvidenceInput } from "../harness/evidence_ops";

/**
 * e2e-26 — partial coverage, not-applicable basis, and waivers (mandatory
 * scenario 11). Ops-only siblings: exemption candidates arrive as the
 * caller-supplied JSON files the real `evidence_store summary` CLI reads
 * (`--waivers`/`--not-applicable`/`--waiver-authority`), recomputed at
 * validation time.
 *
 *  26a — one of two required checks satisfied, the other unexecuted → the
 *        claim is `partial`, the summary indeterminate.
 *  26b — a well-formed not-applicable verdict (revision/paths/rule/judger/
 *        method/reason all present) → the check is `out-of-scope`, the
 *        claim covered, the summary `verified`.
 *  26c — a not-applicable verdict missing its basis → `not-applicable-
 *        malformed`, `rejected-not-applicable:<ref>` → indeterminate.
 *  26d — an EXPIRED waiver from a trusted authority → `waiver-expired`,
 *        `rejected-waiver:<ref>` → indeterminate. Dates are fixed
 *        year-2000 values — expired under any clock, no time injection.
 *  26e — a VALID waiver (trusted authority, resolvable scope, future
 *        year-3000 expiry) → the check is `waived`, the claim covered,
 *        the summary `verified`.
 */
const checkEntry = (id: string, required = true) => ({
  id,
  target: "SPEC-0001::R-01",
  method: "unit",
  implementation: "node --test tests/graph.test.ts",
  // A required check must declare when it applies — empty preconditions
  // is `incomplete-required-check`, not a check.
  preconditions: ["the claimed routing behavior changed"],
  passCriteria: { kind: "unit", expect: "all assertions pass" },
  limitations: [],
  required,
});

const VERIFICATION_ONE_CHECK = {
  "docs/verification/0001-graph.md": {
    frontmatter: {
      id: "VD-0001", type: "verification", status: "approved", title: "Graph",
      checks: [checkEntry("CHK-01")],
    },
    body: "# Graph\n",
  },
  "docs/specs/0001-graph.md": {
    frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Graph" },
    body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n\n<!-- claim:R-01 --> deterministic routing\n",
  },
};

const VERIFICATION_TWO_CHECKS = {
  "docs/verification/0001-graph.md": {
    frontmatter: {
      id: "VD-0001", type: "verification", status: "approved", title: "Graph",
      checks: [checkEntry("CHK-01"), checkEntry("CHK-02")],
    },
    body: "# Graph\n",
  },
  "docs/specs/0001-graph.md": VERIFICATION_ONE_CHECK["docs/specs/0001-graph.md"],
};

const passedRecord = (evidenceId: string, checkRef: string): HarnessEvidenceInput => ({
  evidenceId,
  claim: { ref: "SPEC-0001::R-01" },
  check: { ref: checkRef },
  subject: { kind: "commit", commit: "HEAD" },
  method: "unit",
  provider: { kind: "repository", name: "e2e" },
  outcome: "passed",
  retention: "release",
  artifacts: [
    {
      uri: "evidence/output.txt",
      sha256: `sha256:${"a".repeat(64)}`,
      availability: "available",
      retention: "release",
      expiresAt: null,
    },
  ],
});

export const case26a: E2ECase = {
  id: "e2e-26a",
  description: "one of two required checks satisfied → claim partial coverage → indeterminate",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_TWO_CHECKS },
  steps: [],
  ops: [
    { kind: "evidence", input: passedRecord("EVID-E2E26A-1", "VD-0001::CHK-01"), resolve: true },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        // CHK-02 was never executed — a subset of passes never covers the claim.
        "required-check-undetermined:VD-0001::CHK-02",
        "unexecuted",
        "claim-partial-coverage",
        "claim-partial:SPEC-0001::R-01",
      ],
    },
    evidence: { count: 1 },
  },
};

const VALID_NOT_APPLICABLE = {
  check: "VD-0001::CHK-01",
  revision: `sha256:${"b".repeat(64)}`,
  paths: ["docs/specs/0001-graph.md"],
  rule: "changed paths do not touch the check's claimed behavior",
  judger: "e2e-impact-analysis",
  method: "path-scope",
  reason: "the change set cannot affect the verified property",
};

export const case26b: E2ECase = {
  id: "e2e-26b",
  description: "valid not-applicable verdict → check out-of-scope → claim covered → verified",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_ONE_CHECK },
  steps: [],
  ops: [
    { kind: "writeFile", path: "not-applicable.json", content: `${JSON.stringify([VALID_NOT_APPLICABLE], null, 2)}\n` },
  ],
  expect: {
    verification: {
      verdict: "verified",
      args: ["--not-applicable", "not-applicable.json"],
      reasonsContain: ["out-of-scope-verdict"],
    },
    gitDirty: true, // the caller-supplied verdict file sits untracked at the root
  },
};

export const case26c: E2ECase = {
  id: "e2e-26c",
  description: "not-applicable verdict missing its basis → not-applicable-malformed → rejected → indeterminate",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_ONE_CHECK },
  steps: [],
  ops: [
    // Only `check` + `reason` — revision/paths/rule/judger/method are the
    // impact-analysis basis an out-of-scope declaration can never omit.
    {
      kind: "writeFile",
      path: "not-applicable.json",
      content: `${JSON.stringify([{ check: "VD-0001::CHK-01", reason: "no basis" }], null, 2)}\n`,
    },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      args: ["--not-applicable", "not-applicable.json"],
      reasonsContain: [
        "not-applicable-malformed",
        "rejected-not-applicable:VD-0001::CHK-01",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
  },
};

const waiver = (grantedAt: string, expiresAt: string): Record<string, unknown> => ({
  scope: { kind: "check", ref: "VD-0001::CHK-01" },
  authority: "e2e-authority",
  reason: "legacy environment cannot execute the check",
  grantedAt,
  expiresAt,
});

export const case26d: E2ECase = {
  id: "e2e-26d",
  description: "expired waiver from a trusted authority → waiver-expired + rejected-waiver → indeterminate",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_ONE_CHECK },
  steps: [],
  ops: [
    // Fixed year-2000 expiry with a well-formed window — the ONLY reason
    // this waiver rejects is expiry, under any assessment instant.
    {
      kind: "writeFile",
      path: "waivers.json",
      content: `${JSON.stringify([waiver("1999-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z")], null, 2)}\n`,
    },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      args: ["--waivers", "waivers.json", "--waiver-authority", "e2e-authority"],
      reasonsContain: [
        "waiver-expired",
        "rejected-waiver:VD-0001::CHK-01",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
  },
};

export const case26e: E2ECase = {
  id: "e2e-26e",
  description: "valid waiver (trusted authority, resolvable scope, future expiry) → waived → verified",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_ONE_CHECK },
  steps: [],
  ops: [
    // Fixed year-3000 expiry — valid under any assessment instant.
    {
      kind: "writeFile",
      path: "waivers.json",
      content: `${JSON.stringify([waiver("2020-01-01T00:00:00.000Z", "3000-01-01T00:00:00.000Z")], null, 2)}\n`,
    },
  ],
  expect: {
    verification: {
      verdict: "verified",
      args: ["--waivers", "waivers.json", "--waiver-authority", "e2e-authority"],
      reasonsContain: ["waiver-applied"],
    },
  },
};
