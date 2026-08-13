import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import {
  isExternalReference,
  LIFECYCLE_LINEAGE_RELATIONS,
  normalizeLifecycleLocalTarget,
  parseLifecycleRelations,
  resolveLifecycleRelationTarget,
} from "./lifecycle_relations";
import { buildTaskGraph, normalizeRepoPath, type TaskGraphResult } from "./task_graph";

/** Runtime evidence that is supplied by lifecycle callers, rather than read from documents. */
export type LifecycleSignal =
  | "focus-required"
  | "migration-requested"
  | "migration-incomplete"
  | "migration-complete"
  | "bootstrap-incomplete"
  | "bootstrap-complete"
  | "briefing-incomplete"
  | "briefing-complete"
  | "implementation-verified"
  | "design-incomplete"
  | "design-complete"
  | "design-gap"
  | "planning-incomplete"
  | "planning-complete"
  | "task-graph-invalid"
  | "followup-bug-fix"
  | "followup-decision-briefing"
  | "followup-decision-design"
  | "followup-new-feature"
  | "followup-doc-only"
  | "followup-terminal"
  | "exit-audit-pass"
  | "spec-gap"
  | "constraint-gap"
  | "task-graph-retry"
  | "tasks-runnable"
  | "implementation-incomplete"
  | "followups-unclassified"
  | "exit-audit-required"
  | "lifecycle-complete";

export type GateResult = {
  status: "pass" | "fail" | "blocked";
  reasons: string[];
};

export type GateResults = Record<string, GateResult>;

export type LifecycleState = {
  schemaVersion: 1;
  cwd: string;
  focus: string[];
  artifacts: Array<{
    id: string;
    path: string;
    type: string;
    status: string;
    relations: Record<string, string[]>;
  }>;
  gates: GateResults;
  signals: LifecycleSignal[];
  blockers: string[];
};

export type ProbeLifecycleStateOptions = {
  cwd: string;
  focus?: string[];
  signals?: LifecycleSignal[];
  taskDir?: string;
};

type DocumentArtifact = LifecycleState["artifacts"][number] & {
  body: string;
  absolutePath: string;
  relationIssues: string[];
};

type StateContext = {
  cwd: string;
  focusPaths: string[];
  artifacts: DocumentArtifact[];
  focused: DocumentArtifact | undefined;
  component: DocumentArtifact[];
  taskDir: string;
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !/^(?:readme|index)\.md$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };
  visit(dir);
  return files.sort(compareStrings);
}

function readArtifacts(cwd: string, taskDir = "docs/tasks"): DocumentArtifact[] {
  const result: DocumentArtifact[] = [];
  const directories = sortedUnique([...CANONICAL_TARGETS, normalizeRepoPath(cwd, taskDir)]);
  const artifactPaths = sortedUnique(directories.flatMap((directory) => markdownFiles(path.join(cwd, directory))));
  for (const absolutePath of artifactPaths) {
      try {
        const source = fs.readFileSync(absolutePath, "utf8");
        const parsed = matter(source);
        const data = parsed.data as Record<string, unknown>;
        if (typeof data.id !== "string" || typeof data.type !== "string" || typeof data.status !== "string") continue;
        const relationResult = parseLifecycleRelations(cwd, absolutePath, data.relations);
        result.push({
          id: data.id.trim(),
          path: normalizeRepoPath(cwd, absolutePath),
          type: data.type.trim(),
          status: data.status.trim(),
          relations: relationResult.relations,
          body: parsed.content,
          absolutePath,
          relationIssues: relationResult.issues,
        });
      } catch {
        // Invalid markdown is not an artifact. A focused path to it is rejected below.
      }
  }
  return result.sort((left, right) => compareStrings(left.path, right.path));
}

function relationTarget(
  cwd: string,
  source: DocumentArtifact,
  value: string,
  artifacts: DocumentArtifact[],
): DocumentArtifact | undefined {
  return resolveLifecycleRelationTarget(cwd, source, value, artifacts);
}

function lineageValues(artifact: DocumentArtifact): string[] {
  return [...LIFECYCLE_LINEAGE_RELATIONS].flatMap((relation) => artifact.relations[relation] ?? []);
}

function componentForFocus(cwd: string, focus: DocumentArtifact, artifacts: DocumentArtifact[]): DocumentArtifact[] {
  const visited = new Set<string>([focus.path]);
  const queue: DocumentArtifact[] = [focus];
  while (queue.length > 0) {
    const current = queue.shift() as DocumentArtifact;
    for (const artifact of artifacts) {
      const pointsToCurrent = lineageValues(artifact).some((value) =>
        relationTarget(cwd, artifact, value, artifacts)?.path === current.path);
      const currentPointsTo = lineageValues(current).some((value) =>
        relationTarget(cwd, current, value, artifacts)?.path === artifact.path);
      if ((pointsToCurrent || currentPointsTo) && !visited.has(artifact.path)) {
        visited.add(artifact.path);
        queue.push(artifact);
      }
    }
  }
  return artifacts.filter((artifact) => visited.has(artifact.path));
}

function resolveFocus(cwd: string, focusValues: string[], artifacts: DocumentArtifact[]): {
  focus: string[];
  focused: DocumentArtifact | undefined;
  blockers: string[];
} {
  if (focusValues.length === 0) {
    const active = artifacts.filter((artifact) => ACTIVE_STATUSES.has(artifact.status));
    return { focus: [], focused: undefined, blockers: active.length > 0 ? ["focus-required"] : [] };
  }
  let duplicateFocusId = false;
  const normalized = focusValues.map((value) => {
    const byId = artifacts.filter((artifact) => artifact.id === value);
    if (byId.length > 1) {
      duplicateFocusId = true;
      return value;
    }
    if (byId.length === 1) return byId[0].path;
    return normalizeRepoPath(cwd, value);
  });
  const unique = sortedUnique(normalized);
  if (duplicateFocusId) return { focus: unique, focused: undefined, blockers: ["focus-required"] };
  const focusedArtifacts = unique.map((focusPath) => artifacts.find((artifact) => artifact.path === focusPath));
  if (focusedArtifacts.some((artifact) => !artifact)) return { focus: unique, focused: undefined, blockers: ["focus-invalid"] };
  if (focusIsAmbiguous(cwd, unique, artifacts)) return { focus: unique, focused: undefined, blockers: ["focus-required"] };
  if (unique.length > 1 && !selectedArtifactChain(cwd, unique, artifacts)) {
    return { focus: unique, focused: undefined, blockers: ["focus-required"] };
  }
  const focused = focusAnchor(cwd, unique, artifacts);
  return { focus: unique, focused, blockers: [] };
}

function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line.trimEnd()));
  if (start < 0) return "";
  const end = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const section = end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + end);
  return section.join("\n").trim();
}

function consideredOptionCount(body: string): number {
  const section = sectionBody(body, "Considered Options");
  if (!section) return 0;
  const headings = section.match(/^###\s+.+$/gim)?.length ?? 0;
  const listItems = section.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  return Math.max(headings, listItems);
}

function relationHasTarget(
  cwd: string,
  source: DocumentArtifact,
  relationNames: string[],
  target: DocumentArtifact | undefined,
  artifacts: DocumentArtifact[],
): boolean {
  if (!target) return false;
  return relationNames.some((name) => (source.relations[name] ?? []).some((value) =>
    relationTarget(cwd, source, value, artifacts)?.path === target.path));
}

function relationTargets(
  cwd: string,
  source: DocumentArtifact,
  relationNames: string[],
  artifacts: DocumentArtifact[],
): DocumentArtifact[] {
  const targets = new Map<string, DocumentArtifact>();
  for (const name of relationNames) {
    for (const value of source.relations[name] ?? []) {
      const target = relationTarget(cwd, source, value, artifacts);
      if (target) targets.set(target.path, target);
    }
  }
  return [...targets.values()].sort((left, right) => compareStrings(left.path, right.path));
}

const CHAIN_STATUSES: Record<string, Set<string>> = {
  spec: new Set(["proposed", "approved", "implemented"]),
  adr: new Set(["proposed", "accepted"]),
  design: new Set(["approved"]),
  plan: new Set(["approved", "in-progress", "completed"]),
};

function isValidChainArtifact(artifact: DocumentArtifact): boolean {
  return CHAIN_STATUSES[artifact.type]?.has(artifact.status) ?? false;
}

type ArtifactChain = {
  spec?: DocumentArtifact;
  adr?: DocumentArtifact;
  design?: DocumentArtifact;
  plan?: DocumentArtifact;
  tasks: DocumentArtifact[];
};

function chainKey(chain: ArtifactChain): string {
  return [chain.spec, chain.adr, chain.design, chain.plan].map((artifact) => artifact?.path ?? "").join("\u0000");
}

function chainMembers(chain: ArtifactChain): Set<string> {
  return new Set([
    chain.spec?.path,
    chain.adr?.path,
    chain.design?.path,
    chain.plan?.path,
    ...chain.tasks.map((task) => task.path),
  ].filter((value): value is string => Boolean(value)));
}

/**
 * Build lifecycle chains from typed front-matter relations in stable path order.
 * A plan focus narrows a shared design/spec component to that plan; a spec or
 * ADR focus must disambiguate every valid downstream design/plan chain.
 */
function enumerateArtifactChains(cwd: string, artifacts: DocumentArtifact[]): ArtifactChain[] {
  const specs = artifacts.filter((artifact) => artifact.type === "spec" && isValidChainArtifact(artifact));
  const adrs = artifacts.filter((artifact) => artifact.type === "adr" && isValidChainArtifact(artifact));
  const designs = artifacts.filter((artifact) => artifact.type === "design" && isValidChainArtifact(artifact));
  const plans = artifacts.filter((artifact) => artifact.type === "plan" && isValidChainArtifact(artifact));
  const tasks = artifacts.filter((artifact) => artifact.type === "task");
  const chains = new Map<string, ArtifactChain>();
  const add = (chain: ArtifactChain): void => chains.set(chainKey(chain), chain);
  const cartesian = <T>(values: T[], fallback: Array<T | undefined>): Array<T | undefined> => values.length > 0 ? values : fallback;

  for (const design of designs) {
    const relatedSpecs = relationTargets(cwd, design, ["derives-from", "implements", "spec"], specs);
    const relatedAdrs = relationTargets(cwd, design, ["derives-from", "adr", "decision"], adrs);
    const relatedPlans = plans.filter((plan) => relationHasTarget(cwd, plan, ["derives-from", "design"], design, artifacts));
    const relatedTasks = tasks.filter((task) => relatedPlans.some((plan) => relationHasTarget(cwd, task, ["implements"], plan, artifacts)));
    for (const spec of cartesian(relatedSpecs, [undefined])) {
      for (const adr of cartesian(relatedAdrs, [undefined])) {
        for (const plan of cartesian(relatedPlans, [undefined])) {
          add({ spec, adr, design, plan, tasks: plan ? relatedTasks.filter((task) => relationHasTarget(cwd, task, ["implements"], plan, artifacts)) : [] });
        }
      }
    }
  }
  for (const plan of plans) {
    if (designs.some((design) => relationHasTarget(cwd, plan, ["derives-from", "design"], design, artifacts))) continue;
    const relatedTasks = tasks.filter((task) => relationHasTarget(cwd, task, ["implements"], plan, artifacts));
    add({ plan, tasks: relatedTasks });
  }
  for (const artifact of [...specs, ...adrs]) {
    if (!designs.some((design) => relationHasTarget(cwd, design, ["derives-from", "implements", "spec", "adr", "decision"], artifact, artifacts))) {
      add(artifact.type === "spec" ? { spec: artifact, tasks: [] } : { adr: artifact, tasks: [] });
    }
  }
  return [...chains.values()].sort((left, right) => compareStrings(chainKey(left), chainKey(right)));
}

function selectedArtifactChain(
  cwd: string,
  focusPaths: string[],
  artifacts: DocumentArtifact[],
): ArtifactChain | undefined {
  const candidates = enumerateArtifactChains(cwd, artifacts)
    .filter((chain) => {
      const members = chainMembers(chain);
      return focusPaths.every((focusPath) => members.has(focusPath));
    });
  const unique = [...new Map(candidates.map((candidate) => [chainKey(candidate), candidate])).values()];
  return unique.length === 1 ? unique[0] : undefined;
}

function focusAnchor(
  cwd: string,
  focusPaths: string[],
  artifacts: DocumentArtifact[],
): DocumentArtifact | undefined {
  const selected = selectedArtifactChain(cwd, focusPaths, artifacts);
  const focusArtifacts = focusPaths
    .map((focusPath) => artifacts.find((artifact) => artifact.path === focusPath))
    .filter((artifact): artifact is DocumentArtifact => Boolean(artifact));
  if (!selected && focusPaths.length > 1) return undefined;
  const rank: Record<string, number> = { plan: 0, design: 1, spec: 2, adr: 3, task: 4 };
  return [...focusArtifacts]
    .sort((left, right) => (rank[left.type] ?? 9) - (rank[right.type] ?? 9) || compareStrings(left.path, right.path))[0];
}

function focusIsAmbiguous(cwd: string, focusPaths: string[], artifacts: DocumentArtifact[]): boolean {
  if (focusPaths.length === 0) return false;
  const relevant = focusPaths.some((focusPath) => artifacts.find((artifact) => artifact.path === focusPath)?.type &&
    ["spec", "adr", "design", "plan", "task"].includes(artifacts.find((artifact) => artifact.path === focusPath)?.type ?? ""));
  if (!relevant) return false;
  const candidates = enumerateArtifactChains(cwd, artifacts).filter((chain) => {
    const members = chainMembers(chain);
    return focusPaths.every((focusPath) => members.has(focusPath));
  });
  return candidates.length > 1;
}

function focusedArtifacts(context: StateContext): {
  spec?: DocumentArtifact;
  adr?: DocumentArtifact;
  design?: DocumentArtifact;
  plan?: DocumentArtifact;
} {
  const { focused, component, cwd } = context;
  if (!focused) return {};
  const selected = selectedArtifactChain(cwd, context.focusPaths, context.artifacts);
  if (selected) return selected;
  // If a focused artifact is not a valid chain member, retain only that
  // explicit artifact. Never infer a neighboring chain with an arbitrary
  // `.find()`; ambiguous valid chains were rejected during focus resolution.
  if (focused.type === "spec") return { spec: focused };
  if (focused.type === "adr") return { adr: focused };
  if (focused.type === "design") return { design: focused };
  if (focused.type === "plan") return { plan: focused };
  return {};
}

function gate(status: GateResult["status"], reasons: string[] = []): GateResult {
  return { status, reasons: sortedUnique(reasons) };
}

function bootstrapReasons(cwd: string): string[] {
  const reasons: string[] = [];
  for (const directory of CANONICAL_TARGETS) {
    const fullDir = path.join(cwd, directory);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) reasons.push(`missing-directory:${directory}`);
    if (!fs.existsSync(path.join(fullDir, "README.md"))) reasons.push(`missing-index:${directory}/README.md`);
  }
  return reasons;
}

function taskGraphFor(context: StateContext, plan: DocumentArtifact | undefined): TaskGraphResult | undefined {
  if (!plan) return undefined;
  return buildTaskGraph({ cwd: context.cwd, plan: plan.path, taskDir: context.taskDir });
}

function isLifecycleResolvedTaskStatus(status: TaskGraphResult["nodes"][number]["status"]): boolean {
  return status === "done" || status === "wont-do";
}

/** Evaluate all lifecycle gates from the source documents represented by state. */
export function evaluateLifecycleGates(state: LifecycleState, taskDir = "docs/tasks"): GateResults {
  const cwd = path.resolve(state.cwd);
  const scanned = readArtifacts(cwd, taskDir);
  const artifacts = scanned.length > 0 ? scanned : state.artifacts.map((artifact) => ({
    ...artifact,
    body: "",
    absolutePath: path.join(cwd, artifact.path),
    relationIssues: [],
  }));
  const focused = focusAnchor(cwd, state.focus, artifacts);
  const context: StateContext = {
    cwd,
    focusPaths: state.focus,
    artifacts,
    focused,
    component: focused ? componentForFocus(cwd, focused, artifacts) : [],
    taskDir,
  };
  const { spec, adr, design, plan } = focusedArtifacts(context);
  const graph = taskGraphFor(context, plan);

  const bootstrap = bootstrapReasons(cwd);
  const gates: GateResults = {
    bootstrap: gate(bootstrap.length === 0 ? "pass" : "fail", bootstrap),
  };
  if (!focused) {
    gates.briefing = state.blockers.includes("focus-required") ? gate("blocked", ["focus-required"]) : gate("fail", ["focus-missing"]);
    gates.design = gate("blocked", ["focus-required"]);
    gates.planning = gate("blocked", ["focus-required"]);
    gates.implementation = gate("blocked", ["focus-required"]);
  } else {
    const briefingReasons: string[] = [];
    if (!spec || !["proposed", "approved", "implemented"].includes(spec.status)) briefingReasons.push("spec-status");
    if (!spec || !sectionBody(spec.body, "Acceptance Criteria")) briefingReasons.push("acceptance-criteria");
    if (!adr || !["proposed", "accepted"].includes(adr.status)) briefingReasons.push("adr-status");
    if (!adr || consideredOptionCount(adr.body) < 2) briefingReasons.push("considered-options");
    gates.briefing = gate(briefingReasons.length === 0 ? "pass" : "fail", briefingReasons);

    const designReasons: string[] = [];
    if (!design || design.status !== "approved") designReasons.push("design-status");
    if (!design || !relationHasTarget(cwd, design, ["derives-from", "implements", "spec"], spec, context.component)) designReasons.push("design-spec-relation");
    if (!design || !relationHasTarget(cwd, design, ["derives-from", "adr", "decision"], adr, context.component)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    const planningReasons: string[] = [];
    if (!plan || !["approved", "in-progress", "completed"].includes(plan.status)) planningReasons.push("plan-status");
    if (!plan || !relationHasTarget(cwd, plan, ["derives-from", "design"], design, context.component)) planningReasons.push("plan-design-relation");
    if (!graph || graph.nodes.length === 0) planningReasons.push("no-selected-tasks");
    if (graph && graph.issues.length > 0) planningReasons.push(...graph.issues.map((issue) => `task-graph:${issue.code}`));
    const hasTaskGraphIssue = Boolean(graph && graph.issues.length > 0);
    gates.planning = gate(
      planningReasons.length === 0 ? "pass" : hasTaskGraphIssue ? "blocked" : "fail",
      planningReasons,
    );

    const implementationReasons: string[] = [];
    if (!graph || graph.nodes.length === 0) implementationReasons.push("no-selected-tasks");
    if (graph && graph.nodes.some((node) => !isLifecycleResolvedTaskStatus(node.status))) implementationReasons.push("tasks-incomplete");
    if (!state.signals.includes("implementation-verified")) implementationReasons.push("implementation-verified");
    gates.implementation = gate(implementationReasons.length === 0 ? "pass" : "blocked", implementationReasons);
  }
  const followupClassifications = state.signals.filter((signal) => [
    "followup-bug-fix",
    "followup-decision-briefing",
    "followup-decision-design",
    "followup-new-feature",
    "followup-doc-only",
    "followup-terminal",
  ].includes(signal as LifecycleSignal));
  if (followupClassifications.length === 1 && !state.signals.includes("followups-unclassified")) {
    gates["followup-triage"] = gate("pass");
  } else if (followupClassifications.length === 0) {
    gates["followup-triage"] = gate("blocked", ["followups-unclassified"]);
  } else {
    gates["followup-triage"] = gate("blocked", ["followups-conflicting"]);
  }
  gates["exit-audit"] = state.signals.includes("exit-audit-pass")
    ? gate("pass")
    : gate("blocked", ["exit-audit-pass"]);
  return gates;
}

/** Project canonical documents, explicit focus, and runtime signals into shared lifecycle state. */
export function probeLifecycleState(options: ProbeLifecycleStateOptions): LifecycleState {
  const cwd = path.resolve(options.cwd);
  const taskDir = options.taskDir ?? "docs/tasks";
  const scanned = readArtifacts(cwd, taskDir);
  const resolution = resolveFocus(cwd, options.focus ?? [], scanned);
  const focused = resolution.focused;
  const component = focused ? componentForFocus(cwd, focused, scanned) : [];
  const relationBlockers = component.flatMap((artifact) => {
    const issues = [...artifact.relationIssues];
    for (const [key, values] of Object.entries(artifact.relations)) {
      for (const value of values) {
        if (isExternalReference(value)) continue;
        const target = relationTarget(cwd, artifact, value, scanned);
        const normalized = normalizeLifecycleLocalTarget(cwd, artifact.absolutePath, value);
        if (!target && !normalized.exists) issues.push(`broken-relation:${artifact.path}:${key}:${value}`);
      }
    }
    return issues;
  });
  const bootstrap = bootstrapReasons(cwd);
  const duplicateIds = [...new Set(scanned
    .map((artifact) => artifact.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index))];
  const stateWithoutGates: LifecycleState = {
    schemaVersion: 1,
    cwd,
    focus: resolution.focus,
    artifacts: scanned.map(({ body: _body, absolutePath: _absolutePath, relationIssues: _relationIssues, ...artifact }) => artifact),
    gates: {},
    signals: sortedUnique(options.signals ?? []) as LifecycleSignal[],
    blockers: sortedUnique([
      ...resolution.blockers,
      ...relationBlockers,
      ...(bootstrap.length > 0 ? ["bootstrap-incomplete"] : []),
      ...(duplicateIds.length > 0 ? ["duplicate-id", "focus-required"] : []),
    ]),
  };
  stateWithoutGates.gates = evaluateLifecycleGates({ ...stateWithoutGates, blockers: stateWithoutGates.blockers }, taskDir);
  if (stateWithoutGates.gates.planning.reasons.some((reason) => reason.startsWith("task-graph:"))) {
    stateWithoutGates.blockers = sortedUnique([...stateWithoutGates.blockers, "task-graph-invalid"]);
    stateWithoutGates.gates = evaluateLifecycleGates({ ...stateWithoutGates, blockers: stateWithoutGates.blockers }, taskDir);
  }
  return stateWithoutGates;
}
