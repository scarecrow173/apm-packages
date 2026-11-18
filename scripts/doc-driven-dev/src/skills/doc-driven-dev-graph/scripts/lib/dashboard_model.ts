import type { GraphInspection } from "./graph_inspector";
import type { GraphState } from "./graph_state";
import type { RouteDecision } from "./graph_router";
import type { TaskGraphResult } from "./task_graph";
import type { Finding } from "../../../lib/doc_repository";
import type { HealthReport } from "../../../lib/doc_report";

export type InventoryItem = {
  path: string;
  id: string | null;
  type: string | null;
  title: string;
  status: string | null;
  updated: string | null;
  // "legacy" is carried through from doc inventory so migration-era corpus
  // (e.g. plan/task Markdown) stays visibly labeled rather than misfiled.
  kind: "legacy" | "canonical" | "unmanaged";
  graphCovered: boolean;
  parseError: string | null;
};

/**
 * One Execution Store run projected for the dashboard — the v3 replacement
 * for the Markdown plan view (Issue #237): `runId` + run status + the
 * run-scoped task-graph projection.
 */
export type RunView = {
  runId: string;
  status: string | null;
  graph: TaskGraphResult;
};

export type DashboardSnapshot = {
  schemaVersion: 1;
  startedAt: string;
  generatedAt: string;
  repositoryName: string;
  requested: { focus: string[]; current: string | null; signals: string[] };
  definition: GraphInspection;
  state: GraphState;
  decision: RouteDecision | null;
  inventory: InventoryItem[];
  runs: RunView[];
  findings: Finding[];
  health: HealthReport;
  coverageNotes: string[];
};

export type TaskSummary = {
  total: number;
  done: number;
  wontDo: number;
  remaining: number;
  unknown: number;
  doneRatio: number | null;
};

export function documentBucket(status: string | null): "draft" | "proposed" | "capturing" | "other" {
  return status === "draft" || status === "proposed" || status === "capturing" ? status : "other";
}

export function summarizeTasks(rows: readonly { path: string; status: string | null }[]): TaskSummary {
  const statusesByPath = new Map<string, Set<string | null>>();
  for (const row of rows) {
    const statuses = statusesByPath.get(row.path) ?? new Set<string | null>();
    statuses.add(row.status);
    statusesByPath.set(row.path, statuses);
  }
  const unique = [...statusesByPath].map(([path, statuses]) => ({
    path,
    status: statuses.size === 1 ? [...statuses][0] : null,
  }));
  const valid = new Set(["todo", "in-progress", "blocked", "done", "wont-do"]);
  const count = (status: string) => unique.filter((row) => row.status === status).length;
  const total = unique.filter((row) => valid.has(row.status ?? "")).length;
  const done = count("done");
  return {
    total,
    done,
    wontDo: count("wont-do"),
    remaining: count("todo") + count("in-progress") + count("blocked"),
    unknown: unique.length - total,
    doneRatio: total === 0 ? null : done / total,
  };
}
