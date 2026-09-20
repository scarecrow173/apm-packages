import path from "node:path";

import { collectFindings, summarizeHealth } from "../../../lib/doc_report";
import { scanArtifactGraph } from "./artifact_graph";
import { loadGraphDefinition } from "./graph_definition";
import { inspectGraphDefinition } from "./graph_inspector";
import { evaluateRouteDecision } from "./graph_router";
import { projectGraphState } from "./graph_state";
import { buildTaskGraph } from "./task_graph";
import type { DashboardSnapshot, InventoryItem } from "./dashboard_model";

export type CollectDashboardOptions = {
  cwd: string;
  graphPath: string;
  focus: string[];
  current?: string;
  signals: string[];
  now?: () => string;
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

  const collected = await collectFindings(options.cwd, { type: "all", externalLinks: false });
  const artifacts = scanArtifactGraph({ cwd: options.cwd });
  const state = projectGraphState({
    cwd: options.cwd,
    graphId: definition.id,
    focus: options.focus,
    signals: options.signals,
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
  const plans = artifacts.records
    .filter((record) => record.type === "plan")
    .map((record) => ({
      path: record.path,
      status: record.status,
      graph: buildTaskGraph({ cwd: options.cwd, plan: record.path }),
    }));

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
    inventory,
    plans,
    findings: collected.findings,
    health: summarizeHealth(collected, collected.findings),
    coverageNotes: [
      "標準 doc-status audit。専用 impl-record audit の代替ではありません。",
      "生成中の編集に対する原子的 snapshot は保証しません。",
      "Graph 対象外の文書は inventory のみ。現在ノードは指定値です。",
    ],
  };
}
