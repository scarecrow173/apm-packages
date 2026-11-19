import type { E2ECase } from "../harness/case_types";
import type { HarnessEvidenceInput } from "../harness/evidence_ops";

/**
 * e2e-24 — Evidence invalidation axes, three ops-only siblings (mandatory
 * scenario 9). Each records a `passed` Evidence Record through the real
 * `putImmutable` boundary with live-pinned claim/check revisions, then
 * invalidates ONE binding axis; the `verification` expectation re-runs the
 * real `evidence_store summary` CLI at validation time and collects the
 * reason codes from the summary's own assessment — never the op's report.
 *
 *  24a — Claim revision mismatch: an append to the spec's body advances the
 *        claim document's content digest, so the record's pinned
 *        `documentRevision` no longer matches → `claim-revision-mismatch`.
 *  24b — Check revision mismatch: rewriting the check's `implementation`
 *        text in the verification doc's `checks:` front matter advances its
 *        design revision → `check-revision-mismatch`.
 *  24c — Subject mismatch (commit AND workspace spellings): a file write
 *        plus commit moves HEAD past the recorded subject's tree, and a
 *        second record bound to a fabricated workspace snapshot digest
 *        matches no real target — both report `subject-mismatch`.
 *
 * In every sibling the check lands `undetermined` and the claim
 * `uncovered`: stale evidence is never silently accepted as coverage.
 * `evidenceId` is pinned — generated ids are uuidv7 (non-deterministic).
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

const passedRecord = (evidenceId: string): HarnessEvidenceInput => ({
  evidenceId,
  claim: { ref: "SPEC-0001::R-01" },
  check: { ref: "VD-0001::CHK-01" },
  subject: { kind: "commit", commit: "HEAD" },
  method: "unit",
  provider: { kind: "repository", name: "e2e" },
  outcome: "passed",
  retention: "release",
  artifacts: [
    {
      uri: "evidence/chk-01.txt",
      sha256: `sha256:${"a".repeat(64)}`,
      availability: "available",
      retention: "release",
      expiresAt: null,
    },
  ],
});

export const case24a: E2ECase = {
  id: "e2e-24a",
  description: "claim document revision drifts after recording → claim-revision-mismatch → check undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    { kind: "evidence", input: passedRecord("EVID-E2E24A-1"), resolve: true },
    { kind: "mutate", mutator: { append: { path: "docs/specs/0001-graph.md", body: "\nPost-measurement edit.\n" } } },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "claim-revision-mismatch",
        "required-check-undetermined:VD-0001::CHK-01",
        "claim-uncovered:SPEC-0001::R-01",
      ],
    },
    evidence: {
      count: 1,
      records: [{ outcome: "passed", check: "VD-0001::CHK-01", claim: "SPEC-0001::R-01" }],
    },
    gitDirty: true, // the uncommitted spec edit IS the revision drift
  },
};

export const case24b: E2ECase = {
  id: "e2e-24b",
  description: "check design revision drifts after recording → check-revision-mismatch → check undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    { kind: "evidence", input: passedRecord("EVID-E2E24B-1"), resolve: true },
    {
      kind: "mutate",
      mutator: {
        write: {
          path: "docs/verification/0001-graph.md",
          frontmatter: {
            checks: [
              {
                id: "CHK-01",
                target: "SPEC-0001::R-01",
                method: "unit",
                implementation: "node --test tests/graph-v2.test.ts", // redesigned post-measurement
                preconditions: ["the claimed routing behavior changed"],
                passCriteria: { kind: "unit", expect: "all assertions pass" },
                limitations: [],
                required: true,
              },
            ],
          },
        },
      },
    },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "check-revision-mismatch",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
    evidence: { count: 1 },
    gitDirty: true,
  },
};

export const case24c: E2ECase = {
  id: "e2e-24c",
  description: "subject drift — moved HEAD (changed tree) + fabricated workspace digest → subject-mismatch → undetermined",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    { kind: "evidence", input: passedRecord("EVID-E2E24C-1"), resolve: true },
    // A second record pinned to a fabricated workspace snapshot — no real
    // tree ever digested to it.
    {
      kind: "evidence",
      input: {
        ...passedRecord("EVID-E2E24C-2"),
        subject: { kind: "workspace", snapshotDigest: `sha256:${"0".repeat(64)}` },
      },
      resolve: true,
    },
    // An untracked scratch file + a real commit: HEAD's tree digest now
    // differs from the recorded subject's — a pure subject-axis mismatch
    // (the claim/check documents themselves never changed).
    { kind: "writeFile", path: "scratch/marker.txt", content: "post-measurement change\n" },
    { kind: "mutate", mutator: { commit: true } },
  ],
  expect: {
    verification: {
      verdict: "indeterminate",
      reasonsContain: [
        "subject-mismatch",
        "required-check-undetermined:VD-0001::CHK-01",
      ],
    },
    evidence: { count: 2 },
    gitDirty: false, // the drift is committed — HEAD itself moved
  },
};
