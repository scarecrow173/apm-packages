import path from "node:path";
import type { E2ECase } from "../harness/case_types";

/**
 * e2e-30 — v2-schema `GraphRoute` payloads and pre-v3 `proofPath` handoff
 * fields are refused during normal execution (mandatory scenario 17).
 *
 * The `router` override points runCaller at `harness/fake_router.mjs`,
 * a deliberately stale router that prints `<cwd>/fake-route.json`
 * verbatim — the fixture payload a v2-era router would emit. runCaller
 * fails closed BEFORE any dispatch (`route_graph returned a non-v3
 * route…` thrown at route validation): a schemaVersion below 3 or the
 * presence of `proofPath` is a pre-v3 handoff marker, and routing on it
 * would silently route the wrong graph.
 *
 * Both siblings emit no run-yield — the throw IS the outcome, asserted
 * through `throwMatch` (an unexpected throw would itself fail).
 */
const FAKE_ROUTER = path.resolve(__dirname, "../harness/fake_router.mjs");

const V2_ROUTE = JSON.stringify(
  { schemaVersion: 2, current: "design", next: "planning", edge: "design-to-planning" },
  null,
  2,
);

const V3_WITH_PROOF_PATH = JSON.stringify(
  {
    schemaVersion: 3,
    current: "design",
    edgeId: "design-to-planning",
    next: "planning",
    condition: "design",
    status: "edge",
    delegate: "planning-flow",
    requiredAudits: ["design"],
    blockers: [],
    taskGraph: null,
    commitGate: false,
    proofPath: "docs/proof/0001.md",
  },
  null,
  2,
);

export const case30a: E2ECase = {
  id: "e2e-30a",
  description: "schemaVersion 2 route payload → caller refuses before dispatch (non-v3 route throw)",
  current: "design",
  fixture: { taskStatuses: ["todo"], files: { "fake-route.json": `${V2_ROUTE}\n` } },
  router: { executable: process.execPath, prefixArgs: [FAKE_ROUTER] },
  expect: {
    throwMatch: /route_graph returned a non-v3 route/,
    events: [{ kind: "route-selected", count: 0 }], // refused before a route was ever accepted
    gitDirty: false, // the refusal wrote nothing — fixture content is committed
  },
};

export const case30b: E2ECase = {
  id: "e2e-30b",
  description: "schemaVersion 3 route carrying legacy proofPath field → caller refuses before dispatch",
  current: "design",
  fixture: { taskStatuses: ["todo"], files: { "fake-route.json": `${V3_WITH_PROOF_PATH}\n` } },
  router: { executable: process.execPath, prefixArgs: [FAKE_ROUTER] },
  expect: {
    throwMatch: /route_graph returned a non-v3 route/,
    events: [{ kind: "route-selected", count: 0 }],
    gitDirty: false,
  },
};
