import type { E2ECase } from "../harness/case_types";

/**
 * e2e-16 — Schema Preflight halts normal execution on a mixed-generation
 * repository; the migration lane is the ONLY runnable surface (mandatory
 * scenario 2).
 *
 * The fixture is the default corpus — Registry-3 spec/design/adr plus
 * legacy plan/task/test-spec/impl documents — UNDER a declared schema
 * manifest: the manifest makes the execution-bound canonical docs
 * provably non-current, so `evaluateSchemaPreflight` reports
 * `migration-required` (without a manifest the same corpus is merely
 * `uninitialized` — nothing provably pre-contract). A real
 * `route_graph` invocation returns the machine-readable refusal
 * (`schema-preflight-blocked`, exit 2, readOnly) before any routing, while
 * `doc_maintenance migrate plan` — the migration entrypoint, which
 * legitimately bypasses the normal-execution guard — emits the full
 * inventory + planned writes as a read-only report.
 *
 * No graph legs run: `steps: []` makes this a pure ops case; the run-level
 * `preflight` expectation re-evaluates the repository fresh at validation
 * time, never trusting the op's own report.
 */
export const case16: E2ECase = {
  id: "e2e-16",
  description: "mixed legacy corpus → route_graph blocked by schema preflight; migrate plan still runs",
  fixture: { taskStatuses: ["todo"], schemaManifest: true },
  steps: [],
  ops: [
    {
      kind: "cli",
      cli: "route_graph",
      argv: ["--current", "probe", "--json"],
      saveAs: "route",
    },
    {
      kind: "cli",
      cli: "doc_maintenance",
      argv: ["migrate", "plan"],
      saveAs: "plan",
    },
  ],
  expect: {
    preflight: "migration-required",
    cli: [
      {
        saveAs: "route",
        exit: 2,
        jsonMatch: {
          error: "schema-preflight-blocked",
          exitCode: 2,
          readOnly: true,
          preflight: { status: "migration-required" },
        },
      },
      {
        saveAs: "plan",
        exit: 0,
        jsonMatch: {
          command: "migrate plan",
          readOnly: true,
          preflight: { status: "migration-required" },
          plan: { classification: "migration" },
        },
      },
    ],
  },
};
