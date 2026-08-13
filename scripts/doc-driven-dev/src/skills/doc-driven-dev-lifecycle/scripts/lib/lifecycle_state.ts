import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { buildTaskGraph, normalizeRepoPath, type TaskGraphResult } from "./task_graph";

/** Runtime evidence that is supplied by lifecycle callers, rather than read from documents. */
export type LifecycleSignal =
  | "implementation-verified"
  | "followups-classified"
  | "exit-audit-pass"
  | "spec-gap"
  | "design-gap"
  | "constraint-gap"
  | "task-graph-retry"
  | "tasks-runnable"
  | "implementation-incomplete"
  | "followups-unclassified"
  | "exit-audit-required";

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

const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

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

function isInside(cwd: string, candidate: string): boolean {
  const root = path.resolve(cwd);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function normalizeLocalTarget(
  cwd: string,
  owner: string,
  target: string,
): { value: string; exists: boolean; external: boolean } {
  const trimmed = target.trim();
  if (EXTERNAL_REFERENCE.test(trimmed)) return { value: trimmed, exists: true, external: true };

  const ownerDir = path.dirname(owner);
  const rootCandidate = path.resolve(cwd, trimmed);
  const documentCandidate = path.resolve(ownerDir, trimmed);
  const documentRelative = trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed === "." || trimmed === "..";
  const preferred = documentRelative ? documentCandidate : rootCandidate;
  const fallback = documentRelative ? rootCandidate : documentCandidate;
  const chosen = isInside(cwd, preferred) && fs.existsSync(preferred) ? preferred : fallback;
  const exists = isInside(cwd, chosen) && fs.existsSync(chosen) && fs.statSync(chosen).isFile();
  const value = isInside(cwd, chosen)
    ? normalizeRepoPath(cwd, chosen)
    : normalizeRepoPath(cwd, preferred);
  return { value, exists, external: false };
}

function parseRelations(
  cwd: string,
  absolutePath: string,
  raw: unknown,
): { relations: Record<string, string[]>; issues: string[] } {
  const relations: Record<string, string[]> = {};
  const issues: string[] = [];
  if (raw === undefined || raw === null) return { relations, issues };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { relations, issues: [`invalid-relations:${normalizeRepoPath(cwd, absolutePath)}`] };
  }
  for (const key of Object.keys(raw as Record<string, unknown>).sort(compareStrings)) {
    const value = (raw as Record<string, unknown>)[key];
    // `changes` is a structured audit-history object in the shared document
    // schema, not a graph relation and must not be traversed here.
    if (key === "changes" && value && typeof value === "object" && !Array.isArray(value)) continue;
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    if (typeof value !== "string" && !Array.isArray(value)) {
      issues.push(`invalid-relation:${normalizeRepoPath(cwd, absolutePath)}:${key}`);
      relations[key] = [];
      continue;
    }
    const normalized: string[] = [];
    for (const item of values) {
      if (typeof item !== "string" || !item.trim()) {
        issues.push(`invalid-relation:${normalizeRepoPath(cwd, absolutePath)}:${key}`);
        continue;
      }
      normalized.push(normalizeLocalTarget(cwd, absolutePath, item).value);
    }
    relations[key] = sortedUnique(normalized);
  }
  return { relations, issues };
}

function readArtifacts(cwd: string): DocumentArtifact[] {
  const result: DocumentArtifact[] = [];
  for (const directory of CANONICAL_TARGETS) {
    for (const absolutePath of markdownFiles(path.join(cwd, directory))) {
      try {
        const source = fs.readFileSync(absolutePath, "utf8");
        const parsed = matter(source);
        const data = parsed.data as Record<string, unknown>;
        if (typeof data.id !== "string" || typeof data.type !== "string" || typeof data.status !== "string") continue;
        const relationResult = parseRelations(cwd, absolutePath, data.relations);
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
  }
  return result.sort((left, right) => compareStrings(left.path, right.path));
}

function artifactTarget(cwd: string, artifact: DocumentArtifact, value: string): DocumentArtifact | undefined {
  if (EXTERNAL_REFERENCE.test(value)) return undefined;
  const normalized = normalizeLocalTarget(cwd, artifact.absolutePath, value).value;
  return undefined;
}

function relationTarget(
  cwd: string,
  source: DocumentArtifact,
  value: string,
  artifacts: DocumentArtifact[],
): DocumentArtifact | undefined {
  if (EXTERNAL_REFERENCE.test(value)) return undefined;
  const byId = artifacts.find((artifact) => artifact.id === value);
  if (byId) return byId;
  const normalized = normalizeLocalTarget(cwd, source.absolutePath, value).value;
  return artifacts.find((artifact) => artifact.path === normalized);
}

function componentForFocus(cwd: string, focus: DocumentArtifact, artifacts: DocumentArtifact[]): DocumentArtifact[] {
  const visited = new Set<string>([focus.path]);
  const queue: DocumentArtifact[] = [focus];
  while (queue.length > 0) {
    const current = queue.shift() as DocumentArtifact;
    for (const artifact of artifacts) {
      const pointsToCurrent = Object.values(artifact.relations).some((values) =>
        values.some((value) => relationTarget(cwd, artifact, value, artifacts)?.path === current.path));
      const currentPointsTo = Object.values(current.relations).some((values) =>
        values.some((value) => relationTarget(cwd, current, value, artifacts)?.path === artifact.path));
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
  const normalized = focusValues.map((value) => {
    const byId = artifacts.find((artifact) => artifact.id === value);
    if (byId) return byId.path;
    return normalizeRepoPath(cwd, value);
  });
  const unique = sortedUnique(normalized);
  if (unique.length !== 1) return { focus: unique, focused: undefined, blockers: ["focus-ambiguous"] };
  const focused = artifacts.find((artifact) => artifact.path === unique[0]);
  if (!focused) return { focus: unique, focused: undefined, blockers: ["focus-invalid"] };
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

function focusedArtifacts(context: StateContext): {
  spec?: DocumentArtifact;
  adr?: DocumentArtifact;
  design?: DocumentArtifact;
  plan?: DocumentArtifact;
} {
  const { focused, component, cwd } = context;
  if (!focused) return {};
  const byType = (type: string): DocumentArtifact[] => component.filter((artifact) => artifact.type === type);
  const design = focused.type === "design"
    ? focused
    : byType("design").find((candidate) => {
        if (focused.type === "spec" || focused.type === "adr") {
          return relationHasTarget(cwd, candidate, ["derives-from", "implements", "spec", "adr", "decision", "relates-to"], focused, component);
        }
        return false;
      });
  const plan = focused.type === "plan"
    ? focused
    : byType("plan").find((candidate) => {
        if (design && relationHasTarget(cwd, candidate, ["derives-from", "design", "relates-to"], design, component)) return true;
        return relationHasTarget(cwd, focused, ["implements", "derives-from", "relates-to"], candidate, component);
      });
  const resolvedDesign = design ?? byType("design").find((candidate) =>
    plan ? relationHasTarget(cwd, plan, ["derives-from", "design", "relates-to"], candidate, component) : false);
  const spec = focused.type === "spec"
    ? focused
    : byType("spec").find((candidate) => resolvedDesign ? relationHasTarget(cwd, resolvedDesign, ["derives-from", "implements", "spec", "relates-to"], candidate, component) : false);
  const adr = focused.type === "adr"
    ? focused
    : byType("adr").find((candidate) => resolvedDesign ? relationHasTarget(cwd, resolvedDesign, ["derives-from", "adr", "decision", "relates-to"], candidate, component) : false);
  return { spec, adr, design: resolvedDesign, plan };
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

/** Evaluate all lifecycle gates from the source documents represented by state. */
export function evaluateLifecycleGates(state: LifecycleState): GateResults {
  const cwd = path.resolve(state.cwd);
  const scanned = readArtifacts(cwd);
  const artifacts = scanned.length > 0 ? scanned : state.artifacts.map((artifact) => ({
    ...artifact,
    body: "",
    absolutePath: path.join(cwd, artifact.path),
    relationIssues: [],
  }));
  const focused = state.focus.length === 1 ? artifacts.find((artifact) => artifact.path === state.focus[0]) : undefined;
  const context: StateContext = {
    cwd,
    artifacts,
    focused,
    component: focused ? componentForFocus(cwd, focused, artifacts) : [],
    taskDir: "docs/tasks",
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
    if (!design || !relationHasTarget(cwd, design, ["derives-from", "implements", "spec", "relates-to"], spec, context.component)) designReasons.push("design-spec-relation");
    if (!design || !relationHasTarget(cwd, design, ["derives-from", "adr", "decision", "relates-to"], adr, context.component)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    const planningReasons: string[] = [];
    if (!plan || !["approved", "in-progress", "completed"].includes(plan.status)) planningReasons.push("plan-status");
    if (!plan || !relationHasTarget(cwd, plan, ["derives-from", "design", "relates-to"], design, context.component)) planningReasons.push("plan-design-relation");
    if (!graph || graph.nodes.length === 0) planningReasons.push("no-selected-tasks");
    if (graph && graph.issues.length > 0) planningReasons.push(...graph.issues.map((issue) => `task-graph:${issue.code}`));
    gates.planning = gate(planningReasons.length === 0 ? "pass" : "fail", planningReasons);

    const implementationReasons: string[] = [];
    if (!graph || graph.nodes.length === 0) implementationReasons.push("no-selected-tasks");
    if (graph && graph.nodes.some((node) => node.status !== "done")) implementationReasons.push("tasks-incomplete");
    if (!state.signals.includes("implementation-verified")) implementationReasons.push("implementation-verified");
    gates.implementation = gate(implementationReasons.length === 0 ? "pass" : "blocked", implementationReasons);
  }
  gates["followup-triage"] = state.signals.includes("followups-classified")
    ? gate("pass")
    : gate("blocked", ["followups-classified"]);
  gates["exit-audit"] = state.signals.includes("exit-audit-pass")
    ? gate("pass")
    : gate("blocked", ["exit-audit-pass"]);
  return gates;
}

/** Project canonical documents, explicit focus, and runtime signals into shared lifecycle state. */
export function probeLifecycleState(options: ProbeLifecycleStateOptions): LifecycleState {
  const cwd = path.resolve(options.cwd);
  const scanned = readArtifacts(cwd);
  const resolution = resolveFocus(cwd, options.focus ?? [], scanned);
  const focused = resolution.focused;
  const component = focused ? componentForFocus(cwd, focused, scanned) : [];
  const relationBlockers = component.flatMap((artifact) => {
    const issues = [...artifact.relationIssues];
    for (const [key, values] of Object.entries(artifact.relations)) {
      for (const value of values) {
        if (EXTERNAL_REFERENCE.test(value)) continue;
        const target = relationTarget(cwd, artifact, value, scanned);
        const normalized = normalizeLocalTarget(cwd, artifact.absolutePath, value);
        if (!target && !normalized.exists) issues.push(`broken-relation:${artifact.path}:${key}:${value}`);
      }
    }
    return issues;
  });
  const bootstrap = bootstrapReasons(cwd);
  const stateWithoutGates: LifecycleState = {
    schemaVersion: 1,
    cwd,
    focus: resolution.focus,
    artifacts: scanned.map(({ body: _body, absolutePath: _absolutePath, relationIssues: _relationIssues, ...artifact }) => artifact),
    gates: {},
    signals: sortedUnique(options.signals ?? []) as LifecycleSignal[],
    blockers: sortedUnique([...resolution.blockers, ...relationBlockers, ...(bootstrap.length > 0 ? ["bootstrap-incomplete"] : [])]),
  };
  stateWithoutGates.gates = evaluateLifecycleGates({ ...stateWithoutGates, blockers: stateWithoutGates.blockers });
  return stateWithoutGates;
}
