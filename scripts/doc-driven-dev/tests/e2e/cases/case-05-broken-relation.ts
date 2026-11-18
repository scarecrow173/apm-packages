import type { E2ECase } from "../harness/case_types";

/**
 * Dangling Knowledge Relation → knowledge-integrity blocker →
 * unrecoverable-blocker.
 *
 * The fixture rewrites the design's stored `realizes` edge at
 * `SPEC-9999` — a document id that does not exist — so the Knowledge
 * Graph reports an `unresolved-relation-target` issue. The knowledge gate
 * surfaces it as a `knowledge:unresolved-relation-target` blocker, which
 * deriveHardBlockers promotes to a hard blocker — the router returns a
 * same-node blocked route at probe and the runner yields
 * "unrecoverable-blocker" before any effect dispatch.
 *
 * Focus stays set: without it the resolution's own "focus-required" blocker
 * would fire first and downgrade the yield to "input-required". The trace's
 * blocker assertion is on the sanitized token form — the raw blocker carries
 * the `knowledge:<code>` free text that appendTraceEvent redacts to
 * `knowledge:sha256:<12hex>` (re-verifying the blocker-redaction contract
 * E2E), so the RegExp asserts the token shape, never the string.
 */
export const case05: E2ECase = {
  id: "e2e-05",
  description: "dangling realizes relation → knowledge integrity blocker → unrecoverable-blocker",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      "docs/designs/0001-graph.md": {
        frontmatter: {
          id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
          relations: { realizes: ["SPEC-9999"] },
        },
        body: "# Graph\n",
      },
    },
  },
  focus: ["DESIGN-0001"],
  expect: {
    yield: "unrecoverable-blocker",
    edgeSequence: [null],
    completedEdges: [],
    blockersContain: [/^knowledge:sha256:[0-9a-f]{12}$/],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", count: 0 },
    ],
  },
};
