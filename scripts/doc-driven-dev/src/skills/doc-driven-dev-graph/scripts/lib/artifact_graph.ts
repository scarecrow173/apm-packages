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

function relationValues(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string[]> = {};
  for (const key of Object.keys(raw as Record<string, unknown>).sort(compareStrings)) {
    const value = (raw as Record<string, unknown>)[key];
    if (key === "changes" && value && typeof value === "object" && !Array.isArray(value)) continue;
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    result[key] = sortedUnique(values.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()));
  }
  return result;
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
      const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
      const type = typeof data.type === "string" && data.type.trim() ? data.type.trim() : null;
      const status = typeof data.status === "string" && data.status.trim() ? data.status.trim() : null;
      records.push({
        path: normalizeArtifactPath(cwd, absolutePath),
        id,
        type,
        status,
        absolutePath,
        body: parsed.content,
        relations: relationValues(data.relations),
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
          const targetPath = localTarget(cwd, source, value).path;
          issues.push({
            code: "broken-relation",
            message: `Broken ${relation} relation from ${source.path} to ${value}${targetPath ? ` (${targetPath})` : ""}`,
          });
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

export function selectPlanPath(graph: ArtifactGraph, focus: Iterable<string>): string | undefined {
  const component = lineageComponent(graph, focus);
  return graph.nodes
    .filter((node) => component.includes(node.path) && node.type === "plan")
    .map((node) => node.path)
    .sort(compareStrings)[0];
}
