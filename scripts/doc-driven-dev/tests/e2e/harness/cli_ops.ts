/**
 * Declarative CLI/store ops for the deterministic e2e harness. Graph legs
 * are not the only thing a case drives: migration planning/apply/recovery,
 * evidence intake, schema preflight, and index materialization are real
 * CLI invocations (tsx + the production script) or real library boundary
 * calls, recorded verbatim for the independent validator — the ops never
 * self-grade.
 *
 * Determinism: every spawned CLI is `process.execPath + tsx + production
 * script` inside the fixture repo; spawned env is the op's own `env` plus
 * the inherited process env (DOC_MAINTENANCE_MIGRATE_FAIL_AT is the fault
 * hook the migration tests already pin). Store writes go through the same
 * boundaries the dispatcher mutators use.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { MigrationPlanReport } from "../../../src/skills/doc-maintenance/scripts/lib/migration_inventory";
import { buildMigrationPlan } from "../../../src/skills/doc-maintenance/scripts/lib/migration_inventory";
import { approvePlan } from "../../../src/skills/lib/execution_store";
import {
  snapshotTree,
} from "./fixture_manager";
import { applyMutator, type Mutator } from "./scripted_dispatcher";
import {
  onlyRunId,
  writeEvidenceRecord,
  type HarnessEvidenceInput,
} from "./evidence_ops";

const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const SCRIPT_ROOT = path.resolve(__dirname, "../../../src/skills");
const CLI_SCRIPTS = {
  route_graph: `${SCRIPT_ROOT}/doc-driven-dev-graph/scripts/route_graph.ts`,
  evidence_store: `${SCRIPT_ROOT}/doc-driven-dev-graph/scripts/evidence_store.ts`,
  execution_store: `${SCRIPT_ROOT}/doc-driven-dev-graph/scripts/execution_store.ts`,
  doc_maintenance: `${SCRIPT_ROOT}/doc-maintenance/scripts/doc_maintenance.ts`,
} as const;

export type CliName = keyof typeof CLI_SCRIPTS;

/** What one spawned CLI produced — recorded verbatim for the validator. */
export type CliInvocationResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Parsed stdout JSON when it parses cleanly, else null. */
  json: unknown;
};

export type CliOpResult =
  | { kind: "cli"; saveAs?: string; invocation: CliInvocationResult }
  | { kind: "snapshot"; saveAs: string; snapshot: string }
  | { kind: "verificationSummary"; saveAs: string; path: string; invocation: CliInvocationResult }
  | { kind: "other"; saveAs?: string };

/**
 * One declared harness op. `saveAs` names the op for later reference:
 * `$<name>` placeholders in argv/files/expectations resolve to the
 * recorded result (`json` for cli ops, `path` for summaries, `snapshot`
 * for snapshots); `$run:only` resolves to the single Execution Store run
 * id in the fixture (the migrated run a portability case cannot name
 * literally).
 */
export type CliOp =
  | { kind: "mutate"; mutator: Mutator }
  | { kind: "writeFile"; path: string; content: string }
  | { kind: "removeFile"; path: string }
  | { kind: "approveRun"; runId?: string; actor?: string }
  | {
      kind: "cli";
      cli: CliName;
      argv: string[];
      env?: Record<string, string>;
      saveAs?: string;
    }
  | { kind: "evidence"; input: HarnessEvidenceInput; resolve?: boolean; saveAs?: string }
  | { kind: "snapshot"; saveAs: string }
  | {
      /**
       * Auto-resolve every required semantic decision of the CURRENT
       * migration plan (same rules the migration-apply unit tests use) and
       * write the resolutions file inside the repo. Deterministic: the
       * plan the file binds is the one scanned at op time.
       */
      kind: "writeResolutions";
      path?: string;
      overrides?: Record<string, unknown>;
    }
  | {
      /**
       * Build the caller-supplied Verification Summary through the real
       * `evidence_store summary` CLI and write it OUTSIDE the repo (a
       * caller artifact, never repo state). `args` passes extra summary
       * flags (--waivers / --not-applicable / --scope-* / --subject-*) verbatim.
       */
      kind: "verificationSummary";
      saveAs: string;
      args?: string[];
    };

/** Resolve `$name`/`$name.path` placeholders against recorded op results. */
function resolvePlaceholder(value: string, results: CliOpResult[], repo: string): string {
  if (value === "$run:only") return onlyRunId(repo);
  const match = /^\$([A-Za-z0-9_-]+)(\.[\w.]+)?$/.exec(value);
  if (match === null) return value;
  const saved = results.find((result) => "saveAs" in result && result.saveAs === match[1]);
  if (saved === undefined) {
    throw new Error(`op placeholder ${value} names no saved op result`);
  }
  if (saved.kind === "verificationSummary") {
    if (match[2] === ".path" || match[2] === undefined) return saved.path;
    return digJson(saved.invocation.json, match[2].slice(1));
  }
  if (saved.kind === "snapshot") {
    if (match[2] === ".snapshot" || match[2] === undefined) return saved.snapshot;
    throw new Error(`snapshot op has no field ${match[2]}`);
  }
  if (saved.kind === "cli") {
    return match[2] === undefined || match[2] === ".stdout"
      ? saved.invocation.stdout
      : digJson(saved.invocation.json, match[2].slice(1));
  }
  return value;
}

function digJson(value: unknown, dotted: string): string {
  let cursor: unknown = value;
  for (const key of dotted.split(".")) {
    if (typeof cursor !== "object" || cursor === null) {
      throw new Error(`placeholder path ${dotted} misses at ${key}`);
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== "string") {
    throw new Error(`placeholder path ${dotted} did not resolve to a string (got ${JSON.stringify(cursor)})`);
  }
  return cursor;
}

export function resolveOpArg(value: string, results: CliOpResult[], repo: string): string {
  return resolvePlaceholder(value, results, repo);
}

/** Spawn one production CLI inside the fixture repo; capture verbatim. */
export function runCli(repo: string, name: CliName, argv: string[], env?: Record<string, string>): CliInvocationResult {
  const script = CLI_SCRIPTS[name];
  const args = argv.includes("--cwd") ? argv : [...argv, "--cwd", repo];
  const result = spawnSync(process.execPath, [TSX_CLI, script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env ?? {}) },
  });
  let json: unknown = null;
  try {
    json = JSON.parse(result.stdout);
  } catch { /* non-JSON stdout is recorded verbatim */ }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json,
  };
}

/**
 * Auto-resolutions for the current plan — the same executable-default
 * mapping the migration-apply unit suite uses, expressed against the
 * plan's declared semantic decisions. Never invents a decision the plan
 * did not ask for.
 */
function resolutionsFor(plan: MigrationPlanReport, overrides: Record<string, unknown> = {}): { schemaVersion: 1; decisions: Record<string, unknown> } {
  const decisions: Record<string, unknown> = {};
  for (const decision of plan.migration.semanticDecisions) {
    if (overrides[decision.decisionId] !== undefined) {
      decisions[decision.decisionId] = overrides[decision.decisionId];
      continue;
    }
    if (!decision.required) continue;
    switch (decision.kind) {
      case "run-approval": decisions[decision.decisionId] = "re-approve via approve-plan after import"; break;
      case "run-status": decisions[decision.decisionId] = "active"; break;
      case "status-mapping": decisions[decision.decisionId] = decision.candidates[0]; break;
      case "legacy-relation": decisions[decision.decisionId] = "drop-as-unmapped"; break;
      case "doc-placement": decisions[decision.decisionId] = "move-to-canonical-dir"; break;
      case "untyped-legacy-doc":
        decisions[decision.decisionId] = { choice: "knowledge", kind: "lesson", title: "Migrated document", status: "current", lifecycle: "current", created: "2024-01-01", updated: "2024-01-01" };
        break;
      case "missing-field":
        decisions[decision.decisionId] = decision.candidates.includes("declare-date")
          ? { choice: "declare-date", value: "2024-01-01" }
          : { choice: "declare-title", value: "Migrated title" };
        break;
      // Non-empty refs/checks are mandatory — the gate rejects an empty
      // declaration the same way it rejects a missing one. `VD-0001` is
      // the id migration allocates for docs/verification/0001-graph.md
      // (deterministic corpus naming), CHK-01 its declared check.
      case "check-binding":
        decisions[decision.decisionId] = decision.element === "relations.verified-by"
          ? { choice: "declare VD-<id>::CHK-NN references", refs: ["VD-0001::CHK-01"] }
          : {
              choice: decision.candidates[0],
              checks: [
                {
                  id: "CHK-01",
                  target: "SPEC-0001::R-01",
                  method: "unit",
                  implementation: "migrated test-spec assertion",
                  preconditions: ["the claimed routing behavior changed"],
                  passCriteria: { kind: "unit", expect: "all assertions pass" },
                  limitations: [],
                  required: true,
                },
              ],
            };
        break;
      // Corpus READMEs adopt the managed index contract; the only other
      // candidate set (extract-to-knowledge) demands a knowledge kind —
      // `discard` is the honest executable default there.
      case "hand-curated-index":
        decisions[decision.decisionId] = decision.candidates.includes("adopt-managed") ? "adopt-managed" : "discard";
        break;
      // `knowledge` requires a kind param — a lesson is the honest landing
      // for a legacy implementation record.
      case "ir-classification":
      case "exp-classification":
        decisions[decision.decisionId] = decision.candidates.includes("knowledge")
          ? { choice: "knowledge", kind: "lesson" }
          : (decision.default ?? decision.candidates[0]);
        break;
      default:
        decisions[decision.decisionId] = decision.default ?? decision.candidates[0];
    }
  }
  return { schemaVersion: 1, decisions };
}

/** Execute a declared op list in order; returns one result per op. */
export function runOps(repo: string, ops: readonly CliOp[] | undefined): CliOpResult[] {
  const results: CliOpResult[] = [];
  const arg = (value: string): string => resolvePlaceholder(value, results, repo);
  for (const op of ops ?? []) {
    switch (op.kind) {
      case "mutate": {
        applyMutator(repo, op.mutator);
        results.push({ kind: "other" });
        break;
      }
      case "writeFile": {
        const file = path.join(repo, op.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, op.content, "utf8");
        results.push({ kind: "other" });
        break;
      }
      case "removeFile": {
        fs.rmSync(path.join(repo, op.path), { force: true });
        results.push({ kind: "other" });
        break;
      }
      case "approveRun": {
        approvePlan(repo, arg(op.runId ?? "e2e-run"), { actor: op.actor ?? "e2e" });
        results.push({ kind: "other" });
        break;
      }
      case "cli": {
        const invocation = runCli(repo, op.cli, op.argv.map(arg), op.env);
        results.push({ kind: "cli", saveAs: op.saveAs, invocation });
        break;
      }
      case "evidence": {
        writeEvidenceRecord(repo, op.input, { resolve: op.resolve });
        results.push({ kind: "other", saveAs: op.saveAs });
        break;
      }
      case "snapshot": {
        results.push({ kind: "snapshot", saveAs: op.saveAs, snapshot: snapshotTree(repo) });
        break;
      }
      case "writeResolutions": {
        const plan = buildMigrationPlan(repo);
        const rel = op.path ?? "migration-resolutions.json";
        const file = path.join(repo, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(resolutionsFor(plan, op.overrides), null, 2)}\n`, "utf8");
        results.push({ kind: "other" });
        break;
      }
      case "verificationSummary": {
        // The caller artifact lives beside the fixture repo — never inside
        // it, so writing the summary cannot dirty any gate's porcelain.
        const out = path.join(path.dirname(repo), `${path.basename(repo)}-${op.saveAs}.summary.json`);
        const argv = ["summary", "--json", "--out", out, ...(op.args ?? []).map(arg)];
        const invocation = runCli(repo, "evidence_store", argv);
        results.push({ kind: "verificationSummary", saveAs: op.saveAs, path: out, invocation });
        break;
      }
    }
  }
  return results;
}
