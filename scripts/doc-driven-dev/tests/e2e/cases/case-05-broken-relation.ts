import type { E2ECase } from "../harness/case_types";

/**
 * Missing evidence doc → broken-relation hard blocker → unrecoverable-blocker.
 *
 * The fixture deletes `docs/test-specs/0001-graph.md`, so the plan's
 * `verified-by` relation dangles: scanArtifactGraph reports a broken-relation
 * issue, which deriveHardBlockers promotes to a hard blocker — the router
 * returns a same-node blocked route at probe and the runner yields
 * "unrecoverable-blocker" before any effect dispatch.
 *
 * Focus stays set: without it the resolution's own "focus-required" blocker
 * would fire first and downgrade the yield to "input-required". The trace's
 * blocker assertion is on the sanitized token form — the raw message carries
 * free text that appendTraceEvent redacts to `broken-relation:sha256:<12hex>`
 * (re-verifying the blocker-redaction contract E2E), so the RegExp asserts
 * the token shape, never the string.
 */
export const case05: E2ECase = {
  id: "e2e-05",
  description: "dangling verified-by relation → broken-relation blocker → unrecoverable-blocker",
  fixture: {
    taskStatuses: ["todo"],
    files: { "docs/test-specs/0001-graph.md": null },
  },
  focus: ["PLAN-0001"],
  expect: {
    yield: "unrecoverable-blocker",
    edgeSequence: [null],
    completedEdges: [],
    blockersContain: [/^broken-relation:sha256:[0-9a-f]{12}$/],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", count: 0 },
    ],
  },
};
