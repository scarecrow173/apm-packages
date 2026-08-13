import fs from "node:fs";
import path from "node:path";

import {
  lineageComponent,
  projectArtifactGraph,
  resolveArtifactRelation,
  scanArtifactGraph,
  selectPlanPath,
  type ArtifactGraph,
  type ArtifactRecord,
} from "./artifact_graph";
import {
  buildTaskGraph,
  type TaskGraphResult,
} from "../../../doc-driven-dev-lifecycle/scripts/lib/task_graph";

export type GraphGateResult = { status: "pass" | "fail" | "blocked"; reasons: string[] };
export type GraphGateResults = Record<string, GraphGateResult>;
export type GraphState = {
  schemaVersion: 2;
  graphId: string;
  cwd: string;
  focus: string[];
  artifactGraph: ArtifactGraph;
  gates: GraphGateResults;
  signals: string[];
  blockers: string[];
  taskGraph: TaskGraphResult | null;
};

export type ProjectGraphStateOptions = {
  cwd: string;
  graphId?: string;
  focus?: string[];
  signals?: string[];
  taskDir?: string;
};

const CANONICAL_TARGETS = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
] as const;
const ACTIVE_STATUSES = new Set([
  "draft", "proposed", "approved", "in-progress", "todo", "blocked", "capturing",
  "confirmed", "routed", "active",
]);
const FOLLOWUP_SIGNALS = new Set([
  "followup-bug-fix",
  "followup-decision-briefing",
  "followup-decision-design",
  "followup-new-feature",
  "followup-doc-only",
  "followup-terminal",
]);

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function gate(status: GraphGateResult["status"], reasons: string[] = []): GraphGateResult {
  return { status, reasons: sortedUnique(reasons) };
}

function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
  if (start < 0) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const section = endOffset < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + endOffset);
  return section.join("\n").trim();
}

function consideredOptionCount(body: string): number {
  const section = sectionBody(body, "Considered Options");
  if (!section) return 0;
  const headings = section.match(/^###\s+.+$/gim)?.length ?? 0;
  const listItems = section.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  return Math.max(headings, listItems);
}

function bootstrapReasons(cwd: string): string[] {
  const reasons: string[] = [];
  for (const directory of CANONICAL_TARGETS) {
    const full = path.join(cwd, directory);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) reasons.push(`missing-directory:${directory}`);
    if (!fs.existsSync(path.join(full, "README.md"))) reasons.push(`missing-index:${directory}/README.md`);
  }
  return reasons;
}

function findRecord(records: ArtifactRecord[], pathValue: string | undefined): ArtifactRecord | undefined {
  return pathValue ? records.find((record) => record.path === pathValue) : undefined;
}

function relationTarget(
  cwd: string,
  source: ArtifactRecord | undefined,
  value: string,
  records: ArtifactRecord[],
): ArtifactRecord | undefined {
  return source ? resolveArtifactRelation(cwd, source, value, records) : undefined;
}

function hasRelation(
  cwd: string,
  source: ArtifactRecord | undefined,
  names: string[],
  target: ArtifactRecord | undefined,
  records: ArtifactRecord[],
): boolean {
  if (!source || !target) return false;
  return names.some((name) => (source.relations[name] ?? []).some((value) => relationTarget(cwd, source, value, records)?.path === target.path));
}

function resolveFocus(
  cwd: string,
  values: string[],
  records: ArtifactRecord[],
  graph: ArtifactGraph,
): { focus: string[]; focused: ArtifactRecord | undefined; blockers: string[] } {
  if (values.length === 0) {
    const active = records.filter((record) => record.status && ACTIVE_STATUSES.has(record.status));
    return { focus: [], focused: undefined, blockers: active.length > 0 ? ["focus-required"] : [] };
  }
  let duplicateId = false;
  const normalized = values.map((value) => {
    const byId = records.filter((record) => record.id === value);
    if (byId.length > 1) {
      duplicateId = true;
      return value;
    }
    if (byId.length === 1) return byId[0].path;
    const absolute = path.resolve(cwd, value);
    return path.relative(cwd, absolute).split(path.sep).join("/");
  });
  const focus = sortedUnique(normalized);
  if (duplicateId) return { focus, focused: undefined, blockers: ["focus-required"] };
  const focused = focus.map((entry) => records.find((record) => record.path === entry));
  if (focused.some((record) => !record)) return { focus, focused: undefined, blockers: ["focus-invalid"] };
  const component = lineageComponent(graph, focus);
  const plans = records.filter((record) => component.includes(record.path) && record.type === "plan");
  const hasPlanFocus = focused.some((record) => record?.type === "plan");
  if (!hasPlanFocus && plans.length > 1) return { focus, focused: undefined, blockers: ["focus-required"] };
  if (focus.length > 1 && focus.some((entry) => !component.includes(entry))) {
    return { focus, focused: undefined, blockers: ["focus-required"] };
  }
  const rank: Record<string, number> = { plan: 0, design: 1, spec: 2, adr: 3, task: 4 };
  return {
    focus,
    focused: [...focused].sort((left, right) => (rank[left?.type ?? ""] ?? 9) - (rank[right?.type ?? ""] ?? 9) || compareStrings(left?.path ?? "", right?.path ?? ""))[0],
    blockers: [],
  };
}

function focusedChain(
  cwd: string,
  focus: string[],
  records: ArtifactRecord[],
  graph: ArtifactGraph,
): { spec?: ArtifactRecord; adr?: ArtifactRecord; design?: ArtifactRecord; plan?: ArtifactRecord } {
  const component = new Set(lineageComponent(graph, focus));
  const planPath = selectPlanPath(graph, focus);
  const plan = findRecord(records, planPath);
  const focused = records.filter((record) => component.has(record.path));
  const design = focused.find((record) => record.type === "design" && (!plan || hasRelation(cwd, plan, ["derives-from", "design"], record, records)))
    ?? focused.find((record) => record.type === "design");
  const spec = focused.find((record) => record.type === "spec" && (!design || hasRelation(cwd, design, ["derives-from", "implements", "spec"], record, records)));
  const adr = focused.find((record) => record.type === "adr" && (!design || hasRelation(cwd, design, ["derives-from", "adr", "decision"], record, records)));
  return { spec, adr, design, plan };
}

function graphTask(
  cwd: string,
  plan: ArtifactRecord | undefined,
  taskDir: string,
): TaskGraphResult | null {
  return plan ? buildTaskGraph({ cwd, plan: plan.path, taskDir }) : null;
}

function deriveSignals(input: string[], blockers: string[], gates: GraphGateResults, taskGraph: TaskGraphResult | null): string[] {
  const signals = new Set(input);
  if (blockers.includes("focus-required")) signals.add("focus-required");
  const followups = [...signals].filter((signal) => FOLLOWUP_SIGNALS.has(signal));
  if (followups.length === 0) signals.add("followups-unclassified");
  if (followups.length > 1) signals.add("followups-conflicting");
  if (Object.values(gates).length > 0 && Object.values(gates).every((result) => result.status === "pass")
    && (!taskGraph || taskGraph.issues.length === 0)) signals.add("graph-complete");
  return sortedUnique(signals);
}

/** Evaluate generic gate facts from a projected Graph State. */
export function evaluateGraphGates(state: GraphState): GraphGateResults {
  const cwd = path.resolve(state.cwd);
  const projection = scanArtifactGraph({ cwd });
  const records = projection.records.length > 0
    ? projection.records
    : state.artifactGraph.nodes.map((node) => ({
      ...node,
      absolutePath: path.join(cwd, node.path),
      body: "",
      status: null,
      relations: {},
    }));
  const focused = resolveFocus(cwd, state.focus, records, state.artifactGraph).focused;
  const chain = focused ? focusedChain(cwd, state.focus, records, state.artifactGraph) : {};
  const taskGraph = state.taskGraph;
  const bootstrap = bootstrapReasons(cwd);
  const gates: GraphGateResults = {
    bootstrap: gate(bootstrap.length === 0 ? "pass" : "fail", bootstrap),
  };
  if (!focused) {
    gates.briefing = gate(state.blockers.includes("focus-required") ? "blocked" : "fail", [state.blockers.includes("focus-required") ? "focus-required" : "focus-missing"]);
    gates.design = gate("blocked", ["focus-required"]);
    gates.planning = gate("blocked", ["focus-required"]);
    gates.implementation = gate("blocked", ["focus-required"]);
  } else {
    const briefingReasons: string[] = [];
    if (!chain.spec || !["proposed", "approved", "implemented"].includes(chain.spec.status ?? "")) briefingReasons.push("spec-status");
    if (!chain.spec || !sectionBody(chain.spec.body, "Acceptance Criteria")) briefingReasons.push("acceptance-criteria");
    if (!chain.adr || !["proposed", "accepted"].includes(chain.adr.status ?? "")) briefingReasons.push("adr-status");
    if (!chain.adr || consideredOptionCount(chain.adr.body) < 2) briefingReasons.push("considered-options");
    gates.briefing = gate(briefingReasons.length === 0 ? "pass" : "fail", briefingReasons);

    const designReasons: string[] = [];
    if (!chain.design || chain.design.status !== "approved") designReasons.push("design-status");
    if (!chain.design || !hasRelation(cwd, chain.design, ["derives-from", "implements", "spec"], chain.spec, records)) designReasons.push("design-spec-relation");
    if (!chain.design || !hasRelation(cwd, chain.design, ["derives-from", "adr", "decision"], chain.adr, records)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    const planningReasons: string[] = [];
    if (!chain.plan || !["approved", "in-progress", "completed"].includes(chain.plan.status ?? "")) planningReasons.push("plan-status");
    if (!chain.plan || !hasRelation(cwd, chain.plan, ["derives-from", "design"], chain.design, records)) planningReasons.push("plan-design-relation");
    if (!taskGraph || taskGraph.nodes.length === 0) planningReasons.push("no-selected-tasks");
    if (taskGraph && taskGraph.issues.length > 0) planningReasons.push(...taskGraph.issues.map((issue) => `task-graph:${issue.code}`));
    gates.planning = gate(
      planningReasons.length === 0 ? "pass" : taskGraph && taskGraph.issues.length > 0 ? "blocked" : "fail",
      planningReasons,
    );

    const implementationReasons: string[] = [];
    if (!taskGraph || taskGraph.nodes.length === 0) implementationReasons.push("no-selected-tasks");
    if (taskGraph && taskGraph.nodes.some((node) => !["done", "wont-do"].includes(node.status))) implementationReasons.push("tasks-incomplete");
    if (!state.signals.includes("implementation-verified")) implementationReasons.push("implementation-verified");
    gates.implementation = gate(implementationReasons.length === 0 ? "pass" : "blocked", implementationReasons);
  }
  const followups = state.signals.filter((signal) => FOLLOWUP_SIGNALS.has(signal));
  gates["followup-triage"] = followups.length === 1 && !state.signals.includes("followups-unclassified")
    ? gate("pass")
    : followups.length === 0 ? gate("blocked", ["followups-unclassified"]) : gate("blocked", ["followups-conflicting"]);
  gates["exit-audit"] = state.signals.includes("exit-audit-pass") ? gate("pass") : gate("blocked", ["exit-audit-pass"]);
  return gates;
}

/** Project Markdown artifacts, focus, gates, signals, blockers, and the selected Task Graph. */
export function projectGraphState(options: ProjectGraphStateOptions): GraphState {
  const cwd = path.resolve(options.cwd);
  const taskDir = options.taskDir ?? "docs/tasks";
  const projection = scanArtifactGraph({ cwd, taskDir });
  const resolution = resolveFocus(cwd, options.focus ?? [], projection.records, projection.graph);
  const blockers = sortedUnique([
    ...resolution.blockers,
    ...projection.graph.issues.map((issue) => issue.code === "duplicate-id" ? "duplicate-id" : `broken-relation:${issue.message}`),
    ...(projection.graph.issues.some((issue) => issue.code === "duplicate-id") ? ["focus-required"] : []),
    ...(bootstrapReasons(cwd).length > 0 ? ["bootstrap-incomplete"] : []),
  ]);
  const planPath = resolution.focused && resolution.blockers.length === 0
    && !projection.graph.issues.some((issue) => issue.code === "duplicate-id")
    ? selectPlanPath(projection.graph, resolution.focus)
    : undefined;
  const plan = findRecord(projection.records, planPath);
  const taskGraph = graphTask(cwd, plan, taskDir);
  if (taskGraph?.issues.length) blockers.push("task-graph-invalid");
  const partial: GraphState = {
    schemaVersion: 2,
    graphId: options.graphId ?? "doc-driven-dev",
    cwd,
    focus: resolution.focus,
    artifactGraph: projection.graph,
    gates: {},
    signals: sortedUnique(options.signals ?? []),
    blockers: sortedUnique(blockers),
    taskGraph,
  };
  partial.signals = deriveSignals(partial.signals, partial.blockers, partial.gates, taskGraph);
  partial.gates = evaluateGraphGates(partial);
  if (partial.gates.planning?.reasons.some((reason) => reason.startsWith("task-graph:"))) {
    partial.blockers = sortedUnique([...partial.blockers, "task-graph-invalid"]);
    partial.gates = evaluateGraphGates(partial);
  }
  partial.signals = deriveSignals(partial.signals, partial.blockers, partial.gates, taskGraph);
  return partial;
}

export {
  lineageComponent,
  projectArtifactGraph,
  selectPlanPath,
};
