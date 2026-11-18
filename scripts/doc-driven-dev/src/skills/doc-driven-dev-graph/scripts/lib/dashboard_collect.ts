import path from "node:path";

import { collectFindings, summarizeHealth } from "../../../lib/doc_report";
import { inspectEvidenceStore } from "../../../lib/evidence_store";
import { buildVerificationSummary } from "../../../lib/verification_assessment";
import { scanArtifactGraph } from "./artifact_graph";
import { loadGraphDefinition } from "./graph_definition";
import { inspectGraphDefinition } from "./graph_inspector";
import { evaluateRouteDecision } from "./graph_router";
import { projectGraphState } from "./graph_state";
import { projectRunTasks } from "./task_graph";
import { listRuns, loadRun } from "../../../lib/execution_store";
import type { DashboardSnapshot, InventoryItem, RunView } from "./dashboard_model";

export type CollectDashboardOptions = {
  cwd: string;
  graphPath: string;
  focus: string[];
  current?: string;
  signals: string[];
  now?: () => string;
  // Execution/Evidence selectors — the same contract route_graph,
  // inspect_graph, and the store CLIs accept (Issue #246).
  run?: string;
  stateRoot?: string;
  allowExternalRoot?: boolean;
};

export async function collectDashboard(options: CollectDashboardOptions): Promise<DashboardSnapshot> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const definition = loadGraphDefinition(options.graphPath);
  if (options.current !== undefined && !Object.hasOwn(definition.nodes, options.current)) {
    throw new Error(`Unknown graph node: ${options.current}`);
  }

  const declaredSignals = new Set([
    ...Object.values(definition.conditions).flatMap((condition) =>
      condition.kind === "signal" ? [condition.signal] : []),
    ...(definition.runtimeSignals ?? []),
  ]);
  for (const signal of options.signals) {
    if (!declaredSignals.has(signal)) {
      throw new Error(`Unknown signal not declared by graph definition: ${signal}`);
    }
  }

  const storeOptions = {
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  };
  // The findings sweep reads the SAME store the summary and run views do —
  // a selected `--state-root` scopes the repo-level `evidence` gate, never
  // silently falls back to the default root (Issue #246).
  const collected = await collectFindings(options.cwd, {
    type: "all",
    externalLinks: false,
    ...storeOptions,
  });
  const artifacts = scanArtifactGraph({ cwd: options.cwd });
  // The preview must show the same verification authority routing sees
  // (Issues #243/#246): derive the HEAD-bound Verification Summary exactly
  // like route_graph's auto-compute — an empty Evidence Store is still a
  // legitimate input (its checks report undetermined), while a missing
  // summary would leave the phantom `verification-summary` blocker that
  // #243 fixed. The store's own marker state rides alongside so the
  // panel can tell an absent store from an initialized empty one.
  const evidenceStore = inspectEvidenceStore(options.cwd, storeOptions);
  const verificationSummary = await buildVerificationSummary(options.cwd, {
    subject: { kind: "commit", commit: "HEAD" },
  }, storeOptions);
  const state = await projectGraphState({
    cwd: options.cwd,
    graphId: definition.id,
    focus: options.focus,
    signals: options.signals,
    runId: options.run,
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
    verificationSummary,
  });
  const decision = options.current === undefined
    ? null
    : evaluateRouteDecision({ current: options.current, definition, state });

  const inventoryByPath = new Map<string, InventoryItem>();
  for (const document of collected.model.documents) {
    if (document.kind === "index") continue;
    inventoryByPath.set(document.path, {
      path: document.path,
      id: document.id,
      type: document.type,
      title: document.title ?? document.path,
      status: document.status,
      updated: document.updated,
      kind: document.kind,
      graphCovered: false,
      parseError: document.parseError,
    });
  }
  for (const record of artifacts.records) {
    const prior = inventoryByPath.get(record.path);
    inventoryByPath.set(record.path, {
      path: record.path,
      id: record.id,
      type: record.type,
      title: prior?.title ?? record.path,
      status: record.status,
      updated: prior?.updated ?? null,
      kind: "canonical",
      graphCovered: true,
      parseError: prior?.parseError
        ?? (record.relationIssues.some((issue) => issue.startsWith("invalid-document:"))
          ? "invalid-document"
          : null),
    });
  }

  const inventory = [...inventoryByPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  // Runs replace the v2 per-plan views: each loadable Execution Store run
  // projects its own task graph (Issue #237). A corrupt run listing cannot
  // project — it stays visible through `state.blockers` instead.
  const runs: RunView[] = [];
  for (const run of listRuns(options.cwd, storeOptions)) {
    try {
      runs.push({
        runId: run.runId,
        status: run.status,
        graph: projectRunTasks(loadRun(options.cwd, run.runId, storeOptions)),
      });
    } catch {
      // corrupt run — skipped; the state projection surfaces it as a blocker.
    }
  }

  return {
    schemaVersion: 1,
    startedAt,
    generatedAt: now(),
    repositoryName: path.basename(path.resolve(options.cwd)),
    requested: {
      focus: [...options.focus],
      current: options.current ?? null,
      signals: [...options.signals],
    },
    definition: inspectGraphDefinition(definition),
    state,
    decision,
    evidenceStore,
    inventory,
    runs,
    findings: collected.findings,
    health: summarizeHealth(collected, collected.findings),
    coverageNotes: [
      "標準 doc-status audit。専用 impl-record audit の代替ではありません。",
      "生成中の編集に対する原子的 snapshot は保証しません。",
      "Graph 対象外の文書は inventory のみ。現在ノードは指定値です。",
    ],
  };
}
