import fs from "node:fs";
import path from "node:path";

import { normalizeRepoPath } from "./task_graph";

/** Relations that establish lifecycle lineage between canonical artifacts. */
export const LIFECYCLE_LINEAGE_RELATIONS: ReadonlySet<string> = new Set([
  "implements",
  "implemented-by",
  "derives-from",
  "derived-by",
  "refines",
  "refined-by",
]);

export type LifecycleArtifact = {
  id: string;
  path: string;
  absolutePath?: string;
};

export type LifecycleLocalTarget = {
  value: string;
  exists: boolean;
  external: boolean;
};

const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Return whether a relation value is an external URI or protocol-relative reference. */
export function isExternalReference(value: string): boolean {
  return EXTERNAL_REFERENCE.test(value.trim());
}

function isInside(cwd: string, candidate: string): boolean {
  const root = path.resolve(cwd);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/** Resolve a local relation to a stable repository path without changing the raw value. */
export function normalizeLifecycleLocalTarget(
  cwd: string,
  owner: string,
  target: string,
): LifecycleLocalTarget {
  const trimmed = target.trim();
  if (isExternalReference(trimmed)) return { value: trimmed, exists: true, external: true };

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

/** Parse relation front matter while retaining trimmed raw values for ID-first resolution. */
export function parseLifecycleRelations(
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
    if (key === "changes" && value && typeof value === "object" && !Array.isArray(value)) continue;
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    if (typeof value !== "string" && !Array.isArray(value)) {
      issues.push(`invalid-relation:${normalizeRepoPath(cwd, absolutePath)}:${key}`);
      relations[key] = [];
      continue;
    }
    const parsed: string[] = [];
    for (const item of values) {
      if (typeof item !== "string" || !item.trim()) {
        issues.push(`invalid-relation:${normalizeRepoPath(cwd, absolutePath)}:${key}`);
        continue;
      }
      parsed.push(item.trim());
    }
    relations[key] = sortedUnique(parsed);
  }
  return { relations, issues };
}

/** Resolve a relation by its unique exact artifact ID before falling back to a local path. */
export function resolveLifecycleRelationTarget<T extends LifecycleArtifact>(
  cwd: string,
  source: T,
  rawValue: string,
  artifacts: T[],
): T | undefined {
  const trimmed = rawValue.trim();
  if (isExternalReference(trimmed)) return undefined;
  const byId = artifacts.filter((artifact) => artifact.id === trimmed);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return undefined;
  const owner = source.absolutePath ?? path.resolve(cwd, source.path);
  const pathValue = normalizeLifecycleLocalTarget(cwd, owner, trimmed).value;
  return artifacts.find((artifact) => artifact.path === pathValue);
}
