import type { E2ECase } from "../harness/case_types";

/**
 * e2e-17 — `migrate` determinism + hash pinning, three siblings (mandatory
 * scenario 14):
 *
 *  17a — `migrate plan` on a CURRENT repository (`v3Only` corpus + declared
 *        schema manifest) classifies `current`, plans zero writes, and
 *        writes zero bytes — the `treeSnapshotEquals` check compares the
 *        end-of-run tree digest against the snapshot taken before the op,
 *        proving the read-only contract on disk, not on the report.
 *  17b — a `--expect` hash that does not match the deterministic planHash
 *        refuses BEFORE any write: `{ok:false}` exit 1, no manifest, tree
 *        byte-identical, and the repository's own preflight stays
 *        `uninitialized` (the manifest was never stamped).
 *  17c — apply + re-apply on a manifest-only repository: the pinned apply
 *        stamps `docs/.doc-driven-dev/schema.json` (`applied:true`), and
 *        the second apply reports `{ok:true, applied:false}` — the
 *        already-current fast path, an explicit no-op. The repository ends
 *        `current` (fresh preflight evaluation).
 */
export const case17a: E2ECase = {
  id: "e2e-17a",
  description: "migrate plan on a current repo: classification current, zero planned writes, zero bytes written",
  fixture: { v3Only: true, schemaManifest: true },
  steps: [],
  ops: [
    { kind: "snapshot", saveAs: "before" },
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "plan"], saveAs: "plan" },
  ],
  expect: {
    preflight: "current",
    treeSnapshotEquals: "before",
    cli: [
      {
        saveAs: "plan",
        exit: 0,
        jsonMatch: {
          command: "migrate plan",
          readOnly: true,
          preflight: { status: "current" },
          plan: { classification: "current" },
          migration: { plannedWrites: [] },
        },
      },
    ],
  },
};

export const case17b: E2ECase = {
  id: "e2e-17b",
  description: "plan-hash drift refuses apply before any write",
  fixture: { v3Only: true },
  steps: [],
  ops: [
    { kind: "snapshot", saveAs: "before" },
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "plan"], saveAs: "plan" },
    {
      kind: "cli",
      cli: "doc_maintenance",
      argv: ["migrate", "apply", "--expect", "0".repeat(64)],
      saveAs: "drift",
    },
  ],
  expect: {
    // The refusal is a pure refusal: manifest never written, tree unchanged,
    // and the repo still reports uninitialized (missing manifest).
    preflight: "uninitialized",
    treeSnapshotEquals: "before",
    absentFiles: ["docs/.doc-driven-dev/schema.json"],
    cli: [
      {
        saveAs: "plan",
        exit: 0,
        jsonMatch: { plan: { classification: "manifest-only" } },
      },
      {
        saveAs: "drift",
        exit: 1,
        jsonMatch: { ok: false, applied: false },
        stdoutMatch: "plan hash mismatch",
      },
    ],
  },
};

export const case17c: E2ECase = {
  id: "e2e-17c",
  description: "pinned apply stamps the manifest; the second apply is an explicit no-op",
  fixture: { v3Only: true },
  steps: [],
  ops: [
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "plan"], saveAs: "plan" },
    {
      kind: "cli",
      cli: "doc_maintenance",
      argv: ["migrate", "apply", "--expect", "$plan.plan.planHash"],
      saveAs: "apply",
    },
    { kind: "cli", cli: "doc_maintenance", argv: ["migrate", "apply"], saveAs: "reapply" },
  ],
  expect: {
    preflight: "current",
    fileCount: { "docs/.doc-driven-dev": 1 },
    cli: [
      {
        saveAs: "apply",
        exit: 0,
        jsonMatch: {
          ok: true,
          applied: true,
          docsWritten: ["docs/.doc-driven-dev/schema.json"],
        },
      },
      {
        saveAs: "reapply",
        exit: 0,
        jsonMatch: { ok: true, applied: false },
        stdoutMatch: "schema already current — nothing to apply",
      },
    ],
  },
};
