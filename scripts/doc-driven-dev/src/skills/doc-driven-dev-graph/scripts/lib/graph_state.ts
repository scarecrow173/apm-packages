import fs from "node:fs";
import path from "node:path";

import {
  artifactHasRelation,
  chainMembers,
  designAdrDecision,
  designClaimsAdr,
  designClaimsSpec,
  DURABLE_DOC_DIRS,
  projectArtifactGraph,
  resolveArtifactFocus,
  resolveContainedTaskDir,
  scanArtifactGraph,
  selectArtifactChain,
  type ArtifactChain,
  type ArtifactGraph,
  type ArtifactRecord,
  type ArtifactScanCollector,
} from "./artifact_graph";
import {
  projectRunTasks,
  type TaskGraphResult,
} from "./task_graph";
import {
  listRuns,
  loadRun,
  type RunSnapshot,
} from "../../../lib/execution_store";
import { sectionBody, subHeadingCount } from "../../../lib/markdown_sections";

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
  /**
   * The Execution Store run backing `taskGraph` (Issue #237): identity,
   * lifecycle status, and the artifact paths the run declared as its focus.
   * `focus` is null when the manifest's focus is absent, empty, or not a
   * string array — an unbound run can never satisfy `plan-design-relation`.
   */
  run: {
    runId: string;
    status: string;
    focus: string[] | null;
  } | null;
};

export type ProjectGraphStateOptions = {
  cwd: string;
  graphId?: string;
  taskDir?: string;
  focus?: string[];
  signals?: GraphSignal[];
  /**
   * Execution Store run selector (Issue #237): the run whose plan/tasks the
   * Dynamic Task Graph projects. When absent, the projection resolves the
   * store implicitly — exactly one active run bound to this graph — and
   * stays null (fail closed) when zero or several candidates exist.
   */
  runId?: string;
  stateRoot?: string;
  allowExternalRoot?: boolean;
};

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

function consideredOptionCount(body: string): number {
  const section = sectionBody(body, "Considered Options");
  if (!section) return 0;
  const headings = subHeadingCount(section);
  const listItems = section.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  return Math.max(headings, listItems);
}

// Indexes are derived (materialized) views, so a missing or stale README is
// never a bootstrap reason — only a genuinely absent canonical tree gates
// graph execution (Issue #195). Under Registry 3 the canonical tree is the
// durable doc set: execution-bound (plan/task) and legacy (impl/exp,
// test-spec) dirs are migration-owned — their absence is normal in a
// v3-native workspace, never a bootstrap reason (Issue #234).
// scaffold_docs still creates indexes when it runs; audit_docs --profile
// artifact keeps them out of graph-dispatched audits the same way.
function bootstrapReasons(cwd: string): string[] {
  const reasons: string[] = [];
  for (const directory of DURABLE_DOC_DIRS) {
    const full = path.join(cwd, directory);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) reasons.push(`missing-directory:${directory}`);
  }
  return reasons;
}

function findRecord(records: ArtifactRecord[], pathValue: string | undefined): ArtifactRecord | undefined {
  return pathValue ? records.find((record) => record.path === pathValue) : undefined;
}

/**
 * A run declares the artifact paths it executes against in `manifest.focus`
 * — a JSON array of repo-relative artifact paths, the same vocabulary the
 * resolved `state.focus` carries. Anything else (absent, empty, non-array)
 * means the run is unbound: it cannot implicitly match a chain and cannot
 * satisfy the planning gate's focus relation.
 */
function runFocusPaths(focus: unknown): string[] | null {
  if (!Array.isArray(focus) || focus.length === 0) return null;
  return focus.every((entry) => typeof entry === "string") ? focus : null;
}

// A run is a candidate for implicit selection only while `active` —
// finalized runs are read-only history, never the live execution. The
// run's own `graphId` must match the projected graph: a run created for
// another graph is not this graph's execution state. Its declared focus
// must sit inside the focused chain: a run bound to a different chain's
// artifacts never becomes this projection's execution state.
function runMatchesGraph(
  snapshot: RunSnapshot,
  graphId: string,
  members: ReadonlySet<string> | null,
): boolean {
  if (snapshot.status !== "active" || snapshot.manifest.graphId !== graphId) return false;
  const focus = runFocusPaths(snapshot.manifest.focus);
  return focus !== null && members !== null && focus.every((entry) => members.has(entry));
}

/**
 * Resolve the run whose plan/tasks back the Dynamic Task Graph. Explicit
 * `--run` wins outright (its store errors propagate — a named run that
 * cannot load is a hard failure, not an empty graph). Implicit selection
 * requires exactly one active run bound to this graph; zero candidates
 * return null (planning has not materialized a run yet — normal), while
 * several or unreadable candidates fail closed as ambiguous so records
 * from different runs can never be mixed.
 */
function resolveRunSnapshot(
  cwd: string,
  graphId: string,
  chain: ArtifactChain | undefined,
  options: Pick<ProjectGraphStateOptions, "runId" | "stateRoot" | "allowExternalRoot">,
): { snapshot: RunSnapshot | null; blocker: string | null } {
  const store = { stateRoot: options.stateRoot, allowExternalRoot: options.allowExternalRoot };
  if (options.runId !== undefined) {
    return { snapshot: loadRun(cwd, options.runId, store), blocker: null };
  }
  const members = chain === undefined ? null : chainMembers(chain);
  const listed = listRuns(cwd, store);
  // A `corrupt` listing cannot prove which graph it belongs to, so it can
  // never be silently skipped — it is an unknown candidate. Alone it makes
  // the selection unreadable; alongside matching runs it makes it ambiguous.
  const corrupt = listed.filter((run) => run.status === "corrupt");
  const matched: RunSnapshot[] = [];
  try {
    for (const run of listed) {
      if (run.status !== "active") continue;
      const snapshot = loadRun(cwd, run.runId, store);
      if (runMatchesGraph(snapshot, graphId, members)) matched.push(snapshot);
    }
  } catch {
    return { snapshot: null, blocker: "task-graph-run-unreadable" };
  }
  if (corrupt.length > 0) {
    return { snapshot: null, blocker: matched.length === 0 ? "task-graph-run-unreadable" : "task-graph-run-ambiguous" };
  }
  if (matched.length === 1) return { snapshot: matched[0], blocker: null };
  if (matched.length > 1) return { snapshot: null, blocker: "task-graph-run-ambiguous" };
  return { snapshot: null, blocker: null };
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
export function evaluateGraphGates(state: GraphState, collector?: ArtifactScanCollector): GraphGateResults {
  const cwd = path.resolve(state.cwd);
  const projection = scanArtifactGraph({ cwd, taskDir: state.taskDir }, collector);
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

    const briefingReasons: string[] = [];
    if (!spec || !["proposed", "approved", "implemented"].includes(spec.status ?? "")) briefingReasons.push("spec-status");
    if (!spec || !sectionBody(spec.body, "Acceptance Criteria")) briefingReasons.push("acceptance-criteria");
    if (!adr || !["proposed", "accepted"].includes(adr.status ?? "")) briefingReasons.push("adr-status");
    if (!adr || consideredOptionCount(adr.body) < 2) briefingReasons.push("considered-options");
    gates.briefing = gate(briefingReasons.length === 0 ? "pass" : "fail", briefingReasons);

    const designReasons: string[] = [];
    if (!design || design.status !== "approved") designReasons.push("design-status");
    // Knowledge Relations v1 (Issue #235): design realizes spec; the ADR
    // decides for the design — the stored direction for the ADR leg is
    // adr → design. The gate accepts the v1 `decides-for` edge and the
    // pre-v3 `derives-from` spelling still stored on migration-owned
    // corpora; `implements` is claim-only — it keeps the ADR inside the
    // chain for diagnosis but never satisfies this gate.
    if (!design || !designClaimsSpec(state.artifactGraph, design.path, spec?.path)) designReasons.push("design-spec-relation");
    if (!design || !designAdrDecision(state.artifactGraph, design.path, adr?.path)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    const planningReasons: string[] = [];
    // Issue #237: the plan is the selected run's plan.md — `plan-status`
    // holds only when it exists AND its approval binds the current digest
    // (unapproved/stale plans surface as `task-graph:plan-not-approved`
    // through the issue reasons below). `plan-design-relation` holds when
    // the run declared a focus that sits inside this chain — the run's
    // manifest binding replaces the durable plan's derives-from edge.
    if (state.taskGraph?.plan?.approved !== true) planningReasons.push("plan-status");
    const members = chain === undefined ? null : chainMembers(chain);
    const runFocus = state.run?.focus ?? null;
    if (runFocus === null || members === null || !runFocus.every((entry) => members.has(entry))) {
      planningReasons.push("plan-design-relation");
    }
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
export function projectGraphState(options: ProjectGraphStateOptions, collector?: ArtifactScanCollector): GraphState {
  const cwd = path.resolve(options.cwd);
  // Normalize + validate once so `state.taskDir` carries the canonical
  // checkout-relative form the scan already enforced (Issue #142).
  const taskDir = resolveContainedTaskDir(cwd, options.taskDir);
  const projection = scanArtifactGraph({ cwd, taskDir }, collector);
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
  // The Dynamic Task Graph is a projection of the selected Execution Store
  // run — never the durable plan/task Markdown (Issue #237).
  const { snapshot: run, blocker: runBlocker } = resolveRunSnapshot(
    cwd,
    options.graphId ?? "doc-driven-dev",
    chain,
    options,
  );
  const taskGraph = run ? projectRunTasks(run) : null;
  if (taskGraph?.issues.length) blockers.push("task-graph-invalid");
  if (runBlocker !== null) blockers.push(runBlocker);
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
    run: run === null ? null : {
      runId: run.runId,
      status: run.status,
      focus: runFocusPaths(run.manifest.focus),
    },
  };
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.gates = evaluateGraphGates(state, collector);
  if (state.gates.planning?.reasons.some((reason) => reason.startsWith("task-graph:"))) {
    state.blockers = sortedUnique([...state.blockers, "task-graph-invalid"]);
    state.gates = evaluateGraphGates(state, collector);
  }
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.hardBlockers = deriveHardBlockers(state.blockers, state.signals, state.gates);
  return state;
}

export { projectArtifactGraph, sectionBody };
