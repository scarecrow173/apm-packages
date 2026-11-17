"use strict";

// ---------------------------------------------------------------------------
// Knowledge Relations v1 + Claim IDs (Issue #235)
// ---------------------------------------------------------------------------
//
// The typed, directed relation layer for durable documents. One schema —
// the Document Registry's `allowedRelations` — declares the canonical
// forward vocabulary (`motivates`, `decides-for`, `realizes`, `informs`,
// `explains`, `supersedes`), the allowed source→target type matrix, and the
// derived inverse name each relation projects. This module is the read
// authority for that schema:
//
//   - Nodes are logical durable documents (canonical files plus their
//     locale siblings — `artifactPrimaries` grouping), identified by their
//     front-matter `id`.
//   - Stored edges come ONLY from each source type's declared
//     `allowedRelations`. Legacy vocabulary keys (`implements`,
//     `derives-from`, `related`, `superseded-by`, …) are never graph data:
//     a populated non-v1 key surfaces as a `legacy-relation-field` issue —
//     the migration-domain marker — and resolves nothing. `source` is the
//     provenance contract (PROVENANCE_RELATION_KEYS), exempt but not a
//     knowledge edge.
//   - Inverse edges are derived projections (`motivated-by`, `decided-by`,
//     `realized-by`, `informed-by`, `explained-by`, `superseded-by`), never
//     stored, and consistent with the forward collation by construction.
//   - Claim IDs (`<document-id>::<KEY>`, e.g. `SPEC-<id>::R-01`) are the
//     durable reference unit for verification (#239 binds checks to them).
//     A claim is declared by an HTML comment marker in the body —
//     `<!-- claim:R-01 -->` or the self-qualifying
//     `<!-- claim:DOC::R-01 -->` — so it survives heading/body edits, and
//     the projection detects in-document duplicates, misplaced/moved
//     qualified claims, and unresolved claim references.
//
// Because only canonical durable documents are scanned, the graph never
// varies with Plan/Task or Evidence Record count or ordering (#236/#240):
// execution-bound and legacy artifacts are outside the node set, and every
// collection is emitted in deterministic order.
//
// There is no backward-compatible parser: pre-v3 relation keys are reported
// as `legacy-relation-field` issues (migration-domain findings), not read
// as graph input — the same contract the schema preflight's
// `legacy-relations` marker enforces under a declared manifest.

import { artifactKeyOf, artifactPrimaries, compareStrings, groupByArtifact, scanRepository } from "./doc_repository";
import type { DocumentRepository, RepositoryDocument, ScanOptions } from "./doc_repository";
import { allowedRelationsFor, knowledgeRelationFields, knowledgeRelationInverses, PROVENANCE_RELATION_KEYS } from "./doc_types";
import { nonReferenceRelationKeys } from "./document_utils";

// ---------------------------------------------------------------------------
// Claim ID grammar
// ---------------------------------------------------------------------------

// Local claim key inside a document — `R-01`, `AC-2`, `NFR-12`.
const CLAIM_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

// A claim reference is `<document-id>::<key>` — the owning document id and
// the document-local key, joined by `::` (e.g. `SPEC-<id>::R-01`).
const CLAIM_REFERENCE_PATTERN = /^([^\s:]+)::([A-Z][A-Z0-9]*-\d+)$/;

// Claim declaration marker anywhere in a document body:
// `<!-- claim:R-01 -->` or `<!-- claim:DOC-ID::R-01 -->`. The marker binds
// the claim identity to its position, so rewording the claim text or moving
// it across headings keeps the ID stable.
const CLAIM_MARKER_PATTERN = /<!--\s*claim\s*:(.*?)-->/g;

// Fenced code regions (``` / ~~~) are stripped before marker scanning so a
// marker shown as an example inside a fence is not adopted as a real claim.
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

type ClaimReference = {
  docId: string;
  key: string;
};

function isClaimKey(value: string): boolean {
  return CLAIM_KEY_PATTERN.test(value);
}

function parseClaimReference(value: string): ClaimReference | null {
  const match = CLAIM_REFERENCE_PATTERN.exec(value.trim());
  if (!match) return null;
  return { docId: match[1], key: match[2] };
}

function claimId(docId: string, key: string): string {
  return `${docId}::${key}`;
}

type ClaimDeclaration = {
  // The local claim key (`R-01`). Present only when the marker parsed.
  key: string | null;
  // The document id a qualified marker declares; null for the bare
  // `<!-- claim:KEY -->` form.
  declaredDocId: string | null;
  // Marker content when it matched neither KEY nor DOC::KEY.
  invalid: string | null;
  path: string;
  // 1-based line inside the file (body offset already applied).
  line: number;
  // Trailing text on the marker line — the claim's own prose anchor.
  text: string;
};

type KnowledgeClaim = {
  // Local key, unique within the owning document (`R-01`).
  key: string;
  // Fully qualified claim id (`SPEC-<id>::R-01`); null when the owning
  // document declares no front-matter id and the claim cannot be addressed.
  id: string | null;
  path: string;
  line: number;
  text: string;
};

// Strip fenced code blocks, preserving line count/positions.
function unfencedBody(body: string): string {
  const lines = body.split("\n");
  let fenceChar: string | null = null;
  return lines.map((line) => {
    const fence = FENCE_PATTERN.exec(line.trimStart());
    if (fenceChar === null) {
      if (fence) {
        fenceChar = fence[1][0];
        return "";
      }
      return line;
    }
    if (fence && fence[1][0] === fenceChar) {
      fenceChar = null;
    }
    return "";
  }).join("\n");
}

function extractClaimDeclarations(document: RepositoryDocument): ClaimDeclaration[] {
  const declarations: ClaimDeclaration[] = [];
  const body = unfencedBody(document.body);
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = document.bodyStartLine + index + 1;
    for (const match of line.matchAll(CLAIM_MARKER_PATTERN)) {
      const raw = match[1].trim();
      const qualified = parseClaimReference(raw);
      const bare = !qualified && isClaimKey(raw) ? raw : null;
      declarations.push({
        key: qualified?.key ?? bare,
        declaredDocId: qualified?.docId ?? null,
        invalid: qualified === null && bare === null ? raw : null,
        path: document.path,
        line: lineNo,
        text: line.slice((match.index ?? 0) + match[0].length).trim(),
      });
    }
  }
  return declarations;
}

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

type KnowledgeNode = {
  // Logical artifact identity (locale siblings share it).
  key: string;
  // Primary file — the non-localized path when the group has one.
  path: string;
  id: string | null;
  type: string;
  paths: string[];
  claims: KnowledgeClaim[];
};

type KnowledgeEdgeEndpoint = {
  path: string;
  id: string | null;
};

type KnowledgeEdge = {
  // Source document endpoint.
  from: KnowledgeEdgeEndpoint;
  // Stored forward field (`motivates`, `supersedes`, …) — always a
  // canonical v1 relation declared for the source type.
  relation: string;
  // The stored target value as written.
  target: string;
  // Resolved target document, or null for unresolved/ambiguous/external/
  // non-document targets (`resolution` says which).
  to: KnowledgeEdgeEndpoint | null;
  // Qualified claim id (`DOC::KEY`) when the stored target is a claim
  // reference; the claim belongs to the `to` document.
  claim: string | null;
  resolution: "resolved" | "unresolved" | "ambiguous" | "escaped" | "external" | "non-document";
  derived: false;
};

// A derived inverse edge — the projection of a stored forward edge onto the
// target's inbound view. Never written to a document; `via` names the
// forward relation it derives from.
type DerivedKnowledgeEdge = {
  from: KnowledgeEdgeEndpoint;
  // Derived inverse name (`motivated-by`, `superseded-by`, …).
  relation: string;
  target: string;
  to: KnowledgeEdgeEndpoint;
  claim: string | null;
  via: string;
  derived: true;
};

type KnowledgeGraphIssueCode =
  | "invalid-claim-id"
  | "claim-without-doc-id"
  | "duplicate-claim"
  | "claim-doc-mismatch"
  | "unresolved-claim-target"
  | "legacy-relation-field"
  | "invalid-relation-field"
  | "unresolved-relation-target"
  | "ambiguous-relation-target"
  | "relation-escapes-root"
  | "self-relation"
  | "invalid-relation-target-type"
  | "relation-cycle";

type KnowledgeGraphIssue = {
  code: KnowledgeGraphIssueCode;
  // Document path the issue is attributed to (primary path of the
  // declaring artifact for node-level issues, the source document for
  // edge issues).
  path: string;
  message: string;
  // Offending value when one exists (claim key/id, relation field or target).
  target: string | null;
  line: number | null;
};

type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  // Stored forward edges — canonical v1 relations only.
  edges: KnowledgeEdge[];
  // Derived inverse projection of the resolved forward edges.
  derivedEdges: DerivedKnowledgeEdge[];
  issues: KnowledgeGraphIssue[];
};

// Outbound stored edges plus inbound derived edges for one document — the
// focus neighborhood the context projection consumes. `ref` accepts a
// document id or a primary path.
function knowledgeNeighbors(graph: KnowledgeGraph, ref: string): { outbound: KnowledgeEdge[]; inbound: DerivedKnowledgeEdge[] } {
  const node = graph.nodes.find((candidate) => candidate.id === ref || candidate.path === ref);
  if (!node) return { outbound: [], inbound: [] };
  return {
    outbound: graph.edges.filter((edge) => edge.from.path === node.path),
    inbound: graph.derivedEdges.filter((edge) => edge.from.path === node.path),
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const V1_FIELDS: ReadonlySet<string> = new Set(knowledgeRelationFields());
const INVERSES = knowledgeRelationInverses();

function declaredRelationFields(type: string): Map<string, readonly string[]> {
  const declared = new Map<string, readonly string[]>();
  for (const relation of allowedRelationsFor(type)) {
    declared.set(relation.field, relation.targetTypes);
  }
  return declared;
}

function unionRelations(documents: RepositoryDocument[]): Record<string, string[]> {
  const merged: Record<string, Set<string>> = {};
  for (const document of documents) {
    for (const [field, targets] of Object.entries(document.relations)) {
      const bucket = merged[field] ?? new Set<string>();
      for (const target of targets) bucket.add(target);
      merged[field] = bucket;
    }
  }
  return Object.fromEntries(
    Object.entries(merged).map(([field, values]) => [field, [...values].sort(compareStrings)]),
  );
}

function issueCompare(left: KnowledgeGraphIssue, right: KnowledgeGraphIssue): number {
  return compareStrings(left.path, right.path)
    || (left.line ?? 0) - (right.line ?? 0)
    || compareStrings(left.code, right.code)
    || compareStrings(left.target ?? "", right.target ?? "")
    || compareStrings(left.message, right.message);
}

function edgeCompare(left: KnowledgeEdge, right: KnowledgeEdge): number {
  return compareStrings(left.from.path, right.from.path)
    || compareStrings(left.relation, right.relation)
    || compareStrings(left.target, right.target);
}

function derivedEdgeCompare(left: DerivedKnowledgeEdge, right: DerivedKnowledgeEdge): number {
  return compareStrings(left.from.path, right.from.path)
    || compareStrings(left.relation, right.relation)
    || compareStrings(left.target, right.target);
}

// Tarjan's algorithm (iterative) over the document-level forward-edge
// adjacency. Only resolved edges between canonical nodes participate; a
// strongly connected component of size > 1 is a stored cycle to report —
// self-loops are already covered by `self-relation`.
function relationCycles(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): string[][] {
  const nodePaths = new Set(nodes.map((node) => node.path));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.resolution !== "resolved" || !edge.to || !nodePaths.has(edge.to.path)) continue;
    if (edge.to.path === edge.from.path) continue;
    const bucket = adjacency.get(edge.from.path) ?? [];
    bucket.push(edge.to.path);
    adjacency.set(edge.from.path, bucket);
  }

  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (root: string): void => {
    indexOf.set(root, counter);
    lowLink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    const callStack: { node: string; successors: string[]; next: number }[] = [
      { node: root, successors: [...(adjacency.get(root) ?? [])].sort(compareStrings), next: 0 },
    ];
    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame.next < frame.successors.length) {
        const w = frame.successors[frame.next];
        frame.next += 1;
        if (!indexOf.has(w)) {
          indexOf.set(w, counter);
          lowLink.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          callStack.push({ node: w, successors: [...(adjacency.get(w) ?? [])].sort(compareStrings), next: 0 });
        } else if (onStack.has(w)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, indexOf.get(w)!));
        }
        continue;
      }
      callStack.pop();
      if (callStack.length > 0) {
        const parent = callStack[callStack.length - 1];
        lowLink.set(parent.node, Math.min(lowLink.get(parent.node)!, lowLink.get(frame.node)!));
      }
      if (lowLink.get(frame.node) === indexOf.get(frame.node)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component.sort(compareStrings));
      }
    }
  };

  for (const nodePath of [...nodePaths].sort(compareStrings)) {
    if (!indexOf.has(nodePath)) strongConnect(nodePath);
  }
  return components.sort((a, b) => compareStrings(a[0], b[0]));
}

// The knowledge projection over an already-scanned repository model —
// callers that hold a DocumentRepository (lint, audits) share the scan; the
// standalone `scanKnowledgeGraph` performs its own.
function projectKnowledgeGraph(model: DocumentRepository): KnowledgeGraph {
  const issues: KnowledgeGraphIssue[] = [];
  const groups = groupByArtifact(model.canonicalDocuments);
  const nodes: KnowledgeNode[] = [];
  const nodeByKey = new Map<string, KnowledgeNode>();
  const claimsByKey = new Map<string, Map<string, KnowledgeClaim>>(); // node key -> claim key -> claim

  for (const [key, group] of [...groups.entries()].sort((a, b) => compareStrings(a[0], b[0]))) {
    const primary = artifactPrimaries(group)[0];
    const nodeClaims: KnowledgeClaim[] = [];
    const claimKeys = new Map<string, KnowledgeClaim>();
    const seenKeys = new Map<string, ClaimDeclaration>();

    for (const document of group) {
      for (const declaration of extractClaimDeclarations(document)) {
        if (declaration.invalid !== null) {
          issues.push({
            code: "invalid-claim-id",
            path: document.path,
            line: declaration.line,
            target: declaration.invalid,
            message: `Claim marker does not declare a claim key or DOC::KEY id: <!-- claim:${declaration.invalid} -->`,
          });
          continue;
        }
        const claimKey = declaration.key as string;
        if (primary.id !== null && declaration.declaredDocId !== null && declaration.declaredDocId !== primary.id) {
          // A qualified claim id living inside a different document — the
          // cross-document move / misplaced-claim signal.
          issues.push({
            code: "claim-doc-mismatch",
            path: document.path,
            line: declaration.line,
            target: `${declaration.declaredDocId}::${claimKey}`,
            message: `Claim ${declaration.declaredDocId}::${claimKey} is declared inside ${primary.id} — a moved claim must be re-keyed to its owning document`,
          });
          continue;
        }
        const first = seenKeys.get(claimKey);
        if (first && first.path === document.path) {
          issues.push({
            code: "duplicate-claim",
            path: document.path,
            line: declaration.line,
            target: claimKey,
            message: `Claim key ${claimKey} is declared more than once in ${document.path} (first at line ${first.line})`,
          });
          continue;
        }
        // Locale siblings may mirror the same claim key — one logical claim
        // in two languages, not a duplicate.
        if (!first) seenKeys.set(claimKey, declaration);
        const claim: KnowledgeClaim = {
          key: claimKey,
          id: primary.id ? claimId(primary.id, claimKey) : null,
          path: document.path,
          line: declaration.line,
          text: declaration.text,
        };
        if (!claimKeys.has(claimKey)) claimKeys.set(claimKey, claim);
        nodeClaims.push(claim);
      }
    }
    if (primary.id === null && nodeClaims.length > 0) {
      issues.push({
        code: "claim-without-doc-id",
        path: primary.path,
        line: null,
        target: null,
        message: `${primary.path} declares ${nodeClaims.length} claim(s) but has no front-matter id — claims cannot be referenced as <id>::<key>`,
      });
    }
    claimsByKey.set(key, claimKeys);
    const node: KnowledgeNode = {
      key,
      path: primary.path,
      id: primary.id,
      type: primary.type ?? "",
      paths: group.map((document) => document.path).sort(compareStrings),
      claims: nodeClaims.sort((a, b) => compareStrings(a.key, b.key) || a.line - b.line),
    };
    nodes.push(node);
    nodeByKey.set(key, node);
  }
  nodes.sort((a, b) => compareStrings(a.path, b.path));

  // Field-level validation on migration-owned documents: a legacy file
  // (plan/task/test-spec/impl/exp in a former dir) holding populated
  // relation keys still carries pre-v3 vocabulary — every populated
  // non-source key is a legacy finding (no declared v1 set exists for it).
  for (const document of model.legacyDocuments) {
    for (const field of Object.keys(document.relations).sort(compareStrings)) {
      if ((PROVENANCE_RELATION_KEYS as readonly string[]).includes(field)) continue;
      if (nonReferenceRelationKeys.has(field)) continue;
      issues.push({
        code: "legacy-relation-field",
        path: document.path,
        line: null,
        target: field,
        message: `relations.${field} is outside the Knowledge Relations v1 stored vocabulary (legacy keys are migration input, not graph data)`,
      });
    }
  }

  const edges: KnowledgeEdge[] = [];

  for (const [key, group] of [...groups.entries()].sort((a, b) => compareStrings(a[0], b[0]))) {
    const node = nodeByKey.get(key)!;
    const primary = artifactPrimaries(group)[0];
    const declared = declaredRelationFields(node.type);
    const relations = unionRelations(group);

    for (const [field, targets] of Object.entries(relations).sort((a, b) => compareStrings(a[0], b[0]))) {
      if ((PROVENANCE_RELATION_KEYS as readonly string[]).includes(field)) continue;
      if (nonReferenceRelationKeys.has(field)) continue;
      if (!V1_FIELDS.has(field)) {
        issues.push({
          code: "legacy-relation-field",
          path: node.path,
          line: null,
          target: field,
          message: `relations.${field} is outside the Knowledge Relations v1 stored vocabulary (stored forward set: ${[...V1_FIELDS].sort(compareStrings).join(", ")})`,
        });
        continue;
      }
      const targetTypes = declared.get(field);
      if (!targetTypes) {
        issues.push({
          code: "invalid-relation-field",
          path: node.path,
          line: null,
          target: field,
          message: `relations.${field} is a Knowledge Relations v1 field but is not declared for type ${node.type || "unknown"} (declared: ${[...declared.keys()].sort(compareStrings).join(", ") || "none"})`,
        });
        continue;
      }

      for (const target of targets) {
        const claimRef = parseClaimReference(target);
        if (claimRef) {
          const lookup = model.lookupById(claimRef.docId);
          if (lookup.status === "ambiguous") {
            edges.push({
              from: { path: node.path, id: node.id },
              relation: field,
              target,
              to: null,
              claim: target,
              resolution: "ambiguous",
              derived: false,
            });
            issues.push({
              code: "ambiguous-relation-target",
              path: node.path,
              line: null,
              target,
              message: `Relation ${field} claim target ${target} matches multiple documents: ${lookup.candidates.map((doc) => doc.path).join(", ")}`,
            });
          } else if (lookup.status === "none") {
            edges.push({
              from: { path: node.path, id: node.id },
              relation: field,
              target,
              to: null,
              claim: target,
              resolution: "unresolved",
              derived: false,
            });
            issues.push({
              code: "unresolved-relation-target",
              path: node.path,
              line: null,
              target,
              message: `Relation ${field} points to missing document: ${claimRef.docId}`,
            });
          } else {
            const targetDoc = lookup.document;
            const targetNode = nodeByKey.get(artifactKeyOf(targetDoc.path));
            edges.push({
              from: { path: node.path, id: node.id },
              relation: field,
              target,
              to: targetNode
                ? { path: targetNode.path, id: targetNode.id }
                : { path: targetDoc.path, id: targetDoc.id },
              claim: target,
              resolution: "resolved",
              derived: false,
            });
            const targetClaims = claimsByKey.get(artifactKeyOf(targetDoc.path));
            if (!targetClaims || !targetClaims.has(claimRef.key)) {
              issues.push({
                code: "unresolved-claim-target",
                path: node.path,
                line: null,
                target,
                message: `Relation ${field} targets claim ${target}, but ${targetDoc.path} declares no claim ${claimRef.key}`,
              });
            }
            if (targetNode && targetNode.key === node.key) {
              issues.push({
                code: "self-relation",
                path: node.path,
                line: null,
                target,
                message: `Relation ${field} references the document itself: ${target}`,
              });
            }
            if (targetDoc.type && !targetTypes.includes(targetDoc.type)) {
              issues.push({
                code: "invalid-relation-target-type",
                path: node.path,
                line: null,
                target,
                message: `Relation ${field} target resolves to type "${targetDoc.type}", expected one of: ${targetTypes.join(", ")}: ${target}`,
              });
            }
          }
          continue;
        }

        const resolved = model.resolveRelationTarget(primary, target);
        if (resolved.status === "external") {
          edges.push({
            from: { path: node.path, id: node.id },
            relation: field,
            target,
            to: null,
            claim: null,
            resolution: "external",
            derived: false,
          });
          continue;
        }
        if (resolved.status === "escaped") {
          edges.push({
            from: { path: node.path, id: node.id },
            relation: field,
            target,
            to: null,
            claim: null,
            resolution: "escaped",
            derived: false,
          });
          issues.push({
            code: "relation-escapes-root",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} points outside the repository root: ${target}`,
          });
          continue;
        }
        if (resolved.status === "ambiguous") {
          edges.push({
            from: { path: node.path, id: node.id },
            relation: field,
            target,
            to: null,
            claim: null,
            resolution: "ambiguous",
            derived: false,
          });
          issues.push({
            code: "ambiguous-relation-target",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} target ${target} matches multiple documents: ${resolved.candidates.map((doc) => doc.path).join(", ")}`,
          });
          continue;
        }
        if (resolved.status === "resolved-file") {
          edges.push({
            from: { path: node.path, id: node.id },
            relation: field,
            target,
            to: { path: resolved.path, id: null },
            claim: null,
            resolution: "non-document",
            derived: false,
          });
          issues.push({
            code: "invalid-relation-target-type",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} target resolves to a non-document file, expected a durable document of type: ${targetTypes.join(", ")}: ${target}`,
          });
          continue;
        }
        if (resolved.status === "unresolved") {
          edges.push({
            from: { path: node.path, id: node.id },
            relation: field,
            target,
            to: null,
            claim: null,
            resolution: "unresolved",
            derived: false,
          });
          issues.push({
            code: "unresolved-relation-target",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} points to missing target: ${target}`,
          });
          continue;
        }
        const targetDoc = resolved.document;
        const targetNode = nodeByKey.get(artifactKeyOf(targetDoc.path));
        edges.push({
          from: { path: node.path, id: node.id },
          relation: field,
          target,
          to: targetNode
            ? { path: targetNode.path, id: targetNode.id }
            : { path: targetDoc.path, id: targetDoc.id },
          claim: null,
          resolution: "resolved",
          derived: false,
        });
        if (targetNode && targetNode.key === node.key) {
          issues.push({
            code: "self-relation",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} references the document itself: ${target}`,
          });
        }
        if (!targetDoc.type || !targetTypes.includes(targetDoc.type)) {
          issues.push({
            code: "invalid-relation-target-type",
            path: node.path,
            line: null,
            target,
            message: `Relation ${field} target resolves to type "${targetDoc.type ?? "unknown"}", expected one of: ${targetTypes.join(", ")}: ${target}`,
          });
        }
      }
    }
  }

  // Derived inverse projection: one derived edge per resolved stored edge,
  // named by the forward field's declared `inverse` — the claim qualifier
  // stays attached so claim-level collation is symmetric with the forward
  // direction.
  const derivedEdges: DerivedKnowledgeEdge[] = [];
  for (const edge of edges) {
    if (edge.resolution !== "resolved" || !edge.to) continue;
    const targetNode = nodeByKey.get(artifactKeyOf(edge.to.path));
    const inverse = INVERSES[edge.relation];
    if (!inverse || !targetNode) continue;
    derivedEdges.push({
      from: { path: targetNode.path, id: targetNode.id },
      relation: inverse,
      target: edge.from.id ?? edge.from.path,
      to: { path: edge.from.path, id: edge.from.id },
      claim: edge.claim,
      via: edge.relation,
      derived: true,
    });
  }

  for (const component of relationCycles(nodes, edges)) {
    const label = component.join(" -> ");
    for (const member of component) {
      const memberNode = nodeByKey.get(artifactKeyOf(member));
      if (!memberNode) continue;
      issues.push({
        code: "relation-cycle",
        path: memberNode.path,
        line: null,
        target: null,
        message: `Stored forward relations form a cycle: ${label}`,
      });
    }
  }

  edges.sort(edgeCompare);
  derivedEdges.sort(derivedEdgeCompare);
  issues.sort(issueCompare);

  return { nodes, edges, derivedEdges, issues };
}

async function scanKnowledgeGraph(options: ScanOptions): Promise<KnowledgeGraph> {
  const model = await scanRepository(options);
  return projectKnowledgeGraph(model);
}

export {
  CLAIM_KEY_PATTERN,
  CLAIM_MARKER_PATTERN,
  CLAIM_REFERENCE_PATTERN,
  claimId,
  extractClaimDeclarations,
  isClaimKey,
  knowledgeNeighbors,
  parseClaimReference,
  projectKnowledgeGraph,
  scanKnowledgeGraph,
};

export type {
  ClaimDeclaration,
  ClaimReference,
  DerivedKnowledgeEdge,
  KnowledgeClaim,
  KnowledgeEdge,
  KnowledgeEdgeEndpoint,
  KnowledgeGraph,
  KnowledgeGraphIssue,
  KnowledgeGraphIssueCode,
  KnowledgeNode,
};
