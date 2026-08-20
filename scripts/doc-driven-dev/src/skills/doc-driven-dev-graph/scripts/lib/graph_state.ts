import fs from "node:fs";
import path from "node:path";

import {
  artifactHasRelation,
  projectArtifactGraph,
  resolveArtifactFocus,
  scanArtifactGraph,
  selectArtifactChain,
  type ArtifactGraph,
  type ArtifactRecord,
} from "./artifact_graph";
import {
  buildTaskGraph,
  type TaskGraphResult,
} from "./task_graph";

export type GraphGateResult = { status: "pass" | "fail" | "blocked"; reasons: string[] };
export type GraphGateResults = Record<string, GraphGateResult>;
export type GraphSignal = string;
export type GraphState = {
  schemaVersion: 2;
  graphId: string;
  cwd: string;
  taskDir: string;
  focus: string[];
  artifactGraph: ArtifactGraph;
  gates: GraphGateResults;
  signals: GraphSignal[];
  blockers: string[];
  hardBlockers: string[];
  taskGraph: TaskGraphResult | null;
};

export type ProjectGraphStateOptions = {
  cwd: string;
  graphId?: string;
  taskDir?: string;
  focus?: string[];
  signals?: GraphSignal[];
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

function graphTask(cwd: string, plan: ArtifactRecord | undefined, taskDir: string): TaskGraphResult | null {
  return plan ? buildTaskGraph({ cwd, plan: plan.path, taskDir }) : null;
}

function deriveSignals(input: GraphSignal[], blockers: string[], gates: GraphGateResults, taskGraph: TaskGraphResult | null): GraphSignal[] {
  const signals = new Set(input);
  if (blockers.includes("focus-required")) signals.add("focus-required");
  if (blockers.includes("bootstrap-incomplete")) signals.add("bootstrap-incomplete");
  const followups = [...signals].filter((signal) => FOLLOWUP_SIGNALS.has(signal));
  if (followups.length === 0) signals.add("followups-unclassified");
  if (followups.length > 1) signals.add("followups-conflicting");
  if (blockers.length === 0 && Object.values(gates).length > 0 && Object.values(gates).every((result) => result.status === "pass")
    && (!taskGraph || taskGraph.issues.length === 0)) signals.add("graph-complete");
  return sortedUnique(signals);
}

function deriveHardBlockers(blockers: string[], signals: GraphSignal[], gates: GraphGateResults): string[] {
  return sortedUnique([
    ...blockers.filter((blocker) => blocker === "focus-required"
      || blocker === "focus-invalid"
      || blocker === "duplicate-id"
      || blocker.startsWith("broken-relation:")),
    ...(signals.includes("followups-conflicting") ? ["followups-conflicting"] : []),
    ...(gates["artifact-graph"]?.status !== "pass" && gates["artifact-graph"] ? ["artifact-graph"] : []),
  ]);
}

function fallbackRecords(cwd: string, graph: ArtifactGraph): ArtifactRecord[] {
  return graph.nodes.map((node) => ({
    ...node,
    absolutePath: path.join(cwd, node.path),
    body: "",
    status: null,
    relations: {},
    relationIssues: [],
  }));
}

/** Evaluate generic gate facts from a projected Graph State. */
export function evaluateGraphGates(state: GraphState): GraphGateResults {
  const cwd = path.resolve(state.cwd);
  const projection = scanArtifactGraph({ cwd, taskDir: state.taskDir });
  const records = projection.records.length > 0 ? projection.records : fallbackRecords(cwd, state.artifactGraph);
  const resolution = resolveArtifactFocus(cwd, state.artifactGraph, records, state.focus);
  const focused = findRecord(records, resolution.focusedPath);
  const chain = focused ? selectArtifactChain(state.artifactGraph, records, state.focus) : undefined;
  const taskGraph = state.taskGraph;
  const bootstrap = bootstrapReasons(cwd);
  const gates: GraphGateResults = {
    bootstrap: gate(bootstrap.length === 0 ? "pass" : "fail", bootstrap),
  };
  const graphIssues = [...new Map([
    ...state.artifactGraph.issues,
    ...projection.graph.issues,
  ].map((issue) => [`${issue.code}\u0000${issue.message}`, issue])).values()];
  if (graphIssues.length > 0) {
    gates["artifact-graph"] = gate("blocked", graphIssues.map((issue) => `artifact-graph:${issue.code}`));
  }
  if (!focused) {
    gates.briefing = gate(state.blockers.includes("focus-required") ? "blocked" : "fail", [state.blockers.includes("focus-required") ? "focus-required" : "focus-missing"]);
    gates.design = gate("blocked", ["focus-required"]);
    gates.planning = gate("blocked", ["focus-required"]);
    gates.implementation = gate("blocked", ["focus-required"]);
  } else {
    const spec = findRecord(records, chain?.spec);
    const adr = findRecord(records, chain?.adr);
    const design = findRecord(records, chain?.design);
    const plan = findRecord(records, chain?.plan);

    const briefingReasons: string[] = [];
    if (!spec || !["proposed", "approved", "implemented"].includes(spec.status ?? "")) briefingReasons.push("spec-status");
    if (!spec || !sectionBody(spec.body, "Acceptance Criteria")) briefingReasons.push("acceptance-criteria");
    if (!adr || !["proposed", "accepted"].includes(adr.status ?? "")) briefingReasons.push("adr-status");
    if (!adr || consideredOptionCount(adr.body) < 2) briefingReasons.push("considered-options");
    gates.briefing = gate(briefingReasons.length === 0 ? "pass" : "fail", briefingReasons);

    const designReasons: string[] = [];
    if (!design || design.status !== "approved") designReasons.push("design-status");
    if (!design || !artifactHasRelation(state.artifactGraph, design.path, ["derives-from", "implements"], spec?.path)) designReasons.push("design-spec-relation");
    if (!design || !artifactHasRelation(state.artifactGraph, design.path, ["derives-from"], adr?.path)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    const planningReasons: string[] = [];
    if (!plan || !["approved", "in-progress", "completed"].includes(plan.status ?? "")) planningReasons.push("plan-status");
    if (!plan || !artifactHasRelation(state.artifactGraph, plan.path, ["derives-from", "design"], design?.path)) planningReasons.push("plan-design-relation");
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
  const resolution = resolveArtifactFocus(cwd, projection.graph, projection.records, options.focus ?? []);
  const blockers = sortedUnique([
    ...resolution.blockers,
    ...projection.graph.issues.map((issue) => issue.code === "duplicate-id" ? "duplicate-id" : `broken-relation:${issue.message}`),
    ...(projection.graph.issues.some((issue) => issue.code === "duplicate-id") ? ["focus-required"] : []),
    ...(bootstrapReasons(cwd).length > 0 ? ["bootstrap-incomplete"] : []),
  ]);
  const chain = resolution.blockers.length === 0
    && !projection.graph.issues.some((issue) => issue.code === "duplicate-id")
    ? selectArtifactChain(projection.graph, projection.records, resolution.focus)
    : undefined;
  const plan = findRecord(projection.records, chain?.plan);
  const taskGraph = graphTask(cwd, plan, taskDir);
  if (taskGraph?.issues.length) blockers.push("task-graph-invalid");
  const state: GraphState = {
    schemaVersion: 2,
    graphId: options.graphId ?? "doc-driven-dev",
    cwd,
    taskDir,
    focus: resolution.focus,
    artifactGraph: projection.graph,
    gates: {},
    signals: sortedUnique(options.signals ?? []),
    blockers: sortedUnique(blockers),
    hardBlockers: [],
    taskGraph,
  };
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.gates = evaluateGraphGates(state);
  if (state.gates.planning?.reasons.some((reason) => reason.startsWith("task-graph:"))) {
    state.blockers = sortedUnique([...state.blockers, "task-graph-invalid"]);
    state.gates = evaluateGraphGates(state);
  }
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.hardBlockers = deriveHardBlockers(state.blockers, state.signals, state.gates);
  return state;
}

export { projectArtifactGraph };
