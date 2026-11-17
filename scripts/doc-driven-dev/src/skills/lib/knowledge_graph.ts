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
import { CLAIM_KEY_PATTERN, CLAIM_MARKER_PATTERN, CLAIM_REFERENCE_PATTERN, claimId, isClaimKey, parseClaimReference } from "./claim_ids";
import type { ClaimReference } from "./claim_ids";
import { CHECK_KEY_PATTERN, CHECK_MARKER_PATTERN, checkDesignRevision, parseVerificationChecks } from "./verification_checks";
import type { VerificationCheckIssueCode, VerificationCheckV1 } from "./verification_checks";

// ---------------------------------------------------------------------------
// Claim declarations
// ---------------------------------------------------------------------------

// Fenced code regions (``` / ~~~) and indented code regions (4+ spaces past
// the innermost list item's content) are stripped before marker scanning so
// a marker shown as an example inside a code block is not adopted as a real
// claim.
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

// A Markdown list marker — bullet or ordered — opening a new item.
const LIST_ITEM_PATTERN = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/;

// A non-paragraph block opener (heading, blockquote, thematic break, table
// row): a line starting such a block ends the running paragraph, so the next
// indented line cannot be a lazy paragraph continuation and may be code.
// Tested against the trimmed line — indentation was already classified.
const BLOCK_OPENER_PATTERN = /^(?:#{1,6}(?:[ \t]|$)|>|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$|\|)/;

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

// Strip fenced and indented code blocks, preserving line count/positions, so
// a marker shown as an example inside a code block is not adopted as a real
// claim. Indented-code detection follows the two CommonMark rules that matter
// here: a code line needs 4+ spaces of indentation beyond the innermost
// enclosing list item's content column (not 4 from the margin), and an
// indented line can never interrupt a running paragraph — it stays lazy
// paragraph text, so `para\n    <!-- claim:X -->` still declares the claim.
function unfencedBody(body: string): string {
  const lines = body.split("\n");
  let fenceChar: string | null = null;
  // Content column of each open list item.
  const listContentIndents: number[] = [];
  let paragraphOpen = false;
  return lines.map((line) => {
    const fence = FENCE_PATTERN.exec(line.trimStart());
    if (fenceChar !== null) {
      if (fence && fence[1][0] === fenceChar) fenceChar = null;
      return "";
    }
    if (fence) {
      fenceChar = fence[1][0];
      paragraphOpen = false;
      return "";
    }
    if (!line.trim()) {
      paragraphOpen = false;
      return line;
    }
    const indent = (/^[ \t]*/.exec(line) as RegExpExecArray)[0].replace(/\t/g, "    ").length;
    const item = LIST_ITEM_PATTERN.exec(line);
    // A dedenting line closes list levels it falls out of; a lazy paragraph
    // continuation (running paragraph, non-marker line) stays inside its
    // list item regardless of indent.
    if (!paragraphOpen || item) {
      while (listContentIndents.length > 0 && listContentIndents[listContentIndents.length - 1] > indent) {
        listContentIndents.pop();
      }
    }
    const codeIndent = (listContentIndents[listContentIndents.length - 1] ?? 0) + 4;
    if (indent >= codeIndent) {
      return paragraphOpen ? line : "";
    }
    if (item) {
      // Content column = indent + marker width + following gap; CommonMark
      // caps a >4-space gap at a single space.
      const marker = item[0].replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
      const gap = item[0].length - indent - marker.length;
      listContentIndents.push(gap > 4 ? indent + marker.length + 1 : item[0].length);
    }
    paragraphOpen = !BLOCK_OPENER_PATTERN.test(line.trimStart());
    return line;
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
// Verification Check declarations (Issue #239)
// ---------------------------------------------------------------------------

// A `<!-- check:... -->` body marker inside a verification document — the
// prose anchor for one front-matter check, mirroring `<!-- claim:... -->`.
type CheckAnchor = {
  // Bare check key (`CHK-01`), or the key part of a qualified anchor.
  key: string | null;
  // Document id a qualified anchor names; null for the bare form.
  declaredDocId: string | null;
  // Marker content when it was neither CHK-NN nor DOC::CHK-NN.
  invalid: string | null;
  path: string;
  line: number;
};

// One validated check as the graph sees it — the node-level read model for
// `checks[]` entries. `designRevision` is the content digest Evidence
// Records (#240) pin so outcomes measured against a since-edited check are
// detectable; outcomes themselves never appear here.
type KnowledgeCheck = {
  // Document-local stable key (`CHK-01`).
  id: string;
  // Fully qualified check reference (`VD-<id>::CHK-01`); null when the
  // owning document declares no front-matter id.
  qualifiedId: string | null;
  // The stored Check→Claim authority — `<document-id>::<KEY>`.
  target: string;
  method: string;
  required: boolean;
  designRevision: string;
};

// The projected Check→Claim edge — derived from `checks[].target`, never
// stored in `relations`. Only emitted for structurally valid checks;
// `resolution` carries the claim-target resolution state, and `to` the
// claim-owning document when it resolves.
type KnowledgeCheckEdge = {
  from: KnowledgeEdgeEndpoint;
  // Fully qualified check id (`VD-<id>::CHK-01`), or the local key when
  // the design document has no front-matter id.
  check: string;
  // The claim reference exactly as declared in the check.
  target: string;
  to: KnowledgeEdgeEndpoint | null;
  method: string;
  required: boolean;
  resolution: "resolved" | "unresolved" | "ambiguous";
};

function extractCheckAnchors(document: RepositoryDocument): CheckAnchor[] {
  const anchors: CheckAnchor[] = [];
  const body = unfencedBody(document.body);
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = document.bodyStartLine + index + 1;
    for (const match of line.matchAll(CHECK_MARKER_PATTERN)) {
      const raw = match[1].trim();
      const parsed = parseClaimReference(raw);
      // Both forms must carry a check key: `CHK-NN` bare, or
      // `DOC-ID::CHK-NN` qualified. `DOC::R-01` is a claim reference, not
      // a check anchor — marker content that misses the check grammar is
      // invalid, not reinterpreted.
      const qualified = parsed && CHECK_KEY_PATTERN.test(parsed.key) ? parsed : null;
      const bare = !qualified && CHECK_KEY_PATTERN.test(raw) ? raw : null;
      anchors.push({
        key: qualified?.key ?? bare,
        declaredDocId: qualified?.docId ?? null,
        invalid: (qualified === null && bare === null) ? raw : null,
        path: document.path,
        line: lineNo,
      });
    }
  }
  return anchors;
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
  // Validated Verification Design checks — populated only on
  // `type: verification` nodes, from the front-matter `checks:` authority.
  checks: KnowledgeCheck[];
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
  | "relation-cycle"
  // Verification Check contract — document-local codes come from
  // verification_checks.ts verbatim; resolution and anchor codes are
  // emitted by this projection.
  | VerificationCheckIssueCode
  | "unresolved-check-target"
  | "ambiguous-check-target"
  | "invalid-check-anchor"
  | "unresolved-check-anchor"
  | "duplicate-check-anchor"
  | "check-anchor-mismatch"
  | "misplaced-check-anchor"
  | "misplaced-checks";

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
  // Derived Check→Claim projection — the graph form of every valid
  // `checks[].target` (#239). Never stored; `relations.checks` is not a
  // field anywhere.
  checkEdges: KnowledgeCheckEdge[];
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

// The Check reference resolution boundary — the surface Execution-Store
// task `checks` entries (#237) and Evidence Records (#240) resolve
// through. `ref` is a qualified check reference `VD-<id>::CHK-NN` in the
// shared `<document-id>::<KEY>` grammar; anything else — a bare key, a
// claim key, a legacy `TSPEC-…::…` reference, a test-spec path — fails
// closed as `invalid` or `unresolved-document` and never resolves to a
// check by accident.
type CheckResolution =
  | { status: "resolved"; node: KnowledgeNode; check: KnowledgeCheck }
  | { status: "invalid" }
  | { status: "unresolved-document" }
  | { status: "not-verification"; node: KnowledgeNode }
  | { status: "unresolved-check"; node: KnowledgeNode };

function resolveCheckReference(graph: KnowledgeGraph, ref: string): CheckResolution {
  const parsed = parseClaimReference(ref.trim());
  if (!parsed || !CHECK_KEY_PATTERN.test(parsed.key)) return { status: "invalid" };
  const node = graph.nodes.find((candidate) => candidate.id === parsed.docId);
  if (!node) return { status: "unresolved-document" };
  if (node.type !== "verification") return { status: "not-verification", node };
  const check = node.checks.find((candidate) => candidate.id === parsed.key);
  if (!check) return { status: "unresolved-check", node };
  return { status: "resolved", node, check };
}

// The Claim reference resolution boundary for writers — `new_verification`
// and `update_verification` validate `checks[].target` through this so a
// check is never minted against an unknown Claim ID. `ref` is any
// `DOC::KEY` claim reference; the graph's own projection uses the same
// rule via lookupById + the claim index.
type ClaimResolution =
  | { status: "resolved"; node: KnowledgeNode; claim: KnowledgeClaim }
  | { status: "invalid" }
  | { status: "ambiguous" }
  | { status: "unresolved-document" }
  | { status: "unresolved-claim"; node: KnowledgeNode };

function resolveClaimReference(graph: KnowledgeGraph, ref: string): ClaimResolution {
  const parsed = parseClaimReference(ref.trim());
  if (!parsed) return { status: "invalid" };
  const matches = graph.nodes.filter((candidate) => candidate.id === parsed.docId);
  if (matches.length === 0) return { status: "unresolved-document" };
  if (matches.length > 1) return { status: "ambiguous" };
  const node = matches[0];
  const claim = node.claims.find((candidate) => candidate.key === parsed.key);
  if (!claim) return { status: "unresolved-claim", node };
  return { status: "resolved", node, claim };
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

    // Verification Check extraction (Issue #239): the `checks:`
    // front-matter array is the sole Check→Claim authority. It is parsed
    // per member file so a locale sibling's drift surfaces, and deduped
    // by check id across the artifact group — a mirrored definition is
    // one logical check, a conflicting one is `duplicate-check`.
    const isVerification = primary.type === "verification";
    const nodeChecks: KnowledgeCheck[] = [];
    const declaredChecks = new Map<string, { path: string; revision: string }>();
    const checkAnchors: CheckAnchor[] = [];
    for (const document of group) {
      if (isVerification) {
        const parsed = parseVerificationChecks(document.frontMatter.checks);
        for (const issue of parsed.issues) {
          issues.push({ code: issue.code, path: document.path, line: null, target: issue.target, message: issue.message });
        }
        for (const check of parsed.checks) {
          const revision = checkDesignRevision(check);
          const first = declaredChecks.get(check.id);
          if (first) {
            if (first.revision !== revision) {
              issues.push({
                code: "duplicate-check",
                path: document.path,
                line: null,
                target: check.id,
                message: `Check id ${check.id} is declared with a different definition in ${document.path} than in ${first.path} — locale siblings mirror one logical check`,
              });
            }
            continue;
          }
          declaredChecks.set(check.id, { path: document.path, revision });
          nodeChecks.push({
            id: check.id,
            qualifiedId: primary.id ? claimId(primary.id, check.id) : null,
            target: check.target,
            method: check.method,
            required: check.required,
            designRevision: revision,
          });
        }
      } else if (document.frontMatter.checks !== undefined) {
        issues.push({
          code: "misplaced-checks",
          path: document.path,
          line: null,
          target: "checks",
          message: `checks: is the Verification Design contract — a ${primary.type ?? "untyped"} document does not declare checks`,
        });
      }
      checkAnchors.push(...extractCheckAnchors(document));
    }

    // Body `<!-- check:... -->` anchors bind a check's identity to its
    // prose position — validated against the front-matter declarations,
    // never an independent source of check ids.
    const seenAnchors = new Map<string, number>();
    for (const anchor of checkAnchors) {
      if (anchor.invalid !== null) {
        issues.push({
          code: "invalid-check-anchor",
          path: anchor.path,
          line: anchor.line,
          target: anchor.invalid,
          message: `Check marker does not declare a check key or DOC::CHK-NN reference: <!-- check:${anchor.invalid} -->`,
        });
        continue;
      }
      if (!isVerification) {
        issues.push({
          code: "misplaced-check-anchor",
          path: anchor.path,
          line: anchor.line,
          target: anchor.declaredDocId ? `${anchor.declaredDocId}::${anchor.key}` : anchor.key,
          message: `Check anchor <!-- check:${anchor.declaredDocId ? `${anchor.declaredDocId}::` : ""}${anchor.key} --> sits outside a verification document — check markers only bind inside Verification Designs`,
        });
        continue;
      }
      if (primary.id !== null && anchor.declaredDocId !== null && anchor.declaredDocId !== primary.id) {
        issues.push({
          code: "check-anchor-mismatch",
          path: anchor.path,
          line: anchor.line,
          target: `${anchor.declaredDocId}::${anchor.key}`,
          message: `Check anchor ${anchor.declaredDocId}::${anchor.key} is declared inside ${primary.id} — a qualified check anchor names its own document`,
        });
        continue;
      }
      const anchorKey = anchor.key as string;
      if (!declaredChecks.has(anchorKey)) {
        issues.push({
          code: "unresolved-check-anchor",
          path: anchor.path,
          line: anchor.line,
          target: anchorKey,
          message: `Check anchor ${anchorKey} names a check the front matter of ${primary.path} does not declare`,
        });
        continue;
      }
      const anchorSeenKey = `${anchor.path} ${anchorKey}`;
      const firstAnchor = seenAnchors.get(anchorSeenKey);
      if (firstAnchor !== undefined) {
        issues.push({
          code: "duplicate-check-anchor",
          path: anchor.path,
          line: anchor.line,
          target: anchorKey,
          message: `Check anchor ${anchorKey} is bound more than once in ${anchor.path} (first at line ${firstAnchor})`,
        });
        continue;
      }
      seenAnchors.set(anchorSeenKey, anchor.line);
    }

    const node: KnowledgeNode = {
      key,
      path: primary.path,
      id: primary.id,
      type: primary.type ?? "",
      paths: group.map((document) => document.path).sort(compareStrings),
      claims: nodeClaims.sort((a, b) => compareStrings(a.key, b.key) || a.line - b.line),
      checks: nodeChecks.sort((a, b) => compareStrings(a.id, b.id)),
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

  // Check→Claim projection (Issue #239): every structurally valid check's
  // `target` resolves through the same document-id + claim-index boundary
  // relation targets use. The projection is the only place `checks` /
  // `checked-by` relations exist — they are derived from `checks[].target`
  // and are never stored in `relations`. The claim-level edges project
  // only when the named claim actually exists in the target document;
  // document-level checkEdges still record the resolution state so a
  // missing claim is a finding, not a silent drop.
  const checkEdges: KnowledgeCheckEdge[] = [];
  for (const node of nodes) {
    for (const check of node.checks) {
      // parseVerificationChecks guarantees the target is DOC::KEY.
      const claimRef = parseClaimReference(check.target) as ClaimReference;
      const qualifiedCheckId = check.qualifiedId ?? check.id;
      const lookup = model.lookupById(claimRef.docId);
      if (lookup.status === "ambiguous") {
        checkEdges.push({
          from: { path: node.path, id: node.id },
          check: qualifiedCheckId,
          target: check.target,
          to: null,
          method: check.method,
          required: check.required,
          resolution: "ambiguous",
        });
        issues.push({
          code: "ambiguous-check-target",
          path: node.path,
          line: null,
          target: check.target,
          message: `Check ${check.id} target ${check.target} matches multiple documents: ${lookup.candidates.map((doc) => doc.path).join(", ")}`,
        });
        continue;
      }
      if (lookup.status === "none") {
        checkEdges.push({
          from: { path: node.path, id: node.id },
          check: qualifiedCheckId,
          target: check.target,
          to: null,
          method: check.method,
          required: check.required,
          resolution: "unresolved",
        });
        issues.push({
          code: "unresolved-check-target",
          path: node.path,
          line: null,
          target: check.target,
          message: `Check ${check.id} targets claim ${check.target}, but no document declares id ${claimRef.docId} — unknown Claim ID`,
        });
        continue;
      }
      const targetDoc = lookup.document;
      const targetKey = artifactKeyOf(targetDoc.path);
      const targetNode = nodeByKey.get(targetKey);
      const to: KnowledgeEdgeEndpoint = targetNode
        ? { path: targetNode.path, id: targetNode.id }
        : { path: targetDoc.path, id: targetDoc.id };
      checkEdges.push({
        from: { path: node.path, id: node.id },
        check: qualifiedCheckId,
        target: check.target,
        to,
        method: check.method,
        required: check.required,
        resolution: "resolved",
      });
      const targetClaims = claimsByKey.get(targetKey);
      if (!targetClaims || !targetClaims.has(claimRef.key)) {
        issues.push({
          code: "unresolved-check-target",
          path: node.path,
          line: null,
          target: check.target,
          message: `Check ${check.id} targets claim ${check.target}, but ${targetDoc.path} declares no claim ${claimRef.key} — unknown Claim ID`,
        });
        continue;
      }
      derivedEdges.push({
        from: { path: node.path, id: node.id },
        relation: "checks",
        target: check.target,
        to,
        claim: check.target,
        via: "checks[].target",
        derived: true,
      });
      derivedEdges.push({
        from: { path: to.path, id: to.id },
        relation: "checked-by",
        target: qualifiedCheckId,
        to: { path: node.path, id: node.id },
        claim: check.target,
        via: "checks[].target",
        derived: true,
      });
    }
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
  checkEdges.sort((left, right) => compareStrings(left.from.path, right.from.path) || compareStrings(left.check, right.check));
  issues.sort(issueCompare);

  return { nodes, edges, derivedEdges, checkEdges, issues };
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
  extractCheckAnchors,
  extractClaimDeclarations,
  isClaimKey,
  knowledgeNeighbors,
  parseClaimReference,
  projectKnowledgeGraph,
  resolveCheckReference,
  resolveClaimReference,
  scanKnowledgeGraph,
};

export type {
  CheckAnchor,
  CheckResolution,
  ClaimResolution,
  ClaimDeclaration,
  ClaimReference,
  DerivedKnowledgeEdge,
  KnowledgeCheck,
  KnowledgeCheckEdge,
  KnowledgeClaim,
  KnowledgeEdge,
  KnowledgeEdgeEndpoint,
  KnowledgeGraph,
  KnowledgeGraphIssue,
  KnowledgeGraphIssueCode,
  KnowledgeNode,
};
