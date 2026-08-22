#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/** Lifecycle statuses accepted by task-doc. */
export type TaskStatus = "todo" | "in-progress" | "blocked" | "done" | "wont-do";

export type BuildTaskGraphOptions = {
  cwd: string;
  plan: string;
  taskDir?: string;
};

export type TaskGraphEdge = {
  from: string;
  to: string;
};

export type TaskGraphIssueCode =
  | "duplicate-task-id"
  | "missing-task-reference"
  | "task-cycle"
  | "plan-has-no-tasks";

export type TaskGraphIssue = {
  code: TaskGraphIssueCode;
  message: string;
  tasks: string[];
};

type InternalIssue = {
  code: string;
  message: string;
  tasks?: string[];
  task?: string;
  reference?: string;
  file?: string;
};

export type TaskNode = {
  id: string;
  status: TaskStatus;
  file: string;
  implements: string[];
  dependsOn: string[];
  blocks: string[];
};

export type TaskGraphNode = {
  id: string;
  path: string;
  status: TaskStatus;
  dependsOn: string[];
  blocks: string[];
};

export type TaskGraphResult = {
  schemaVersion: 1;
  plan: string;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  runnable: string[];
  active: string[];
  completed: string[];
  blocked: Array<{ id: string; reasons: string[] }>;
  issues: TaskGraphIssue[];
};

type ParsedTask = TaskNode & {
  parseIssues: InternalIssue[];
};

type IndexedTasks = {
  tasks: ParsedTask[];
  byId: Map<string, ParsedTask>;
  byPath: Map<string, ParsedTask>;
  issues: InternalIssue[];
};

type ResolvedEdges = {
  edges: TaskGraphEdge[];
  issues: InternalIssue[];
};

const TASK_STATUSES = new Set<TaskStatus>([
  "todo",
  "in-progress",
  "blocked",
  "done",
  "wont-do",
]);

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Normalize a repository-relative path to stable POSIX notation. */
export function normalizeRepoPath(cwd: string, target: string): string {
  const absolute = path.resolve(cwd, target);
  return path.relative(cwd, absolute).split(path.sep).join("/");
}

function normalizeOwnedRepoPath(cwd: string, ownerFile: string, reference: string): string {
  const ownerCandidate = path.resolve(cwd, path.dirname(ownerFile), reference);
  const rootCandidate = path.resolve(cwd, reference);
  const documentRelative = reference.startsWith("./")
    || reference.startsWith("../")
    || reference === "."
    || reference === ".."
    || (!reference.includes("/") && !reference.includes("\\"));
  const chosen = documentRelative ? ownerCandidate : rootCandidate;
  return normalizeRepoPath(cwd, chosen);
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const result: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(full);
    }
  };
  visit(dir);
  return result.sort(compareStrings);
}

function relationValues(raw: unknown, key: string, issues: InternalIssue[], taskId: string, file: string): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({
        code: "invalid-task-document",
        tasks: [taskId || file],
        task: taskId || undefined,
        file,
        message: `Task relations must be an object (${key})`,
      });
    }
    return [];
  }
  const value = (raw as Record<string, unknown>)[key];
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.trim()) result.push(item.trim());
      else if (item !== null && item !== undefined) {
        issues.push({
          code: "invalid-task-document",
          tasks: [taskId || file],
          task: taskId || undefined,
          file,
          message: `Task relation ${key} must contain only strings`,
        });
      }
    }
    return sortedUnique(result);
  }
  issues.push({
    code: "invalid-task-document",
    tasks: [taskId || file],
    task: taskId || undefined,
    file,
    message: `Task relation ${key} must be an array of strings`,
  });
  return [];
}

/** Read task front matter without mutating any source documents. */
export function readTaskDocuments(cwd: string, taskDir: string): ParsedTask[] {
  const root = path.resolve(cwd, taskDir);
  const tasks: ParsedTask[] = [];
  for (const file of markdownFiles(root)) {
    const relativeFile = normalizeRepoPath(cwd, file);
    let data: Record<string, unknown>;
    try {
      data = matter(fs.readFileSync(file, "utf8")).data as Record<string, unknown>;
    } catch (error: unknown) {
      tasks.push({
        id: "",
        status: "todo",
        file: relativeFile,
        implements: [],
        dependsOn: [],
        blocks: [],
        parseIssues: [{
          code: "invalid-task-document",
          tasks: [relativeFile],
          file: relativeFile,
          message: `Unable to parse task front matter: ${error instanceof Error ? error.message : String(error)}`,
        }],
      });
      continue;
    }

    // A task directory can contain indexes or other markdown files. Only task
    // documents participate in the graph.
    if (data.type !== "task") continue;

    const parseIssues: InternalIssue[] = [];
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id) {
      parseIssues.push({
        code: "invalid-task-document",
        tasks: [id || relativeFile],
        file: relativeFile,
        message: "Task front matter requires a non-empty id",
      });
    }
    const statusValue = typeof data.status === "string" ? data.status.trim() : "";
    const status = TASK_STATUSES.has(statusValue as TaskStatus) ? statusValue as TaskStatus : "todo";
    if (!TASK_STATUSES.has(statusValue as TaskStatus)) {
      parseIssues.push({
        code: "invalid-task-status",
        tasks: [id || relativeFile],
        task: id || undefined,
        file: relativeFile,
        message: `Unknown task status: ${statusValue || "<missing>"}`,
      });
    }
    const rawRelations = data.relations;
    const relationObject = rawRelations && typeof rawRelations === "object" && !Array.isArray(rawRelations)
      ? rawRelations
      : {};
    if (rawRelations !== undefined && (typeof rawRelations !== "object" || Array.isArray(rawRelations))) {
      parseIssues.push({
        code: "invalid-task-document",
        tasks: [id || relativeFile],
        task: id || undefined,
        file: relativeFile,
        message: "Task relations must be an object",
      });
    }
    const implementsValues = relationValues(relationObject, "implements", parseIssues, id, relativeFile)
      .map((target) => normalizeOwnedRepoPath(cwd, relativeFile, target));
    const dependsOn = relationValues(relationObject, "depends-on", parseIssues, id, relativeFile);
    const blocks = relationValues(relationObject, "blocks", parseIssues, id, relativeFile);
    tasks.push({
      id,
      status,
      file: relativeFile,
      implements: sortedUnique(implementsValues),
      dependsOn: sortedUnique(dependsOn),
      blocks: sortedUnique(blocks),
      parseIssues,
    });
  }
  return tasks.sort((left, right) => compareStrings(left.id || left.file, right.id || right.file));
}

export function indexTasks(tasks: ParsedTask[]): IndexedTasks {
  const sortedTasks = [...tasks].sort((left, right) => compareStrings(left.id || left.file, right.id || right.file));
  const byId = new Map<string, ParsedTask>();
  const byPath = new Map<string, ParsedTask>();
  const issues: InternalIssue[] = [];
  for (const task of sortedTasks) {
    issues.push(...task.parseIssues);
    if (!task.id) continue;
    const previous = byId.get(task.id);
    if (previous) {
      issues.push({
        code: "duplicate-task-id",
        tasks: [task.id],
        task: task.id,
        file: task.file,
        message: `Duplicate task id ${task.id} (also found in ${previous.file})`,
      });
      continue;
    }
    byId.set(task.id, task);
    byPath.set(task.file, task);
  }
  return { tasks: sortedTasks, byId, byPath, issues };
}

function resolveReference(
  cwd: string,
  owner: ParsedTask,
  reference: string,
  index: IndexedTasks,
): ParsedTask | undefined {
  const byId = index.byId.get(reference);
  if (byId) return byId;
  const normalized = normalizeOwnedRepoPath(cwd, owner.file, reference);
  return index.byPath.get(normalized);
}

function isExistingArtifactReference(
  cwd: string,
  taskDir: string,
  owner: ParsedTask,
  reference: string,
): boolean {
  const candidate = path.resolve(cwd, normalizeOwnedRepoPath(cwd, owner.file, reference));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
  const taskRoot = path.resolve(cwd, taskDir);
  const candidatePath = path.resolve(candidate);
  const insideTaskDir = candidatePath === taskRoot || candidatePath.startsWith(`${taskRoot}${path.sep}`);
  if (insideTaskDir) return false;
  try {
    const type = matter(fs.readFileSync(candidate, "utf8")).data?.type;
    return ["plan", "spec", "adr", "design"].includes(type);
  } catch {
    return false;
  }
}

function readArtifactIds(cwd: string, taskDir: string): Set<string> {
  const taskRoot = path.resolve(cwd, taskDir);
  const ids = new Set<string>();
  for (const file of markdownFiles(cwd)) {
    const absolute = path.resolve(file);
    if (absolute === taskRoot || absolute.startsWith(`${taskRoot}${path.sep}`)) continue;
    try {
      const data = matter(fs.readFileSync(file, "utf8")).data as Record<string, unknown>;
      if (["plan", "spec", "adr", "design"].includes(data.type as string) && typeof data.id === "string" && data.id.trim()) {
        ids.add(data.id.trim());
      }
    } catch {
      // A malformed unrelated document cannot establish an artifact reference.
    }
  }
  return ids;
}

export function resolveTaskEdges(cwd: string, taskDir: string, index: IndexedTasks): ResolvedEdges {
  const edges = new Map<string, TaskGraphEdge>();
  const issues: InternalIssue[] = [];
  const artifactIds = readArtifactIds(cwd, taskDir);
  const addReference = (task: ParsedTask, reference: string, direction: "depends-on" | "blocks"): void => {
    const target = resolveReference(cwd, task, reference, index);
    if (!target || !target.id) {
      // Relations to an existing plan/spec/ADR are upstream artifact links,
      // not task-DAG edges. Keep unresolved task-looking references fail-closed.
      if (artifactIds.has(reference) || isExistingArtifactReference(cwd, taskDir, task, reference)) return;
      issues.push({
        code: "missing-task-reference",
        tasks: task.id ? [task.id] : [],
        task: task.id || undefined,
        reference,
        file: task.file,
        message: `Task ${task.id || task.file} references unresolved task ${reference}`,
      });
      return;
    }
    const edge = direction === "depends-on"
      ? { from: target.id, to: task.id }
      : { from: task.id, to: target.id };
    edges.set(`${edge.from}\u0000${edge.to}`, edge);
  };
  for (const task of index.tasks) {
    if (!task.id || !index.byId.has(task.id)) continue;
    for (const reference of task.dependsOn) addReference(task, reference, "depends-on");
    for (const reference of task.blocks) addReference(task, reference, "blocks");
  }
  return {
    edges: [...edges.values()].sort((left, right) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to)),
    issues: issues.sort(issueCompare),
  };
}

function issueCompare(left: InternalIssue, right: InternalIssue): number {
  return compareStrings(left.code, right.code)
    || compareStrings((left.tasks || []).join(","), (right.tasks || []).join(","))
    || compareStrings(left.task || "", right.task || "")
    || compareStrings(left.reference || "", right.reference || "")
    || compareStrings(left.file || "", right.file || "")
    || compareStrings(left.message, right.message);
}

export function findCycles(tasks: ParsedTask[], edges: TaskGraphEdge[]): TaskGraphIssue[] {
  const ids = sortedUnique(tasks.map((task) => task.id).filter(Boolean));
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
    code: "task-cycle",
    tasks: cycle.split(" -> "),
    message: `Task dependency cycle detected: ${cycle}`,
  }));
}

export function summarizeTaskGraph(
  plan: string,
  tasks: ParsedTask[],
  edges: TaskGraphEdge[],
  issues: InternalIssue[],
): TaskGraphResult {
  const sortedTasks = tasks
    .filter((task) => Boolean(task.id))
    .map(({ parseIssues: _parseIssues, ...task }) => ({
      ...task,
      implements: [...task.implements].sort(compareStrings),
      dependsOn: [...task.dependsOn].sort(compareStrings),
      blocks: [...task.blocks].sort(compareStrings),
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
  const sortedEdges = [...edges].sort((left, right) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to));
  const normalizedIssues = issues.map((issue): TaskGraphIssue => {
    const allowed = new Set<TaskGraphIssueCode>([
      "duplicate-task-id",
      "missing-task-reference",
      "task-cycle",
      "plan-has-no-tasks",
    ]);
    const code = allowed.has(issue.code as TaskGraphIssueCode)
      ? issue.code as TaskGraphIssueCode
      : "missing-task-reference";
    const isMalformed = !allowed.has(issue.code as TaskGraphIssueCode);
    return {
      code,
      message: isMalformed ? `Malformed task document: ${issue.message}` : issue.message,
      tasks: sortedUnique(issue.tasks || (issue.task ? [issue.task] : [])),
    };
  });
  const uniqueIssues = [...new Map(normalizedIssues.map((issue) => [
    `${issue.code}\u0000${issue.tasks.join(",")}\u0000${issue.message}`,
    issue,
  ])).values()].sort(issueCompare);
  const runnable = uniqueIssues.length > 0
    ? []
    : sortedTasks
      .filter((task) => task.status === "todo")
      .filter((task) => sortedEdges.filter((edge) => edge.to === task.id).every((edge) => {
        const predecessor = sortedTasks.find((candidate) => candidate.id === edge.from);
        return predecessor?.status === "done";
      }))
      .map((task) => task.id);
  const active = sortedTasks.filter((task) => task.status === "in-progress").map((task) => task.id);
  const completed = sortedTasks.filter((task) => task.status === "done").map((task) => task.id);
  const blocked = sortedTasks
    .filter((task) => task.status === "blocked" || task.status === "wont-do" || (task.status === "todo" && !runnable.includes(task.id)))
    .map((task) => ({
      id: task.id,
      reasons: task.status === "blocked"
        ? ["status:blocked"]
        : task.status === "wont-do"
          ? ["status:wont-do"]
          : sortedEdges.filter((edge) => edge.to === task.id)
            .filter((edge) => sortedTasks.find((candidate) => candidate.id === edge.from)?.status !== "done")
            .map((edge) => `depends-on:${edge.from}`),
    }))
    .filter((entry) => entry.reasons.length > 0);
  return {
    schemaVersion: 1,
    plan,
    nodes: sortedTasks.map((task) => ({
      id: task.id,
      path: task.file,
      status: task.status,
      dependsOn: task.dependsOn,
      blocks: task.blocks,
    })),
    edges: sortedEdges,
    runnable: runnable.sort(compareStrings),
    active: active.sort(compareStrings),
    completed: completed.sort(compareStrings),
    blocked,
    issues: uniqueIssues,
  };
}

export function buildTaskGraph(options: BuildTaskGraphOptions): TaskGraphResult {
  const cwd = path.resolve(options.cwd);
  const plan = normalizeRepoPath(cwd, options.plan);
  const taskDir = options.taskDir ?? "docs/tasks";
  const parsed = readTaskDocuments(cwd, taskDir)
    .filter((task) => task.implements.includes(plan));
  const indexed = indexTasks(parsed);
  const resolved = resolveTaskEdges(cwd, taskDir, indexed);
  const issues = [...indexed.issues, ...resolved.issues, ...findCycles(parsed, resolved.edges)];
  if (parsed.length === 0) {
    issues.push({
      code: "plan-has-no-tasks",
      tasks: [],
      message: `Plan ${plan} has no task documents`,
    });
  }
  return summarizeTaskGraph(plan, parsed, resolved.edges, issues);
}
