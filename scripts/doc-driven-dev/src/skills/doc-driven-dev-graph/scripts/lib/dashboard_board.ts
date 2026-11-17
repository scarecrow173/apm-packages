import type { InventoryItem, RunView } from "./dashboard_model";

export type TaskLaneStatus = "todo" | "in-progress" | "blocked" | "done" | "wont-do" | "unknown";

export type TaskRunMembership = {
  run: string;
  taskId: string;
  dependencies: string[];
  runnable: boolean;
  resumable: boolean;
  blockReasons: string[];
};

export type TaskCard = {
  path: string;
  id: string | null;
  title: string;
  status: string | null;
  lane: TaskLaneStatus;
  parseError: string | null;
  coverage: "covered" | "no-run" | "graph-uncovered";
  memberships: TaskRunMembership[];
};

export type TaskLane = {
  status: TaskLaneStatus;
  label: string;
  cards: TaskCard[];
};

const permanentLanes: ReadonlyArray<{ status: Exclude<TaskLaneStatus, "unknown">; label: string }> = [
  { status: "todo", label: "todo / 未着手" },
  { status: "in-progress", label: "in-progress / 進行中" },
  { status: "blocked", label: "blocked / ブロック中" },
  { status: "done", label: "done / 完了" },
  { status: "wont-do", label: "wont-do / 見送り" },
];

const validStatuses = new Set(permanentLanes.map((lane) => lane.status));
const compare = (left: string, right: string): number => left.localeCompare(right);

function laneFor(item: InventoryItem): TaskLaneStatus {
  if (item.parseError !== null || !validStatuses.has(item.status as Exclude<TaskLaneStatus, "unknown">)) return "unknown";
  return item.status as Exclude<TaskLaneStatus, "unknown">;
}

/**
 * Task cards now come from run-scoped graph nodes (store records, Issue
 * #237): each node is a card keyed by its state-root-relative record path.
 * A legacy task-typed Markdown still in inventory renders as a `no-run`
 * card — it exists on disk but no run claims it.
 */
export function buildTaskBoard(inventory: readonly InventoryItem[], runs: readonly RunView[]): { lanes: TaskLane[] } {
  const cardsByPath = new Map<string, TaskCard>();
  for (const run of runs) {
    const blockedById = new Map(run.graph.blocked.map((entry) => [entry.id, entry.reasons]));
    for (const node of run.graph.nodes) {
      cardsByPath.set(node.path, {
        path: node.path,
        id: node.id,
        title: node.title,
        status: node.status,
        lane: validStatuses.has(node.status as Exclude<TaskLaneStatus, "unknown">)
          ? node.status as Exclude<TaskLaneStatus, "unknown">
          : "unknown",
        parseError: null,
        coverage: "covered",
        memberships: [{
          run: run.runId,
          taskId: node.id,
          dependencies: [...node.dependsOn],
          runnable: run.graph.runnable.includes(node.id),
          resumable: run.graph.resumableActive.includes(node.id),
          blockReasons: [...(blockedById.get(node.id) ?? [])],
        }],
      });
    }
  }

  for (const item of inventory) {
    if (item.kind !== "canonical" || item.type !== "task" || cardsByPath.has(item.path)) continue;
    cardsByPath.set(item.path, {
      path: item.path,
      id: item.id,
      title: item.title,
      status: item.status,
      lane: laneFor(item),
      parseError: item.parseError,
      coverage: !item.graphCovered ? "graph-uncovered" : "no-run",
      memberships: [],
    });
  }

  const cards = [...cardsByPath.values()].sort((left, right) => compare(left.path, right.path));
  const lanes: TaskLane[] = permanentLanes.map((lane) => ({
    ...lane,
    cards: cards.filter((card) => card.lane === lane.status),
  }));
  const unknown = cards.filter((card) => card.lane === "unknown");
  if (unknown.length > 0) lanes.push({ status: "unknown", label: "unknown / 不明", cards: unknown });
  return { lanes };
}
