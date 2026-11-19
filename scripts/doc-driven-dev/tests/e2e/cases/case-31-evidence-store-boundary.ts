import type { E2ECase } from "../harness/case_types";
import type { HarnessEvidenceInput } from "../harness/evidence_ops";

/**
 * e2e-31 — the Evidence Store's real CLI boundary: immutable append-once
 * writes, `record-conflict` on same-id/different-content, and live
 * get/query reads.
 *
 * A `passed` record goes in through the real `putImmutable` boundary
 * (harness `evidence` op, `--resolve`-equivalent live pinning). The real
 * `evidence_store` CLI then exercises the same store from OUTSIDE the
 * harness: `put --resolve` of a deliberately different record under the
 * same id must be refused (`record-conflict`, exit 1 — records are
 * immutable, never overwritten), while `get` returns the STORED record
 * verbatim and `query --check` surfaces it — all read back through the
 * production CLI, never through harness memory.
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

const RECORD: HarnessEvidenceInput = {
  evidenceId: "EVID-E2E31-1",
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
};

export const case31: E2ECase = {
  id: "e2e-31",
  description: "evidence_store CLI boundary — immutable put, record-conflict on re-put, live get/query",
  fixture: { taskStatuses: ["todo"], files: VERIFICATION_WITH_CHECK },
  steps: [],
  ops: [
    { kind: "evidence", input: RECORD, resolve: true },
    // A second intake under the SAME id with a different subject + outcome.
    // --resolve pins live claim/check revisions (so the only deliberate
    // deltas are subject/outcome) — enough to make the record conflict.
    {
      kind: "writeFile",
      path: "conflicting-record.json",
      content: `${JSON.stringify(
        {
          ...RECORD,
          subject: { kind: "commit", commit: "0".repeat(40) },
          outcome: "failed",
        },
        null,
        2,
      )}\n`,
    },
    { kind: "cli", cli: "evidence_store", argv: ["put", "--file", "conflicting-record.json", "--resolve", "--json"], saveAs: "conflict" },
    { kind: "cli", cli: "evidence_store", argv: ["get", "EVID-E2E31-1", "--json"], saveAs: "fetched" },
    { kind: "cli", cli: "evidence_store", argv: ["query", "--check", "VD-0001::CHK-01", "--json"], saveAs: "queried" },
  ],
  expect: {
    cli: [
      {
        saveAs: "conflict",
        exit: 1,
        jsonMatch: { command: "put", error: "record-conflict" },
      },
      {
        saveAs: "fetched",
        exit: 0,
        jsonMatch: { record: { evidenceId: "EVID-E2E31-1", outcome: "passed", method: "unit" } },
      },
      {
        saveAs: "queried",
        exit: 0,
        stdoutMatch: /"evidenceId": "EVID-E2E31-1"/,
      },
    ],
    evidence: {
      count: 1, // the refused re-put left the store untouched
      records: [{ outcome: "passed", check: "VD-0001::CHK-01", claim: "SPEC-0001::R-01" }],
    },
  },
};
