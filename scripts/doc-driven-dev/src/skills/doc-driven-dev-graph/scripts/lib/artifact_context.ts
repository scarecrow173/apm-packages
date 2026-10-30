/**
 * Progressive artifact context retrieval (Issue #124).
 *
 * L1 listArtifactMetadata  — body-free metadata for the focus-resolved chain
 *                            plus each chain record's typed-relation neighbors.
 * L2 fetchArtifactBodies   — validated body fetch for canonical refs
 *                            (path containment, existence, parse, id and
 *                            fingerprint checks — stale refs fail closed).
 * L3 expandArtifactContext — bounded deterministic BFS over typed relations
 *                            with cycle guard, duplicate suppression and a
 *                            recorded reason.
 *
 * All relation resolution goes through artifact_graph's helpers
 * (scanArtifactGraph / resolveArtifactFocus / selectArtifactChain /
 * resolveArtifactRelation / localTarget); nothing re-parses front matter or
 * maintains a second index. Findings are fail-closed: every refused lookup is
 * recorded, never silently dropped.
 */

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import {
  CANONICAL_DOC_DIRS,
  isExternalArtifactReference,
  isInsideCheckout,
  LINEAGE_RELATIONS,
  normalizeArtifactPath,
  repoPathKey,
  resolveArtifactFocus,
  resolveArtifactRelation,
  resolveContainedTaskDir,
  scanArtifactGraph,
  selectArtifactChain,
  type ArtifactChain,
  type ArtifactRecord,
} from "./artifact_graph";
import { canonicalReference } from "./caller_runner";

export type ContextLevel = "L1" | "L2" | "L3";

export type ArtifactMetadata = {
  path: string;
  id: string | null;
  type: string | null;
  status: string | null;
  relations: Record<string, string[]>;
};

export type ContextFinding = { code: string; path?: string; message: string };

export type FetchResult = {
  level: ContextLevel;
  documents: Array<{ path: string; id: string | null; body: string }>;
  findings: ContextFinding[];
};

export type ExpandOptions = { relations?: string[]; maxDepth?: number; reason?: string; taskDir?: string };
export type ExpandNode = { path: string; id: string | null; depth: number; via: string | null };
export type ExpandResult = { nodes: ExpandNode[]; findings: ContextFinding[]; reason?: string };

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

/** Deterministic, deduplicated finding list: sorted by code, path, message. */
function finalizeFindings(findings: ContextFinding[]): ContextFinding[] {
  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    const key = `${finding.code}\u0000${finding.path ?? ""}\u0000${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((left, right) => compareStrings(left.code, right.code)
    || compareStrings(left.path ?? "", right.path ?? "")
    || compareStrings(left.message, right.message));
}

function chainMemberPaths(chain: ArtifactChain): string[] {
  return [chain.spec, chain.adr, chain.design, chain.plan, ...chain.tasks, ...(chain.anchors ?? [])]
    .filter((value): value is string => Boolean(value));
}

/** Records whose `id` collides with `value` (>1 means the lookup is ambiguous). */
function idCollisionCount(records: ArtifactRecord[], value: string): number {
  return records.filter((record) => record.id === value.trim()).length;
}

/**
 * L1 — metadata for the focus chain plus each chain record's resolved
 * typed-relation neighbors. Bodies are never included.
 */
export function listArtifactMetadata(
  cwd: string,
  focus: string[],
  taskDir?: string,
): { metadata: ArtifactMetadata[]; findings: ContextFinding[] } {
  const repo = path.resolve(cwd);
  const { graph, records } = scanArtifactGraph({ cwd: repo, taskDir });
  const findings: ContextFinding[] = graph.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
  }));
  const byPath = new Map(records.map((record) => [record.path, record]));

  if (focus.length === 0) {
    findings.push({ code: "focus-required", message: "Artifact focus is required to list metadata" });
    return { metadata: [], findings: finalizeFindings(findings) };
  }

  const resolution = resolveArtifactFocus(repo, graph, records, focus);
  if (resolution.blockers.length > 0) {
    // A supplied focus that cannot be resolved — unknown path, ambiguous ID,
    // or multiple candidate chains — is invalid; fail closed without guessing.
    for (const blocker of new Set(resolution.blockers)) {
      findings.push({
        code: "focus-invalid",
        message: `Focus did not resolve to a unique artifact chain (${blocker}): ${focus.join(", ")}`,
      });
    }
    return { metadata: [], findings: finalizeFindings(findings) };
  }

  const chain = selectArtifactChain(graph, records, resolution.focus);
  const included = new Map<string, ArtifactRecord>();
  for (const memberPath of chain ? chainMemberPaths(chain) : resolution.focus) {
    const record = byPath.get(memberPath);
    if (record) included.set(record.path, record);
  }

  // Typed-relation neighbors of chain records (one hop, both directions where
  // declared — resolveArtifactRelation owns id-then-path resolution).
  for (const record of [...included.values()]) {
    for (const [relation, values] of Object.entries(record.relations).sort(([a], [b]) => compareStrings(a, b))) {
      for (const value of values) {
        if (isExternalArtifactReference(value)) continue;
        const target = resolveArtifactRelation(repo, record, value, records);
        if (target) {
          included.set(target.path, target);
        } else {
          findings.push({
            code: idCollisionCount(records, value) > 1 ? "ambiguous-target" : "broken-relation",
            path: record.path,
            message: `Unresolved ${relation} relation target ${value} from ${record.path}`,
          });
        }
      }
    }
  }

  const metadata = [...included.values()]
    .map((record) => ({
      path: record.path,
      id: record.id,
      type: record.type,
      status: record.status,
      relations: { ...record.relations },
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
  return { metadata, findings: finalizeFindings(findings) };
}

/**
 * Path is a scannable canonical artifact doc: under one of the canonical
 * doc-bearing directories (the CANONICAL_DOC_DIRS authority plus the resolved
 * `--task-dir`), ends in `.md`, and is not a README/index file. An empty
 * `""` directory entry models the checkout root — every contained doc path
 * sits inside it, matching the scan set.
 */
function isCanonicalDocPath(normalizedPath: string, canonicalDirs: readonly string[]): boolean {
  const base = normalizedPath.split("/").pop() ?? "";
  if (!base.toLowerCase().endsWith(".md")) return false;
  if (/^(?:readme|index)\.md$/i.test(base)) return false;
  // repoPathKey folds case on Windows so a `DOCS/TASKS/x.md` ref still names
  // the same canonical file the scan recorded (Issue #156).
  const key = repoPathKey(normalizedPath);
  return canonicalDirs.some((directory) => directory === "" || key.startsWith(`${repoPathKey(directory)}/`));
}

/**
 * L2 — validated body fetch. Every ref must resolve inside the checkout, name
 * a canonical artifact doc that exists and parses; supplied `id`/`fingerprint`
 * must match the live canonical reference. `taskDir` is the same `--task-dir`
 * selector L1 accepts: it extends the canonical scan set so a ref that L1 can
 * list is never refused here as `not-canonical` (L1→L2 parity, Issue #141).
 * The shared containment rule applies — an escaping `taskDir` throws before
 * any ref is validated, identical to the scan boundary (Issue #142).
 * Refused refs land in `findings`, never in `documents`.
 */
export function fetchArtifactBodies(
  cwd: string,
  refs: Array<{ path: string; id?: string; fingerprint?: string }>,
  taskDir?: string,
): FetchResult {
  const repo = path.resolve(cwd);
  // Resolve up front: an escaping --task-dir is a caller error identical to
  // the one the artifact scan raises — fail closed before touching refs.
  const canonicalDirs: readonly string[] = [...CANONICAL_DOC_DIRS, resolveContainedTaskDir(repo, taskDir)];
  const documents: FetchResult["documents"] = [];
  const findings: ContextFinding[] = [];

  for (const ref of refs) {
    const fail = (code: string, message: string): void => {
      findings.push({ code, path: ref.path, message });
    };

    if (path.isAbsolute(ref.path)) {
      fail("path-escape", `Ref path must be checkout-relative: ${ref.path}`);
      continue;
    }
    const resolved = path.resolve(repo, ref.path);
    // Containment is checked lexically and by real path — a symlinked doc
    // inside the checkout that resolves outside must not be read (same
    // boundary rule as the task-dir selector).
    if (!isInsideCheckout(repo, resolved)) {
      fail("path-escape", `Ref path escapes the checkout: ${ref.path}`);
      continue;
    }
    const normalized = normalizeArtifactPath(repo, resolved);
    if (!isCanonicalDocPath(normalized, canonicalDirs)) {
      fail("not-canonical", `Ref path is not a canonical artifact doc: ${ref.path}`);
      continue;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      fail("not-found", `Ref path does not exist: ${ref.path}`);
      continue;
    }

    let body: string;
    let reference: { path: string; id: string; fingerprint: string };
    try {
      body = matter(fs.readFileSync(resolved, "utf8")).content;
      reference = canonicalReference(repo, normalized);
    } catch {
      fail("unreadable", `Ref path does not parse as an artifact doc: ${ref.path}`);
      continue;
    }

    const recordId = reference.id ?? null;
    if (ref.id !== undefined && ref.id !== recordId) {
      fail("id-mismatch", `Ref id ${ref.id} does not match resolved id ${recordId ?? "none"}: ${ref.path}`);
      continue;
    }
    if (ref.fingerprint !== undefined && ref.fingerprint !== reference.fingerprint) {
      fail("stale-fingerprint", `Ref fingerprint is stale for ${ref.path} — re-fetch after re-projection`);
      continue;
    }
    documents.push({ path: normalized, id: recordId, body });
  }

  documents.sort((left, right) => compareStrings(left.path, right.path));
  return { level: "L2", documents, findings: finalizeFindings(findings) };
}

/**
 * L3 — deterministic BFS over typed relations from `fromPath` (unique ID or
 * checkout-relative path). Default traversal set is LINEAGE_RELATIONS; default
 * depth is 2. `taskDir` is the same `--task-dir` selector L1 accepts, so the
 * scan set matches the metadata projection (Issue #141). Visited-set cycle
 * guard and duplicate suppression are built in; every refused lookup is
 * recorded as a finding. An explicitly requested `--relations` name that no
 * scanned record declares is reported as `unused-relation` — "declared" means
 * present in some scanned record's relation keys anywhere in the scan set,
 * not only on the walked nodes, because the finding exists to catch typos:
 * a misspelled name appears nowhere at all (Issue #143).
 */
export function expandArtifactContext(
  cwd: string,
  fromPath: string,
  options: ExpandOptions,
): ExpandResult {
  const repo = path.resolve(cwd);
  const { records } = scanArtifactGraph({ cwd: repo, taskDir: options.taskDir });
  const findings: ContextFinding[] = [];
  const byPath = new Map(records.map((record) => [record.path, record]));

  let root: ArtifactRecord | undefined;
  const trimmed = fromPath.trim();
  const idMatches = records.filter((record) => record.id === trimmed);
  if (idMatches.length === 1) {
    root = idMatches[0];
  } else if (idMatches.length > 1) {
    findings.push({
      code: "duplicate-id",
      message: `Expansion root ${fromPath} matches ${idMatches.length} artifact IDs: ${idMatches.map((record) => record.path).sort(compareStrings).join(", ")}`,
    });
  } else {
    root = byPath.get(normalizeArtifactPath(repo, trimmed));
    if (!root) {
      findings.push({ code: "not-found", path: trimmed, message: `Expansion root does not resolve to an artifact: ${fromPath}` });
    }
  }
  if (!root) {
    return {
      nodes: [],
      findings: finalizeFindings(findings),
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
    };
  }

  const relations = new Set(options.relations ?? [...LINEAGE_RELATIONS]);
  const maxDepth = options.maxDepth ?? 2;
  const visited = new Set<string>([root.path]);
  const nodes: ExpandNode[] = [{ path: root.path, id: root.id, depth: 0, via: null }];
  const queue: Array<{ record: ArtifactRecord; depth: number }> = [{ record: root, depth: 0 }];

  while (queue.length > 0) {
    const { record, depth } = queue.shift() as { record: ArtifactRecord; depth: number };
    if (depth >= maxDepth) continue;
    for (const [relation, values] of Object.entries(record.relations).sort(([a], [b]) => compareStrings(a, b))) {
      if (!relations.has(relation)) continue;
      for (const value of values) {
        if (isExternalArtifactReference(value)) continue;
        const target = resolveArtifactRelation(repo, record, value, records);
        if (!target) {
          findings.push({
            code: idCollisionCount(records, value) > 1 ? "ambiguous-target" : "broken-relation",
            path: record.path,
            message: `Unresolved ${relation} relation target ${value} from ${record.path}`,
          });
          continue;
        }
        if (visited.has(target.path)) continue;
        visited.add(target.path);
        nodes.push({ path: target.path, id: target.id, depth: depth + 1, via: relation });
        queue.push({ record: target, depth: depth + 1 });
      }
    }
  }

  // A relation name the caller explicitly requested but that no scanned
  // record declares can never be traversed — almost certainly a typo. The
  // default lineage set is curated, so only explicit --relations are checked.
  if (options.relations !== undefined) {
    const declared = new Set(records.flatMap((record) => Object.keys(record.relations)));
    for (const name of relations) {
      if (!declared.has(name)) {
        findings.push({
          code: "unused-relation",
          message: `Requested relation ${name} is not declared on any scanned artifact record`,
        });
      }
    }
  }

  nodes.sort((left, right) => left.depth - right.depth || compareStrings(left.path, right.path));
  return {
    nodes,
    findings: finalizeFindings(findings),
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  };
}
