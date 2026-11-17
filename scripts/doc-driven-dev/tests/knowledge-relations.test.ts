import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

import { scanRepository } from "../src/skills/lib/doc_repository";
import {
  extractClaimDeclarations,
  isClaimKey,
  knowledgeNeighbors,
  parseClaimReference,
  projectKnowledgeGraph,
  scanKnowledgeGraph,
} from "../src/skills/lib/knowledge_graph";

// Knowledge Relations v1 + Claim IDs (Issue #235): these tests pin the
// projection contract — canonical forward edges only, derived inverses,
// claim grammar/markers, and the full issue vocabulary — against a real
// scanned repository, not a mock.

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-relations-test-"));
}

function writeDoc(repo: string, relative: string, frontMatter: Record<string, unknown>, body = "# Doc\n") {
  const full = path.join(repo, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, matter.stringify(body, frontMatter), "utf8");
}

function fm(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPEC-0001",
    type: "spec",
    status: "draft",
    title: "Doc",
    created: "2026-09-19",
    updated: "2026-09-19",
    owners: [],
    relations: {},
    ...overrides,
  };
}

function issueCodes(graph: { issues: { code: string }[] }): string[] {
  return graph.issues.map((issue) => issue.code);
}

// --- Claim grammar -----------------------------------------------------------

test("claim grammar: keys, references, and markers parse per the v1 contract", () => {
  assert.equal(isClaimKey("R-01"), true);
  assert.equal(isClaimKey("AC-2"), true);
  assert.equal(isClaimKey("NFR-12"), true);
  assert.equal(isClaimKey("r-01"), false, "keys are uppercase");
  assert.equal(isClaimKey("R01"), false, "the dash is required");
  assert.equal(isClaimKey("SPEC-0001::R-01"), false, "a qualified ref is not a bare key");

  assert.deepEqual(parseClaimReference("SPEC-0001::R-01"), { docId: "SPEC-0001", key: "R-01" });
  assert.deepEqual(parseClaimReference("VD-9f8eX::AC-12"), { docId: "VD-9f8eX", key: "AC-12" });
  assert.equal(parseClaimReference("SPEC-0001"), null);
  assert.equal(parseClaimReference("docs/specs/a.md"), null);
  assert.equal(parseClaimReference("SPEC-0001::r-01"), null);
});

// --- Forward edges + derived inverses ----------------------------------------

test("v1 forward relations resolve; inverses are derived, never stored", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/discovery/0001-d.md", fm({
    id: "DISC-0001", type: "discovery", title: "Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001"] },
  }));
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }));
  writeDoc(repo, "docs/adr/0001-a.md", fm({
    id: "ADR-0001", type: "adr", title: "ADR", status: "accepted",
    relations: { "decides-for": ["DESIGN-0001"] },
  }));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.deepEqual(issueCodes(graph), []);

  const forward = graph.edges.map((edge) => `${edge.from.id} -${edge.relation}-> ${edge.to?.id}`);
  assert.deepEqual(forward, [
    "ADR-0001 -decides-for-> DESIGN-0001",
    "DESIGN-0001 -realizes-> SPEC-0001",
    "DISC-0001 -informs-> ADR-0001",
    "DISC-0001 -motivates-> SPEC-0001",
  ]);
  assert.ok(graph.edges.every((edge) => edge.resolution === "resolved" && !edge.derived));

  const inverse = graph.derivedEdges.map((edge) => `${edge.from.id} -${edge.relation}-> ${edge.to.id} (via ${edge.via})`);
  assert.deepEqual(inverse, [
    "ADR-0001 -informed-by-> DISC-0001 (via informs)",
    "DESIGN-0001 -decided-by-> ADR-0001 (via decides-for)",
    "SPEC-0001 -motivated-by-> DISC-0001 (via motivates)",
    "SPEC-0001 -realized-by-> DESIGN-0001 (via realizes)",
  ]);
  assert.ok(graph.derivedEdges.every((edge) => edge.derived));
});

test("a stored inverse-name key is a legacy finding, never an edge", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-a.md", fm({ id: "SPEC-0001", status: "superseded" }));
  writeDoc(repo, "docs/specs/0002-b.md", fm({
    id: "SPEC-0002", title: "New spec",
    relations: { supersedes: ["SPEC-0001"], "superseded-by": ["SPEC-0003"] },
  }));
  writeDoc(repo, "docs/specs/0003-c.md", fm({ id: "SPEC-0003", title: "Other" }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  // Only the stored forward `supersedes` projects an edge; the stored
  // `superseded-by` key is migration-domain input, not graph data.
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, "supersedes");
  const legacy = graph.issues.filter((issue) => issue.code === "legacy-relation-field");
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].target, "superseded-by");
  assert.equal(graph.derivedEdges.length, 1);
  assert.equal(graph.derivedEdges[0].relation, "superseded-by");
  assert.equal(graph.derivedEdges[0].from.id, "SPEC-0001");
});

test("pre-v3 vocabulary produces legacy-relation-field and no edges", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({
    relations: {
      implements: ["docs/plans/0001-p.md"],
      "derives-from": ["DISC-0001"],
      related: ["ADR-0001"],
      references: ["docs/specs/0002-b.md"],
    },
  }));
  writeDoc(repo, "docs/specs/0002-b.md", fm({ id: "SPEC-0002" }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.equal(graph.edges.length, 0, "legacy keys never resolve into edges");
  assert.equal(graph.derivedEdges.length, 0);
  const fields = graph.issues
    .filter((issue) => issue.code === "legacy-relation-field")
    .map((issue) => issue.target);
  assert.deepEqual(fields.sort(), ["derives-from", "implements", "references", "related"]);
});

test("a v1 field on the wrong source type is invalid-relation-field", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({
    // `motivates` is canonical v1 vocabulary but is not declared for spec —
    // the field is a manual-repair finding, distinct from legacy keys.
    relations: { motivates: ["SPEC-0002"] },
  }));
  writeDoc(repo, "docs/specs/0002-b.md", fm({ id: "SPEC-0002" }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const invalid = graph.issues.filter((issue) => issue.code === "invalid-relation-field");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].target, "motivates");
  assert.equal(graph.edges.length, 0);
});

test("invalid target types are flagged while valid ones pass", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }));
  // verification.supersedes may only target verification — a spec target is
  // a typed-matrix violation even though the field is declared.
  writeDoc(repo, "docs/verification/0001-v.md", fm({
    id: "VD-0001", type: "verification", title: "Verification",
    relations: { supersedes: ["SPEC-0001", "VD-0002"] },
  }));
  writeDoc(repo, "docs/verification/0002-v.md", fm({
    id: "VD-0002", type: "verification", title: "Old verification", status: "superseded",
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const badTarget = graph.issues.filter((issue) => issue.code === "invalid-relation-target-type");
  assert.equal(badTarget.length, 1);
  assert.equal(badTarget[0].target, "SPEC-0001");
  assert.ok(badTarget[0].message.includes("verification"));
  assert.equal(graph.edges.filter((edge) => edge.resolution === "resolved").length, 2,
    "both edges resolve at the document level — type violation is an issue, not a refusal");
});

// --- Claim declarations and claim-qualified targets --------------------------

test("claim markers bind stable ids; a claim-qualified relation resolves to the claim", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }), [
    "# Spec",
    "",
    "## Requirements",
    "",
    "- <!-- claim:R-01 --> The system MUST total the cart.",
    "- <!-- claim:SPEC-0001::R-02 --> The system SHOULD apply discounts.",
    "",
    "```",
    "<!-- claim:R-03 --> fenced examples are not claims",
    "```",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001::R-01"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.deepEqual(issueCodes(graph), []);

  const spec = graph.nodes.find((node) => node.id === "SPEC-0001");
  assert.ok(spec);
  assert.deepEqual(spec.claims.map((claim) => claim.id), ["SPEC-0001::R-01", "SPEC-0001::R-02"]);

  const edge = graph.edges.find((candidate) => candidate.relation === "realizes");
  assert.ok(edge);
  assert.equal(edge.claim, "SPEC-0001::R-01");
  assert.equal(edge.to?.id, "SPEC-0001");
  assert.equal(edge.resolution, "resolved");
  // The claim qualifier stays attached to the derived inverse so claim-level
  // collation is symmetric in both directions.
  const inverse = graph.derivedEdges.find((candidate) => candidate.via === "realizes");
  assert.equal(inverse?.claim, "SPEC-0001::R-01");
});

test("claim issue codes: invalid marker, duplicate key, no doc id, moved claim", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm(), [
    "# Spec",
    "",
    "- <!-- claim:R-01 --> first",
    "- <!-- claim:R-01 --> duplicate key",
    "- <!-- claim:not a key --> invalid marker",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/specs/0002-noid.md", fm({ id: null }), [
    "# No id",
    "",
    "- <!-- claim:R-01 --> unaddressable",
    "",
  ].join("\n"));
  // A claim moved across documents without re-keying — the qualified marker
  // still names the former owner.
  writeDoc(repo, "docs/designs/0001-g.md", fm({ id: "DESIGN-0001", type: "design", title: "Design" }), [
    "# Design",
    "",
    "- <!-- claim:SPEC-0001::R-09 --> moved claim kept its old id",
    "",
  ].join("\n"));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const codes = issueCodes(graph);
  assert.equal(codes.filter((code) => code === "duplicate-claim").length, 1);
  assert.equal(codes.filter((code) => code === "invalid-claim-id").length, 1);
  assert.equal(codes.filter((code) => code === "claim-without-doc-id").length, 1);
  assert.equal(codes.filter((code) => code === "claim-doc-mismatch").length, 1);
  const moved = graph.issues.find((issue) => issue.code === "claim-doc-mismatch");
  assert.equal(moved?.target, "SPEC-0001::R-09");
});

test("unresolved and ambiguous claim targets are reported distinctly", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }), [
    "# Spec",
    "",
    "- <!-- claim:R-01 --> live claim",
    "",
  ].join("\n"));
  // A claim deleted in an edit — the stored reference now dangles.
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001::R-99", "DISC-0001::F-01"] },
  }));
  writeDoc(repo, "docs/discovery/0001-a.md", fm({ id: "DISC-0001", type: "discovery", title: "A" }));
  writeDoc(repo, "docs/discovery/0002-b.md", fm({ id: "DISC-0001", type: "discovery", title: "B (dup id)" }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const unresolvedClaim = graph.issues.filter((issue) => issue.code === "unresolved-claim-target");
  assert.equal(unresolvedClaim.length, 1);
  assert.equal(unresolvedClaim[0].target, "SPEC-0001::R-99");
  const ambiguous = graph.issues.filter((issue) => issue.code === "ambiguous-relation-target");
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].target, "DISC-0001::F-01");
});

test("a claim reference to a missing document is an unresolved relation target", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-9999::R-01"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const unresolved = graph.issues.filter((issue) => issue.code === "unresolved-relation-target");
  assert.equal(unresolved.length, 1);
  assert.ok(unresolved[0].message.includes("SPEC-9999"));
});

// --- Relation pathologies -----------------------------------------------------

test("self-relation, escaped paths, and unresolved targets are distinct issues", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({
    relations: { supersedes: ["docs/specs/0001-s.md", "../../outside.md", "SPEC-4242"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const codes = issueCodes(graph);
  assert.ok(codes.includes("self-relation"));
  assert.ok(codes.includes("relation-escapes-root"));
  assert.ok(codes.includes("unresolved-relation-target"));
});

test("stored supersedes cycles surface relation-cycle on every member", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-a.md", fm({ id: "SPEC-0001", relations: { supersedes: ["SPEC-0002"] } }));
  writeDoc(repo, "docs/specs/0002-b.md", fm({ id: "SPEC-0002", relations: { supersedes: ["SPEC-0003"] } }));
  writeDoc(repo, "docs/specs/0003-c.md", fm({ id: "SPEC-0003", relations: { supersedes: ["SPEC-0001"] } }));
  writeDoc(repo, "docs/specs/0004-d.md", fm({ id: "SPEC-0004" }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const cycles = graph.issues.filter((issue) => issue.code === "relation-cycle");
  assert.equal(cycles.length, 3, "one issue per cycle member");
  assert.deepEqual(cycles.map((issue) => issue.path).sort(), [
    "docs/specs/0001-a.md",
    "docs/specs/0002-b.md",
    "docs/specs/0003-c.md",
  ]);
  assert.ok(cycles.every((issue) => issue.message.includes("->")));
});

test("an id collision makes an id-typed relation target ambiguous", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-a.md", fm({ id: "SPEC-0001" }));
  writeDoc(repo, "docs/specs/0002-b.md", fm({ id: "SPEC-0001", title: "Collision" }));
  writeDoc(repo, "docs/specs/0003-c.md", fm({
    id: "SPEC-0003", relations: { supersedes: ["SPEC-0001"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const ambiguous = graph.issues.filter((issue) => issue.code === "ambiguous-relation-target");
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].target, "SPEC-0001");
  assert.equal(ambiguous[0].path, "docs/specs/0003-c.md");
});

// --- Focus neighborhood and determinism ---------------------------------------

test("knowledgeNeighbors returns the focus neighborhood: outbound + derived inbound", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/discovery/0001-d.md", fm({
    id: "DISC-0001", type: "discovery", title: "Discovery",
    relations: { motivates: ["SPEC-0001"] },
  }));
  writeDoc(repo, "docs/specs/0001-s.md", fm({
    id: "SPEC-0001", status: "approved",
    relations: { supersedes: ["SPEC-0000"] },
  }));
  writeDoc(repo, "docs/specs/0000-old.md", fm({ id: "SPEC-0000", title: "Old", status: "superseded" }));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const neighborhood = knowledgeNeighbors(graph, "SPEC-0001");
  assert.deepEqual(
    neighborhood.outbound.map((edge) => `${edge.relation}->${edge.to?.id}`),
    ["supersedes->SPEC-0000"],
  );
  assert.deepEqual(
    neighborhood.inbound.map((edge) => `${edge.relation}<-${edge.to.id}`).sort(),
    ["motivated-by<-DISC-0001", "realized-by<-DESIGN-0001"],
  );
  // Lookup by primary path resolves the same node.
  assert.deepEqual(knowledgeNeighbors(graph, "docs/specs/0001-s.md"), neighborhood);
  assert.deepEqual(knowledgeNeighbors(graph, "SPEC-9999"), { outbound: [], inbound: [] });
});

test("the projection is deterministic and blind to execution-bound artifacts", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001"] },
  }));
  // Execution-bound and legacy artifacts sit outside the node set — their
  // counts and ordering may never perturb the Knowledge Graph (#236/#240).
  writeDoc(repo, "docs/plans/0001-p.md", fm({
    id: "PLAN-0001", type: "plan", title: "Plan", status: "approved",
    relations: { implements: ["SPEC-0001"], "verified-by": ["TSPEC-0001"] },
  }));
  writeDoc(repo, "docs/tasks/0001-t.md", fm({
    id: "TASK-0001", type: "task", title: "Task", status: "todo",
    relations: { implements: ["PLAN-0001"], "depends-on": ["TASK-0002"] },
  }));
  writeDoc(repo, "docs/tasks/0002-t.md", fm({
    id: "TASK-0002", type: "task", title: "Task 2", status: "done",
  }));
  writeDoc(repo, "docs/test-specs/0001-ts.md", fm({
    id: "TSPEC-0001", type: "test-spec", title: "TS", status: "approved",
    relations: { verifies: ["SPEC-0001"] },
  }));

  const model = await scanRepository({ cwd: repo });
  const first = projectKnowledgeGraph(model);
  const second = projectKnowledgeGraph(await scanRepository({ cwd: repo }));
  assert.deepEqual(second, first, "same corpus, byte-identical projection");

  assert.deepEqual(first.nodes.map((node) => node.id).sort(), ["DESIGN-0001", "SPEC-0001"]);
  assert.equal(first.edges.length, 1);
  assert.equal(first.edges[0].relation, "realizes");
  // Legacy docs' populated keys are migration-input findings — attributed to
  // the legacy file, never resolved into graph edges.
  assert.equal(
    first.issues.every((issue) => issue.code === "legacy-relation-field"),
    true,
  );
  const legacyFiles = new Set(first.issues.map((issue) => issue.path));
  assert.deepEqual([...legacyFiles].sort(), [
    "docs/plans/0001-p.md",
    "docs/tasks/0001-t.md",
    "docs/test-specs/0001-ts.md",
  ]);
});

test("locale siblings share one node and may mirror a claim key once", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm(), [
    "# Spec",
    "",
    "- <!-- claim:R-01 --> requirement",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/specs/0001-s.ja.md", fm(), [
    "# Spec (ja)",
    "",
    "- <!-- claim:R-01 --> 要件",
    "",
  ].join("\n"));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.deepEqual(issueCodes(graph), [], "mirrored keys across siblings are one logical claim");
  const spec = graph.nodes.find((node) => node.id === "SPEC-0001");
  assert.ok(spec);
  assert.deepEqual(spec.paths.sort(), ["docs/specs/0001-s.ja.md", "docs/specs/0001-s.md"]);
  assert.equal(spec.claims.length, 2, "both sibling declarations are collated");
  assert.ok(spec.claims.every((claim) => claim.id === "SPEC-0001::R-01"));
});

// --- Shared-boundary claim resolution -----------------------------------------
//
// `SPEC-0001::R-01` matched the URI-scheme regex (`SPEC-0001:`) before claim
// grammar ran, so repository/graph boundaries classified valid claim
// references as external — silently dropping them from relation resolution,
// orphan accounting, and stale-upstream detection. The shared predicate and
// `resolveRelationTarget` parse claim grammar first (Issue #235).

test("resolveRelationTarget treats a claim reference as local, never external", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm({ status: "approved" }), [
    "# Spec",
    "",
    "- <!-- claim:R-01 --> the requirement",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design",
    relations: { realizes: ["SPEC-0001::R-01", "SPEC-9999::R-99"] },
  }));

  const model = await scanRepository({ cwd: repo });
  const design = model.files.find((doc) => doc.id === "DESIGN-0001");
  assert.ok(design);

  const hit = model.resolveRelationTarget(design, "SPEC-0001::R-01");
  assert.equal(hit.status, "resolved");
  assert.equal(hit.status === "resolved" ? hit.document.path : null, "docs/specs/0001-s.md");

  const miss = model.resolveRelationTarget(design, "SPEC-9999::R-99");
  assert.equal(miss.status, "unresolved", "a missing claim document stays diagnosed, not silently external");

  // True external references still classify as external.
  assert.equal(model.resolveRelationTarget(design, "https://example.com/x").status, "external");
});

test("claim markers inside indented code blocks are not adopted", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-s.md", fm(), [
    "# Spec",
    "",
    "    <!-- claim:R-02 --> an indented code example, not a claim",
    "",
    "- <!-- claim:R-01 --> a real claim",
    "",
    "intro text",
    "    <!-- claim:R-03 --> a lazy paragraph continuation is still a claim",
    "",
    "- item",
    "    <!-- claim:R-04 --> paragraph content inside the list item",
    "",
    "      <!-- claim:R-05 --> indented code inside the list item",
    "",
  ].join("\n"));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  assert.deepEqual(issueCodes(graph), []);
  const spec = graph.nodes.find((node) => node.id === "SPEC-0001");
  assert.deepEqual(
    spec?.claims.map((claim) => claim.key),
    ["R-01", "R-03", "R-04"],
    "4+ spaces of code indentation hides a marker; list-item and lazy-paragraph content does not",
  );
});

test("a claim-qualified target with no type hits invalid-relation-target-type like a path target", async () => {
  const repo = tempRepo();
  const typeLess = fm({ status: "approved" });
  delete (typeLess as Record<string, unknown>).type;
  writeDoc(repo, "docs/specs/0001-s.md", typeLess, [
    "# Spec",
    "",
    "- <!-- claim:R-01 --> requirement",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/designs/0001-g.md", fm({
    id: "DESIGN-0001", type: "design", title: "Design", status: "approved",
    relations: { realizes: ["SPEC-0001::R-01"] },
  }));

  const graph = await scanKnowledgeGraph({ cwd: repo });
  const badType = graph.issues.filter((issue) => issue.code === "invalid-relation-target-type");
  assert.equal(badType.length, 1);
  assert.equal(badType[0].target, "SPEC-0001::R-01");
  assert.ok(badType[0].message.includes("unknown"));
});
