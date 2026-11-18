"use strict";

// Dynamic Task Graph (Issue #237) — a deterministic, read-only projection
// of one Execution Store run (`#236`). The v2 input (a plan Markdown path
// plus a `--task-dir` scan of task documents) is retired: `plan` and `task`
// are execution-bound under Document Registry 3, so the projection reads
// the run's `plan.md` approval and `tasks/<id>.json` records — never
// durable Markdown, never another run's records.
//
// Task identity is (runId, taskId): `dependsOn` entries are sibling task
// ids inside the same run (the write boundary already rejects cross-run
// spellings), and the projection never mixes runs — a caller selects the
// run, the graph follows only that run's records.
//
// Graph-gate semantics preserved from v2:
//   - runnable: `todo` tasks whose predecessors are all `done`;
//   - active: every `in-progress` task;
//   - resumableActive: `in-progress` tasks whose predecessors are all `done`;
//   - `wont-do` never satisfies a dependency;
//   - fail closed: ANY issue (plan gate, duplicates, dangling refs, cycles,
//     empty selection) empties runnable and resumableActive.
//
// New for v3 — the approval gate is part of the projection: a run whose
// `plan.md` is absent or whose approval does not bind the CURRENT digest
// (plan changed after approval → digest drift → re-approval required, or
// plan.md edited outside the store API → drift flagged outright) reports
// `plan-not-approved` and fails closed, so no route can reach task
// execution before approval.

import path from "node:path";

import {
  loadRun,
  type RunSnapshot,
  type TaskRecord,
  type TaskStatus,
} from "../../../lib/execution_store";

export type { TaskStatus };

export type BuildTaskGraphOptions = {
  cwd: string;
  runId: string;
  stateRoot?: string;
  allowExternalRoot?: boolean;
};

export type TaskGraphEdge = {
  from: string;
  to: string;
};

export type TaskGraphIssueCode =
  | "plan-missing"
  | "plan-not-approved"
  | "plan-digest-drift"
  | "plan-has-no-tasks"
  | "duplicate-task-id"
  | "missing-task-reference"
  | "task-cycle";

export type TaskGraphIssue = {
  code: TaskGraphIssueCode;
  message: string;
  tasks: string[];
};

export type TaskGraphNode = {
  id: string;
  // State-root-relative record path (`runs/<run-id>/tasks/<id>.json`) — the
  // task's store identity, never a Git-tracked document path.
  path: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  // Derived — every sibling whose dependsOn includes this task. v2 carried
  // an explicit `blocks` relation; the record DAG declares the same
  // information once, so blocks is the reverse projection of dependsOn.
  blocks: string[];
  // Declared write-scope entries — the authority the parallel-scope
  // judgment compares against.
  scope: string[];
  // The record's CAS version at projection time — evidence refs pin it.
  version: number;
};

export type TaskGraphPlan = {
  // State-root-relative `plan.md` path.
  path: string;
  digest: string;
  approved: boolean;
};

export type TaskGraphResult = {
  schemaVersion: 2;
  runId: string;
  plan: TaskGraphPlan | null;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  runnable: string[];
  active: string[];
  resumableActive: string[];
  completed: string[];
  blocked: Array<{ id: string; reasons: string[] }>;
  issues: TaskGraphIssue[];
};

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** State-root-relative record path for a task in `runId`. */
export function taskRecordPath(runId: string, taskId: string): string {
  return `runs/${runId}/tasks/${taskId}.json`;
}

/** State-root-relative plan path for `runId`. */
export function runPlanPath(runId: string): string {
  return `runs/${runId}/plan.md`;
}

function findCycles(ids: string[], edges: TaskGraphEdge[]): TaskGraphIssue[] {
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    const successors = adjacency.get(edge.from);
    if (successors) successors.push(edge.to);
  }
  for (const successors of adjacency.values()) successors.sort(compareStrings);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const walk = (id: string, stack: string[]): void => {
    visiting.add(id);
    stack.push(id);
    for (const next of adjacency.get(id) || []) {
      if (visiting.has(next)) {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start).sort(compareStrings);
        cycles.add(cycle.join(" -> "));
      } else if (!visited.has(next)) {
        walk(next, stack);
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) if (!visited.has(id)) walk(id, []);
  return [...cycles].sort(compareStrings).map((cycle) => ({
    code: "task-cycle" as const,
    tasks: cycle.split(" -> "),
    message: `Task dependency cycle detected: ${cycle}`,
  }));
}

function issueCompare(left: TaskGraphIssue, right: TaskGraphIssue): number {
  return compareStrings(left.code, right.code)
    || compareStrings(left.tasks.join(","), right.tasks.join(","))
    || compareStrings(left.message, right.message);
}

/**
 * Project one loaded run snapshot into a task graph. Pure — the caller owns
 * the load, so `graph_state` and `build_task_graph` share exactly this
 * projection for an explicitly selected run.
 */
export function projectRunTasks(snapshot: RunSnapshot): TaskGraphResult {
  const { runId } = snapshot;
  const issues: TaskGraphIssue[] = [];

  // Plan + approval gate. An approval binds the digest it approved; any
  // later savePlan invalidates it, and drift (a write outside the store
  // API) is surfaced as its own integrity issue on top of the gate.
  let plan: TaskGraphPlan | null = null;
  if (snapshot.plan === null) {
    issues.push({
      code: "plan-missing",
      tasks: [],
      message: `run ${runId} has no plan.md — the plan must exist inside the run before task execution`,
    });
  } else {
    plan = { path: runPlanPath(runId), digest: snapshot.plan.digest, approved: snapshot.planApproved };
    if (!snapshot.planApproved) {
      issues.push({
        code: "plan-not-approved",
        tasks: [],
        message: `run ${runId} plan.md is not approved (or approval predates the current digest) — task execution requires a digest-bound approval`,
      });
    }
  }
  if (snapshot.planDigestDrift) {
    issues.push({
      code: "plan-digest-drift",
      tasks: [],
      message: `run ${runId} plan.md diverges from the digest recorded in manifest.json — a write outside the Execution Store API was detected`,
    });
  }

  // Task index. Records carry `runId` themselves — a file that does not
  // belong to this run is corrupt-state at load, so every record here is
  // already same-run by construction.
  const byId = new Map<string, TaskRecord>();
  for (const task of [...snapshot.tasks].sort((left, right) => compareStrings(left.taskId, right.taskId))) {
    if (byId.has(task.taskId)) {
      issues.push({
        code: "duplicate-task-id",
        tasks: [task.taskId],
        message: `Duplicate task id ${task.taskId} in run ${runId}`,
      });
      continue;
    }
    byId.set(task.taskId, task);
  }
  const tasks = [...byId.values()];

  // Same-run dependency edges; the record-level `blocks` relation is the
  // derived reverse projection (no separate field to drift out of sync).
  const edges = new Map<string, TaskGraphEdge>();
  const blocksById = new Map<string, Set<string>>(tasks.map((task) => [task.taskId, new Set<string>()]));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) {
        issues.push({
          code: "missing-task-reference",
          tasks: [task.taskId],
          message: `Task ${task.taskId} depends on ${dep}, which does not exist in run ${runId} — dependencies resolve inside the same run only`,
        });
        continue;
      }
      edges.set(`${dep}${task.taskId}`, { from: dep, to: task.taskId });
      blocksById.get(dep)?.add(task.taskId);
    }
  }
  const sortedEdges = [...edges.values()]
    .sort((left, right) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to));
  issues.push(...findCycles(tasks.map((task) => task.taskId), sortedEdges));
  if (tasks.length === 0) {
    issues.push({
      code: "plan-has-no-tasks",
      tasks: [],
      message: `run ${runId} has no task records — the plan must materialize at least one task`,
    });
  }
  const uniqueIssues = [...new Map(issues.map((issue) => [
    `${issue.code}${issue.tasks.join(",")}${issue.message}`,
    issue,
  ])).values()].sort(issueCompare);

  const statusById = new Map(tasks.map((task) => [task.taskId, task.status]));
  const predecessorsDone = (taskId: string): boolean => sortedEdges
    .filter((edge) => edge.to === taskId)
    .every((edge) => statusById.get(edge.from) === "done");
  // Fail closed: ANY issue empties runnable and resumableActive. Blocked
  // still reports so a caller can see why each task cannot start.
  const runnable = uniqueIssues.length > 0
    ? []
    : tasks
      .filter((task) => task.status === "todo" && predecessorsDone(task.taskId))
      .map((task) => task.taskId);
  const active = tasks.filter((task) => task.status === "in-progress").map((task) => task.taskId);
  const resumableActive = uniqueIssues.length > 0
    ? []
    : tasks
      .filter((task) => task.status === "in-progress" && predecessorsDone(task.taskId))
      .map((task) => task.taskId);
  const completed = tasks.filter((task) => task.status === "done").map((task) => task.taskId);
  const blocked = tasks
    .filter((task) => task.status === "blocked" || task.status === "wont-do" || (task.status === "todo" && !runnable.includes(task.taskId)))
    .map((task) => ({
      id: task.taskId,
      reasons: task.status === "blocked"
        ? ["status:blocked"]
        : task.status === "wont-do"
          ? ["status:wont-do"]
          : sortedEdges
            .filter((edge) => edge.to === task.taskId && statusById.get(edge.from) !== "done")
            .map((edge) => `depends-on:${edge.from}`),
    }))
    .filter((entry) => entry.reasons.length > 0);

  return {
    schemaVersion: 2,
    runId,
    plan,
    nodes: tasks.map((task) => ({
      id: task.taskId,
      path: taskRecordPath(runId, task.taskId),
      title: task.title,
      status: task.status,
      dependsOn: sortedUnique(task.dependsOn),
      blocks: sortedUnique(blocksById.get(task.taskId) ?? []),
      scope: [...task.scope].sort(compareStrings),
      version: task.version,
    })),
    edges: sortedEdges,
    runnable: runnable.sort(compareStrings),
    active: active.sort(compareStrings),
    resumableActive: resumableActive.sort(compareStrings),
    completed: completed.sort(compareStrings),
    blocked,
    issues: uniqueIssues,
  };
}

/**
 * Load `runId` from the Execution Store and project its task graph. The
 * run selector is the caller's: no fallback, no cross-run mixing — a
 * missing or corrupt run surfaces the store's fail-closed error.
 */
export function buildTaskGraph(options: BuildTaskGraphOptions): TaskGraphResult {
  const cwd = path.resolve(options.cwd);
  const snapshot = loadRun(cwd, options.runId, {
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  });
  return projectRunTasks(snapshot);
}
