import type { InventoryItem, PlanView } from "./dashboard_model";

export type TaskLaneStatus = "todo" | "in-progress" | "blocked" | "done" | "wont-do" | "unknown";

export type TaskPlanMembership = {
  plan: string;
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
  coverage: "covered" | "no-plan" | "graph-uncovered";
  memberships: TaskPlanMembership[];
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

export function buildTaskBoard(inventory: readonly InventoryItem[], plans: readonly PlanView[]): { lanes: TaskLane[] } {
  const memberships = new Map<string, TaskPlanMembership[]>();
  for (const plan of plans) {
    const blockedById = new Map(plan.graph.blocked.map((entry) => [entry.id, entry.reasons]));
    for (const node of plan.graph.nodes) {
      const entries = memberships.get(node.path) ?? [];
      entries.push({
        plan: plan.path,
        taskId: node.id,
        dependencies: [...node.dependsOn],
        runnable: plan.graph.runnable.includes(node.id),
        resumable: plan.graph.resumableActive.includes(node.id),
        blockReasons: [...(blockedById.get(node.id) ?? [])],
      });
      memberships.set(node.path, entries);
    }
  }

  const cardsByPath = new Map<string, TaskCard>();
  for (const item of inventory) {
    if (item.kind !== "canonical" || item.type !== "task") continue;
    const entries = [...(memberships.get(item.path) ?? [])].sort((left, right) => compare(left.plan, right.plan));
    cardsByPath.set(item.path, {
      path: item.path,
      id: item.id,
      title: item.title,
      status: item.status,
      lane: laneFor(item),
      parseError: item.parseError,
      coverage: !item.graphCovered ? "graph-uncovered" : entries.length === 0 ? "no-plan" : "covered",
      memberships: entries,
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
