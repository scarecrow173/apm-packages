import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

export type ArtifactEdgeKind = "lineage" | "task-dependency" | "contextual" | "evidence";
export type ArtifactNode = { path: string; id: string | null; type: string | null };
export type ArtifactEdge = {
  from: string;
  to: string | null;
  relation: string;
  kind: ArtifactEdgeKind;
  external: boolean;
};
export type ArtifactGraphIssue = { code: "broken-relation" | "duplicate-id"; message: string };
export type ArtifactGraph = {
  nodes: ArtifactNode[];
  edges: ArtifactEdge[];
  issues: ArtifactGraphIssue[];
};

export type ArtifactRecord = ArtifactNode & {
  absolutePath: string;
  body: string;
  status: string | null;
  relations: Record<string, string[]>;
  relationIssues: string[];
};

export type ArtifactGraphOptions = {
  cwd: string;
  taskDir?: string;
};

export type ArtifactGraphProjection = {
  graph: ArtifactGraph;
  records: ArtifactRecord[];
};

/** Relations that connect documents in a lifecycle chain. */
export const LINEAGE_RELATIONS: ReadonlySet<string> = new Set([
  "implements",
  "implemented-by",
  "derives-from",
  "derived-by",
  "refines",
  "refined-by",
]);

const TASK_DEPENDENCY_RELATIONS: ReadonlySet<string> = new Set(["depends-on", "blocks"]);
const EVIDENCE_RELATIONS: ReadonlySet<string> = new Set([
  "verifies",
  "verified-by",
  "references",
  "evidence",
  "evidence-refs",
  "evidenceRefs",
]);
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
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

export function normalizeArtifactPath(cwd: string, target: string): string {
  return path.relative(path.resolve(cwd), path.resolve(cwd, target)).split(path.sep).join("/");
}

export function isExternalArtifactReference(value: string): boolean {
  return EXTERNAL_REFERENCE.test(value.trim());
}

function isInside(cwd: string, candidate: string): boolean {
  const root = path.resolve(cwd);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (
        entry.isFile()
        && entry.name.toLowerCase().endsWith(".md")
        && !/^(?:readme|index)\.md$/i.test(entry.name)
      ) files.push(full);
    }
  };
  visit(dir);
  return files.sort(compareStrings);
}

function relationValues(raw: unknown, ownerPath: string): { relations: Record<string, string[]>; issues: string[] } {
  if (raw === undefined || raw === null) return { relations: {}, issues: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { relations: {}, issues: [`invalid-relations:${ownerPath}`] };
  }
  const result: Record<string, string[]> = {};
  const issues: string[] = [];
  for (const key of Object.keys(raw as Record<string, unknown>).sort(compareStrings)) {
    const value = (raw as Record<string, unknown>)[key];
    if (key === "changes" && value && typeof value === "object" && !Array.isArray(value)) continue;
    if (typeof value !== "string" && !Array.isArray(value)) {
      issues.push(`invalid-relation:${ownerPath}:${key}`);
      result[key] = [];
      continue;
    }
    const values = typeof value === "string" ? [value] : value;
    const valid: string[] = [];
    for (const item of values) {
      if (typeof item !== "string" || !item.trim()) {
        issues.push(`invalid-relation:${ownerPath}:${key}`);
        continue;
      }
      valid.push(item.trim());
    }
    result[key] = sortedUnique(valid);
  }
  return { relations: result, issues };
}

function readRecords(options: ArtifactGraphOptions): ArtifactRecord[] {
  const cwd = path.resolve(options.cwd);
  const taskDir = options.taskDir ?? "docs/tasks";
  const directories = sortedUnique([...CANONICAL_TARGETS, normalizeArtifactPath(cwd, taskDir)]);
  const files = sortedUnique(directories.flatMap((directory) => markdownFiles(path.join(cwd, directory))));
  const records: ArtifactRecord[] = [];
  for (const absolutePath of files.map((file) => path.resolve(cwd, file))) {
    try {
      const parsed = matter(fs.readFileSync(absolutePath, "utf8"));
      const data = parsed.data as Record<string, unknown>;
      const recordPath = normalizeArtifactPath(cwd, absolutePath);
      const relationResult = relationValues(data.relations, recordPath);
      const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
      const type = typeof data.type === "string" && data.type.trim() ? data.type.trim() : null;
      const status = typeof data.status === "string" && data.status.trim() ? data.status.trim() : null;
      records.push({
        path: recordPath,
        id,
        type,
        status,
        absolutePath,
        body: parsed.content,
        relations: relationResult.relations,
        relationIssues: relationResult.issues,
      });
    } catch {
      records.push({
        path: normalizeArtifactPath(cwd, absolutePath),
        id: null,
        type: null,
        status: null,
        absolutePath,
        body: "",
        relations: {},
        relationIssues: [`invalid-document:${normalizeArtifactPath(cwd, absolutePath)}`],
      });
    }
  }
  return records.sort((left, right) => compareStrings(left.path, right.path));
}

export function classifyArtifactRelation(relation: string): ArtifactEdgeKind {
  if (LINEAGE_RELATIONS.has(relation)) return "lineage";
  if (TASK_DEPENDENCY_RELATIONS.has(relation)) return "task-dependency";
  if (EVIDENCE_RELATIONS.has(relation) || /evidence/i.test(relation)) return "evidence";
  return "contextual";
}

function localTarget(cwd: string, owner: ArtifactRecord, value: string): { path: string; exists: boolean } {
  const trimmed = value.trim();
  const ownerCandidate = path.resolve(path.dirname(owner.absolutePath), trimmed);
  const rootCandidate = path.resolve(cwd, trimmed);
  const documentRelative = trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed === "." || trimmed === "..";
  const preferred = documentRelative ? ownerCandidate : rootCandidate;
  const fallback = documentRelative ? rootCandidate : ownerCandidate;
  const chosen = isInside(cwd, preferred) && fs.existsSync(preferred) ? preferred : fallback;
  const exists = isInside(cwd, chosen) && fs.existsSync(chosen) && fs.statSync(chosen).isFile();
  return {
    path: isInside(cwd, chosen)
      ? normalizeArtifactPath(cwd, chosen)
      : normalizeArtifactPath(cwd, preferred),
    exists,
  };
}

/** Resolve a raw relation by unique exact ID first, then local path. */
export function resolveArtifactRelation(
  cwd: string,
  source: ArtifactRecord,
  rawValue: string,
  records: ArtifactRecord[],
): ArtifactRecord | undefined {
  const value = rawValue.trim();
  if (isExternalArtifactReference(value)) return undefined;
  const byId = records.filter((record) => record.id === value);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return undefined;
  const target = localTarget(cwd, source, value);
  return records.find((record) => record.path === target.path);
}

function issueCompare(left: ArtifactGraphIssue, right: ArtifactGraphIssue): number {
  return compareStrings(left.code, right.code) || compareStrings(left.message, right.message);
}

function edgeCompare(left: ArtifactEdge, right: ArtifactEdge): number {
  const kindOrder: Record<ArtifactEdgeKind, number> = {
    lineage: 0,
    "task-dependency": 1,
    contextual: 2,
    evidence: 3,
  };
  return kindOrder[left.kind] - kindOrder[right.kind]
    || compareStrings(left.from, right.from)
    || compareStrings(left.relation, right.relation)
    || compareStrings(left.to ?? "", right.to ?? "")
    || Number(left.external) - Number(right.external);
}

/** Project Markdown front matter into an explicit graph and retain scan metadata for state gates. */
export function scanArtifactGraph(options: ArtifactGraphOptions): ArtifactGraphProjection {
  const cwd = path.resolve(options.cwd);
  const records = readRecords({ ...options, cwd });
  const nodes: ArtifactNode[] = records.map(({ path: recordPath, id, type }) => ({ path: recordPath, id, type }));
  const byId = new Map<string, ArtifactRecord[]>();
  for (const record of records) {
    if (!record.id) continue;
    const values = byId.get(record.id) ?? [];
    values.push(record);
    byId.set(record.id, values);
  }
  const edges: ArtifactEdge[] = [];
  const issues: ArtifactGraphIssue[] = [];
  for (const record of records) {
    for (const relationIssue of record.relationIssues) {
      issues.push({
        code: "broken-relation",
        message: relationIssue,
      });
    }
  }
  for (const [id, values] of byId.entries()) {
    if (values.length > 1) {
      issues.push({
        code: "duplicate-id",
        message: `Duplicate artifact ID ${id}: ${values.map((record) => record.path).sort(compareStrings).join(", ")}`,
      });
    }
  }
  for (const source of records) {
    for (const [relation, values] of Object.entries(source.relations)) {
      const kind = classifyArtifactRelation(relation);
      for (const value of values) {
        if (isExternalArtifactReference(value)) {
          edges.push({ from: source.path, to: null, relation, kind, external: true });
          continue;
        }
        const target = resolveArtifactRelation(cwd, source, value, records);
        edges.push({ from: source.path, to: target?.path ?? null, relation, kind, external: false });
        if (!target) {
          const local = localTarget(cwd, source, value);
          if (!local.exists) {
            issues.push({
              code: "broken-relation",
              message: `Broken ${relation} relation from ${source.path} to ${value}${local.path ? ` (${local.path})` : ""}`,
            });
          }
        }
      }
    }
  }
  return {
    records,
    graph: {
      nodes: [...nodes].sort((left, right) => compareStrings(left.path, right.path)),
      edges: edges.sort(edgeCompare),
      issues: [...new Map(issues.map((issue) => [`${issue.code}\u0000${issue.message}`, issue])).values()].sort(issueCompare),
    },
  };
}

export function projectArtifactGraph(options: ArtifactGraphOptions): ArtifactGraph {
  return scanArtifactGraph(options).graph;
}

export function lineageEdges(graph: ArtifactGraph, pathValue: string): ArtifactEdge[] {
  return graph.edges.filter((edge) => edge.kind === "lineage" && (edge.from === pathValue || edge.to === pathValue));
}

/** Traverse only lineage edges in both directions from the supplied artifact paths. */
export function lineageComponent(graph: ArtifactGraph, starts: Iterable<string>): string[] {
  const visited = new Set<string>();
  const queue = [...starts].sort(compareStrings);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of lineageEdges(graph, current)) {
      const next = edge.from === current ? edge.to : edge.from;
      if (next && !visited.has(next)) queue.push(next);
    }
    queue.sort(compareStrings);
  }
  return [...visited].sort(compareStrings);
}

export function artifactRelationTargets(
  graph: ArtifactGraph,
  sourcePath: string,
  relationNames: Iterable<string>,
): string[] {
  const names = new Set(relationNames);
  return graph.edges
    .filter((edge) => edge.kind === "lineage" && edge.from === sourcePath && edge.to !== null && names.has(edge.relation))
    .map((edge) => edge.to as string)
    .sort(compareStrings);
}

export function artifactHasRelation(
  graph: ArtifactGraph,
  sourcePath: string | undefined,
  relationNames: Iterable<string>,
  targetPath: string | undefined,
): boolean {
  return Boolean(sourcePath && targetPath && artifactRelationTargets(graph, sourcePath, relationNames).includes(targetPath));
}

export type ArtifactChain = {
  spec?: string;
  adr?: string;
  design?: string;
  plan?: string;
  tasks: string[];
  anchors?: string[];
};

const CHAIN_STATUSES: Record<string, ReadonlySet<string>> = {
  spec: new Set(["proposed", "approved", "implemented"]),
  adr: new Set(["proposed", "accepted"]),
  design: new Set(["approved"]),
  plan: new Set(["approved", "in-progress", "completed"]),
};

function isValidChainRecord(record: ArtifactRecord): boolean {
  return Boolean(record.type && CHAIN_STATUSES[record.type]?.has(record.status ?? ""));
}

function chainKey(chain: ArtifactChain): string {
  return [chain.spec, chain.adr, chain.design, chain.plan].map((value) => value ?? "").join("\u0000");
}

function chainMembers(chain: ArtifactChain): Set<string> {
  return new Set([chain.spec, chain.adr, chain.design, chain.plan, ...chain.tasks, ...(chain.anchors ?? [])]
    .filter((value): value is string => Boolean(value)));
}

function preDesignAnchors(graph: ArtifactGraph, records: ArtifactRecord[], spec: ArtifactRecord, adr: ArtifactRecord): string[] | undefined {
  const direct = graph.edges.some((edge) => edge.kind === "lineage"
    && ["derives-from", "derived-by", "refines", "refined-by"].includes(edge.relation)
    && ((edge.from === spec.path && edge.to === adr.path) || (edge.from === adr.path && edge.to === spec.path)));
  const discoveries = records.filter((record) => record.type === "discovery" && [spec, adr].every((artifact) => graph.edges.some((edge) =>
    (edge.from === artifact.path && edge.to === record.path && edge.relation === "derives-from")
    || (edge.from === record.path && edge.to === artifact.path && edge.relation === "derived-by"))));
  return direct || discoveries.length > 0 ? discoveries.map((record) => record.path) : undefined;
}

/** Enumerate valid spec/ADR/design/plan/task chains from typed lineage edges. */
export function artifactChainCandidates(graph: ArtifactGraph, records: ArtifactRecord[]): ArtifactChain[] {
  const specs = records.filter((record) => record.type === "spec" && isValidChainRecord(record));
  const adrs = records.filter((record) => record.type === "adr" && isValidChainRecord(record));
  const designs = records.filter((record) => record.type === "design" && isValidChainRecord(record));
  const plans = records.filter((record) => record.type === "plan" && isValidChainRecord(record));
  const tasks = records.filter((record) => record.type === "task");
  const chains = new Map<string, ArtifactChain>();
  const add = (chain: ArtifactChain): void => chains.set(chainKey(chain), chain);
  const cartesian = <T>(values: T[], fallback: Array<T | undefined>): Array<T | undefined> => values.length > 0 ? values : fallback;

  for (const design of designs) {
    const relatedSpecs = specs.filter((candidate) => artifactHasRelation(graph, design.path, ["derives-from", "implements"], candidate.path));
    const relatedAdrs = adrs.filter((candidate) => artifactHasRelation(graph, design.path, ["derives-from"], candidate.path));
    const relatedPlans = plans.filter((candidate) => artifactHasRelation(graph, candidate.path, ["derives-from", "design"], design.path));
    for (const spec of cartesian(relatedSpecs, [undefined])) {
      for (const adr of cartesian(relatedAdrs, [undefined])) {
        for (const plan of cartesian(relatedPlans, [undefined])) {
          add({
            spec: spec?.path,
            adr: adr?.path,
            design: design.path,
            plan: plan?.path,
            tasks: plan
              ? tasks.filter((task) => artifactHasRelation(graph, task.path, ["implements"], plan.path)).map((task) => task.path)
              : [],
          });
        }
      }
    }
  }
  for (const plan of plans) {
    if (designs.some((design) => artifactHasRelation(graph, plan.path, ["derives-from", "design"], design.path))) continue;
    add({ plan: plan.path, tasks: tasks.filter((task) => artifactHasRelation(graph, task.path, ["implements"], plan.path)).map((task) => task.path) });
  }
  const unassignedSpecs = specs.filter((spec) => !designs.some((design) => artifactHasRelation(graph, design.path, ["derives-from", "implements"], spec.path)));
  const unassignedAdrs = adrs.filter((adr) => !designs.some((design) => artifactHasRelation(graph, design.path, ["derives-from", "implements"], adr.path)));
  const paired = new Set<string>();
  for (const spec of unassignedSpecs) {
    for (const adr of unassignedAdrs) {
      const anchors = preDesignAnchors(graph, records, spec, adr);
      if (!anchors) continue;
      add({ spec: spec.path, adr: adr.path, tasks: [], anchors });
      paired.add(spec.path);
      paired.add(adr.path);
    }
  }
  for (const artifact of [...specs, ...adrs]) {
    if (!paired.has(artifact.path)
      && !designs.some((design) => artifactHasRelation(graph, design.path, ["derives-from", "implements"], artifact.path))) {
      add(artifact.type === "spec" ? { spec: artifact.path, tasks: [] } : { adr: artifact.path, tasks: [] });
    }
  }
  return [...chains.values()].sort((left, right) => compareStrings(chainKey(left), chainKey(right)));
}

export function selectArtifactChain(
  graph: ArtifactGraph,
  records: ArtifactRecord[],
  focusPaths: Iterable<string>,
): ArtifactChain | undefined {
  const focus = [...focusPaths];
  const candidates = artifactChainCandidates(graph, records).filter((chain) => {
    const members = chainMembers(chain);
    return focus.every((focusPath) => members.has(focusPath));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function isArtifactFocusAmbiguous(
  graph: ArtifactGraph,
  records: ArtifactRecord[],
  focusPaths: Iterable<string>,
): boolean {
  const focus = [...focusPaths];
  const relevant = focus.some((focusPath) => {
    const type = records.find((record) => record.path === focusPath)?.type;
    return ["discovery", "spec", "adr", "design", "plan", "task"].includes(type ?? "");
  });
  if (!relevant) return false;
  const candidates = artifactChainCandidates(graph, records).filter((chain) => {
    const members = chainMembers(chain);
    return focus.every((focusPath) => members.has(focusPath));
  });
  return candidates.length > 1;
}

export type ArtifactFocusResolution = {
  focus: string[];
  focusedPath?: string;
  blockers: string[];
};

/** Resolve raw focus by unique ID before path and fail closed on ambiguous chains. */
export function resolveArtifactFocus(
  cwd: string,
  graph: ArtifactGraph,
  records: ArtifactRecord[],
  values: Iterable<string>,
): ArtifactFocusResolution {
  const rawValues = [...values];
  if (rawValues.length === 0) {
    const active = records.filter((record) => record.status && ACTIVE_STATUSES_FOR_FOCUS.has(record.status));
    return { focus: [], blockers: active.length > 0 ? ["focus-required"] : [] };
  }
  let duplicateId = false;
  const normalized = rawValues.map((value) => {
    const byId = records.filter((record) => record.id === value);
    if (byId.length > 1) {
      duplicateId = true;
      return value;
    }
    if (byId.length === 1) return byId[0].path;
    return normalizeArtifactPath(cwd, value);
  });
  const focus = sortedUnique(normalized);
  if (duplicateId) return { focus, blockers: ["focus-required"] };
  if (focus.some((focusPath) => !records.some((record) => record.path === focusPath))) {
    return { focus, blockers: ["focus-invalid"] };
  }
  if (isArtifactFocusAmbiguous(graph, records, focus)) return { focus, blockers: ["focus-required"] };
  const component = lineageComponent(graph, focus);
  const plans = records.filter((record) => component.includes(record.path) && record.type === "plan");
  if (focus.length > 1 && !selectArtifactChain(graph, records, focus)) return { focus, blockers: ["focus-required"] };
  const rank: Record<string, number> = { plan: 0, design: 1, spec: 2, adr: 3, task: 4 };
  const focused = records.filter((record) => focus.includes(record.path))
    .sort((left, right) => (rank[left.type ?? ""] ?? 9) - (rank[right.type ?? ""] ?? 9) || compareStrings(left.path, right.path))[0];
  if (plans.length > 1 && focused?.type !== "plan") return { focus, blockers: ["focus-required"] };
  return { focus, focusedPath: focused?.path, blockers: [] };
}

const ACTIVE_STATUSES_FOR_FOCUS = new Set([
  "draft", "proposed", "approved", "in-progress", "todo", "blocked", "capturing",
  "confirmed", "routed", "active",
]);
