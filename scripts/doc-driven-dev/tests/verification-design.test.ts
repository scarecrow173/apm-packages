import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanRepository } from "../src/skills/lib/doc_repository";
import {
  projectKnowledgeGraph,
  resolveCheckReference,
  resolveClaimReference,
  scanKnowledgeGraph,
} from "../src/skills/lib/knowledge_graph";
import { evaluateSchemaPreflight, schemaManifestText } from "../src/skills/lib/schema_preflight";
import {
  canonicalCheck,
  checkDesignRevision,
  METHOD_CRITERIA_FIELDS,
  nextCheckId,
  parseCheckInput,
  parseVerificationChecks,
  VERIFICATION_METHODS,
} from "../src/skills/lib/verification_checks";
import type { VerificationCheckV1 } from "../src/skills/lib/verification_checks";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verification-design-test-"));
}

function runScript(skill: string, name: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, skill, "scripts", name), ...args],
    {
      cwd: options.cwd || tempRepo(),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeDoc(repo: string, relPath: string, data: Record<string, unknown>, body: string): void {
  const full = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, matter.stringify(body, data), "utf8");
}

function frontMatter(type: string, id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type,
    status: "draft",
    lifecycle: "draft",
    title: `${type} ${id}`,
    created: "2026-01-01",
    updated: "2026-01-01",
    owners: [],
    relations: {},
    ...extra,
  };
}

function writeSpecWithClaims(repo: string, id: string, claims: string[], relPath = "docs/specs/spec.md"): void {
  const body = [
    `# Spec ${id}`,
    "",
    "## Requirements",
    "",
    ...claims.map((claim) => `- <!-- claim:${claim} --> requirement ${claim}`),
    "",
  ].join("\n");
  writeDoc(repo, relPath, frontMatter("spec", id), body);
}

function writeVerification(repo: string, id: string, checks: unknown[], relPath = "docs/verification/design.md", extra: Record<string, unknown> = {}): void {
  writeDoc(repo, relPath, frontMatter("verification", id, { checks, ...extra }), "# Design\n\n## Checks\n");
}

function checkPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target: "SPEC-AAA::R-01",
    method: "unit",
    implementation: "cart.test.ts::total_sums_lines",
    preconditions: ["cart has at least one line"],
    passCriteria: { kind: "unit", expect: "total equals the sum of line subtotals" },
    limitations: [],
    required: true,
    ...overrides,
  };
}

function checkFrontMatter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "CHK-01", ...checkPayload(overrides), ...overrides };
}

function readFrontMatter(repo: string, relPath: string): Record<string, unknown> {
  const parsed = matter(fs.readFileSync(path.join(repo, relPath), "utf8"));
  return parsed.data;
}

async function graphFor(repo: string) {
  return scanKnowledgeGraph({ cwd: repo });
}

// ---------------------------------------------------------------------------
// VerificationCheckV1 — the document-local schema
// ---------------------------------------------------------------------------

test("check schema accepts every declared method with its typed criterion", () => {
  for (const method of VERIFICATION_METHODS) {
    const field = METHOD_CRITERIA_FIELDS[method];
    const { checks, issues } = parseVerificationChecks([
      checkFrontMatter({ method, passCriteria: { kind: method, [field]: `criterion for ${method}` } }),
    ]);
    assert.deepEqual(issues, [], `method ${method} should validate`);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].method, method);
    assert.equal(checks[0].passCriteria.kind, method);
    assert.equal(checks[0].passCriteria[field], `criterion for ${method}`);
  }
});

test("check schema rejects malformed containers and entries", () => {
  const nonArray = parseVerificationChecks("not-a-list");
  assert.equal(nonArray.checks.length, 0);
  assert.deepEqual(nonArray.issues.map((issue) => issue.code), ["malformed-checks"]);

  const nonObject = parseVerificationChecks(["CHK-01"]);
  assert.equal(nonObject.checks.length, 0);
  assert.deepEqual(nonObject.issues.map((issue) => issue.code), ["malformed-check-entry"]);
});

test("check schema requires all eight fields", () => {
  const bare = parseVerificationChecks([{ id: "CHK-01" }]);
  assert.equal(bare.checks.length, 0);
  const missing = bare.issues.filter((issue) => issue.code === "missing-check-field")
    .map((issue) => issue.target)
    .sort();
  assert.deepEqual(missing, [
    "implementation",
    "limitations",
    "method",
    "passCriteria",
    "preconditions",
    "required",
    "target",
  ]);
});

test("check ids must match CHK-<digits> and be unique in the document", () => {
  const badIds = parseVerificationChecks([
    checkFrontMatter({ id: "CHECK-1" }),
    checkFrontMatter({ id: "chk-01" }),
  ]);
  assert.deepEqual(badIds.issues.map((issue) => issue.code), ["invalid-check-id", "invalid-check-id"]);

  const duplicates = parseVerificationChecks([
    checkFrontMatter({ id: "CHK-01" }),
    checkFrontMatter({ id: "CHK-02", target: "SPEC-AAA::R-02" }),
    checkFrontMatter({ id: "CHK-01", target: "SPEC-AAA::R-03" }),
  ]);
  assert.equal(duplicates.checks.length, 2);
  assert.deepEqual(
    duplicates.issues.map((issue) => issue.code),
    ["duplicate-check"],
  );
  assert.equal(duplicates.issues[0].target, "CHK-01");
});

test("check target must be a qualified claim reference", () => {
  for (const target of ["R-01", "SPEC-AAA", "../spec.md", "docs/specs/spec.md", "SPEC-AAA::not a claim", 42]) {
    const { issues } = parseVerificationChecks([checkFrontMatter({ target })]);
    assert.ok(
      issues.some((issue) => issue.code === "invalid-check-target" || issue.code === "missing-check-field"),
      `target ${JSON.stringify(target)} must fail`,
    );
  }
});

test("unknown methods are rejected, never coerced", () => {
  const { checks, issues } = parseVerificationChecks([checkFrontMatter({ method: "vibe" })]);
  assert.equal(checks.length, 0);
  assert.deepEqual(issues.map((issue) => issue.code), ["invalid-check-method"]);
});

test("passCriteria.kind must equal method — criteria never flatten across methods", () => {
  const { issues } = parseVerificationChecks([
    checkFrontMatter({ method: "unit", passCriteria: { kind: "formal-proof", theorem: "totality" } }),
  ]);
  assert.deepEqual(issues.map((issue) => issue.code), ["check-criteria-mismatch"]);

  const missingField = parseVerificationChecks([
    checkFrontMatter({ method: "property", passCriteria: { kind: "property" } }),
  ]);
  assert.deepEqual(missingField.issues.map((issue) => issue.code), ["check-criteria-mismatch"]);
  assert.equal(missingField.issues[0].target, "invariant");

  const wrongKind = parseVerificationChecks([
    checkFrontMatter({ method: "unit", passCriteria: { kind: "vibe", expect: "x" } }),
  ]);
  assert.deepEqual(wrongKind.issues.map((issue) => issue.code), ["check-criteria-mismatch"]);
});

test("required checks must declare preconditions", () => {
  const { issues } = parseVerificationChecks([
    checkFrontMatter({ required: true, preconditions: [] }),
  ]);
  assert.deepEqual(issues.map((issue) => issue.code), ["incomplete-required-check"]);

  const advisory = parseVerificationChecks([
    checkFrontMatter({ required: false, preconditions: [] }),
  ]);
  assert.deepEqual(advisory.issues, []);
});

test("parseCheckInput accepts an idless payload and validates a supplied id", () => {
  const idless = parseCheckInput(JSON.stringify(checkPayload()));
  assert.equal(idless.check?.id, "");
  const supplied = parseCheckInput(JSON.stringify(checkPayload({ id: "CHK-07" })));
  assert.equal(supplied.check?.id, "CHK-07");
  const malformed = parseCheckInput("{not json");
  assert.equal(malformed.check, null);
  assert.equal(malformed.issues[0].code, "malformed-check-entry");
});

test("canonicalCheck serializes a stable field order and feeds the design revision", () => {
  const check = parseCheckInput(JSON.stringify(checkPayload({ id: "CHK-01" }))).check as VerificationCheckV1;
  assert.deepEqual(Object.keys(canonicalCheck(check)), [
    "id",
    "target",
    "method",
    "implementation",
    "preconditions",
    "passCriteria",
    "limitations",
    "required",
  ]);
  const revision = checkDesignRevision(check);
  assert.match(revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(checkDesignRevision({ ...check, required: false }) === revision, false);
});

test("nextCheckId appends — ids are never renumbered", () => {
  assert.equal(nextCheckId([]), "CHK-01");
  assert.equal(nextCheckId(["CHK-01"]), "CHK-02");
  // A deleted middle id is never reissued.
  assert.equal(nextCheckId(["CHK-01", "CHK-03"]), "CHK-04");
});

// ---------------------------------------------------------------------------
// Knowledge Graph projection — checks, anchors, derived edges
// ---------------------------------------------------------------------------

test("check target projects derived checks/checked-by edges — never stored relations", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01", "R-02"]);
  writeVerification(repo, "VD-AAA", [
    checkFrontMatter({ id: "CHK-01", target: "SPEC-AAA::R-01" }),
    checkFrontMatter({ id: "CHK-02", target: "SPEC-AAA::R-02", method: "e2e", required: false, passCriteria: { kind: "e2e", expect: "flow completes" } }),
  ]);

  const graph = await graphFor(repo);
  assert.deepEqual(graph.issues, []);
  const checksEdge = graph.derivedEdges.find((edge) => edge.relation === "checks");
  assert.ok(checksEdge, "derived checks edge exists");
  assert.equal(checksEdge.claim, "SPEC-AAA::R-01");
  const checkedBy = graph.derivedEdges.find((edge) => edge.relation === "checked-by");
  assert.ok(checkedBy, "derived checked-by edge exists");
  assert.equal(checkedBy.to.id, "VD-AAA");
  assert.equal(checkedBy.target, "VD-AAA::CHK-01");

  assert.equal(graph.checkEdges.length, 2);
  assert.equal(graph.checkEdges[0].resolution, "resolved");
  assert.equal(graph.checkEdges[0].method, "unit");
  // No stored edge is emitted for checks — the relation exists only as a
  // derived projection of checks[].target.
  assert.equal(graph.edges.every((edge) => edge.relation !== "checks"), true);
});

test("manual relations.checks is a legacy finding — never graph input", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeVerification(repo, "VD-AAA", [checkFrontMatter()], "docs/verification/design.md", {
    relations: { checks: ["SPEC-AAA::R-01"] },
  });

  const graph = await graphFor(repo);
  const legacy = graph.issues.filter((issue) => issue.code === "legacy-relation-field" && issue.target === "checks");
  assert.equal(legacy.length, 1, "relations.checks is outside the v1 stored vocabulary");
  assert.equal(graph.edges.filter((edge) => edge.relation === "checks").length, 0);
});

test("checks on a non-verification document are misplaced", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeDoc(repo, "docs/specs/wrong.md", frontMatter("spec", "SPEC-WRONG", { checks: [checkFrontMatter()] }), "# Wrong\n");

  const graph = await graphFor(repo);
  const misplaced = graph.issues.filter((issue) => issue.code === "misplaced-checks");
  assert.equal(misplaced.length, 1);
  assert.equal(misplaced[0].path, "docs/specs/wrong.md");
});

test("unresolved and ambiguous check targets are findings", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeVerification(repo, "VD-AAA", [
    checkFrontMatter({ id: "CHK-01", target: "SPEC-MISSING::R-01" }),
    checkFrontMatter({ id: "CHK-02", target: "SPEC-AAA::R-99" }),
  ]);

  const graph = await graphFor(repo);
  const unresolved = graph.issues.filter((issue) => issue.code === "unresolved-check-target");
  assert.equal(unresolved.length, 2);
  assert.ok(unresolved.some((issue) => issue.message.includes("no document declares id SPEC-MISSING")));
  assert.ok(unresolved.some((issue) => issue.message.includes("declares no claim R-99")));

  // Ambiguity: two documents share the target's document id.
  const ambiguous = tempRepo();
  writeSpecWithClaims(ambiguous, "SPEC-DUP", ["R-01"], "docs/specs/one.md");
  writeDoc(ambiguous, "docs/specs/two.md", frontMatter("spec", "SPEC-DUP"), "# Two\n\n- <!-- claim:R-01 --> dup\n");
  writeVerification(ambiguous, "VD-AAA", [checkFrontMatter({ target: "SPEC-DUP::R-01" })]);
  const ambiguousGraph = await graphFor(ambiguous);
  assert.ok(ambiguousGraph.issues.some((issue) => issue.code === "ambiguous-check-target"));
});

test("check body anchors validate against front-matter declarations", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeDoc(
    repo,
    "docs/verification/design.md",
    frontMatter("verification", "VD-AAA", { checks: [checkFrontMatter({ id: "CHK-01" }), checkFrontMatter({ id: "CHK-02", target: "SPEC-AAA::R-01", method: "static", required: false, passCriteria: { kind: "static", rule: "no TODOs" } })] }),
    [
      "# Design",
      "",
      "## Checks",
      "",
      "- <!-- check:CHK-01 --> unit check prose",
      "- <!-- check:VD-AAA::CHK-02 --> static check prose",
      "",
    ].join("\n"),
  );

  const clean = await graphFor(repo);
  assert.deepEqual(clean.issues, []);

  // An anchor naming an undeclared check.
  const dangling = tempRepo();
  writeSpecWithClaims(dangling, "SPEC-AAA", ["R-01"]);
  writeDoc(
    dangling,
    "docs/verification/design.md",
    frontMatter("verification", "VD-AAA", { checks: [checkFrontMatter()] }),
    "# Design\n\n- <!-- check:CHK-99 --> phantom\n",
  );
  const danglingGraph = await graphFor(dangling);
  assert.ok(danglingGraph.issues.some((issue) => issue.code === "unresolved-check-anchor" && issue.target === "CHK-99"));

  // Anchors outside a verification document are misplaced.
  const outside = tempRepo();
  writeDoc(outside, "docs/specs/spec.md", frontMatter("spec", "SPEC-AAA"), "# Spec\n\n- <!-- check:CHK-01 --> stray\n");
  const outsideGraph = await graphFor(outside);
  assert.ok(outsideGraph.issues.some((issue) => issue.code === "misplaced-check-anchor"));

  // Duplicated and mismatched anchors are findings.
  const drift = tempRepo();
  writeSpecWithClaims(drift, "SPEC-AAA", ["R-01"]);
  writeDoc(
    drift,
    "docs/verification/design.md",
    frontMatter("verification", "VD-AAA", { checks: [checkFrontMatter()] }),
    [
      "# Design",
      "",
      "- <!-- check:CHK-01 --> first",
      "- <!-- check:CHK-01 --> again",
      "- <!-- check:VD-OTHER::CHK-01 --> foreign",
      "- <!-- check:not-a-key --> broken",
      "",
    ].join("\n"),
  );
  const driftGraph = await graphFor(drift);
  const codes = driftGraph.issues.map((issue) => issue.code);
  assert.ok(codes.includes("duplicate-check-anchor"));
  assert.ok(codes.includes("check-anchor-mismatch"));
  assert.ok(codes.includes("invalid-check-anchor"));
});

test("resolveCheckReference is the task/evidence resolution boundary", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeVerification(repo, "VD-AAA", [checkFrontMatter({ id: "CHK-01" })]);

  const graph = await graphFor(repo);
  const resolved = resolveCheckReference(graph, "VD-AAA::CHK-01");
  assert.equal(resolved.status, "resolved");
  if (resolved.status === "resolved") {
    assert.equal(resolved.check.id, "CHK-01");
    assert.equal(resolved.node.id, "VD-AAA");
  }
  assert.equal(resolveCheckReference(graph, "VD-AAA::CHK-99").status, "unresolved-check");
  assert.equal(resolveCheckReference(graph, "VD-NULL::CHK-01").status, "unresolved-document");
  assert.equal(resolveCheckReference(graph, "SPEC-AAA::CHK-01").status, "not-verification");
  // Claim references, bare keys, and paths never resolve as checks.
  for (const ref of ["SPEC-AAA::R-01", "CHK-01", "docs/verification/design.md", "VD-AAA::R-01"]) {
    assert.equal(resolveCheckReference(graph, ref).status, "invalid", ref);
  }
});

test("resolveClaimReference validates check targets against live claims", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  const graph = await graphFor(repo);
  assert.equal(resolveClaimReference(graph, "SPEC-AAA::R-01").status, "resolved");
  assert.equal(resolveClaimReference(graph, "SPEC-AAA::R-99").status, "unresolved-claim");
  assert.equal(resolveClaimReference(graph, "SPEC-NULL::R-01").status, "unresolved-document");
  assert.equal(resolveClaimReference(graph, "R-01").status, "invalid");
});

test("locale siblings mirror one logical check — drift is a finding", async () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeDoc(repo, "docs/verification/design.md", frontMatter("verification", "VD-AAA", { checks: [checkFrontMatter()] }), "# Design\n");
  // The .ja.md sibling carries the same check verbatim — one logical check.
  const clean = await graphFor(repo);
  assert.deepEqual(clean.issues, []);

  writeDoc(repo, "docs/verification/design.ja.md", frontMatter("verification", "VD-AAA", { checks: [checkFrontMatter({ implementation: "different.test" })] }), "# 設計\n");
  const drift = await graphFor(repo);
  assert.ok(drift.issues.some((issue) => issue.code === "duplicate-check" && issue.target === "CHK-01"));
});

// ---------------------------------------------------------------------------
// new_verification.js — creation path
// ---------------------------------------------------------------------------

test("new_verification writes the checks contract with allocated CHK ids", () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01", "R-02"]);

  const result = runScript("verification-doc", "new_verification.js", [
    "--title", "Checkout total calculation",
    "--from", "docs/specs/spec.md",
    "--check", JSON.stringify(checkPayload()),
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-02", method: "manual-review", passCriteria: { kind: "manual-review", checklistItem: "reviewer confirms" }, required: false, preconditions: [] })),
  ], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const file = path.join(repo, "docs/verification/checkout-total-calculation.md");
  assert.equal(fs.existsSync(file), true);
  const data = readFrontMatter(repo, "docs/verification/checkout-total-calculation.md");
  assert.equal(data.type, "verification");
  const checks = data.checks as Record<string, unknown>[];
  assert.equal(checks.length, 2);
  assert.equal(checks[0].id, "CHK-01");
  assert.equal(checks[0].target, "SPEC-AAA::R-01");
  assert.equal(checks[1].id, "CHK-02");
  assert.equal(checks[1].method, "manual-review");
  assert.deepEqual(checks[1].passCriteria, { kind: "manual-review", checklistItem: "reviewer confirms" });
  // Canonical key order is serialized, not raw payload order.
  assert.deepEqual(Object.keys(checks[0]), [
    "id", "target", "method", "implementation", "preconditions", "passCriteria", "limitations", "required",
  ]);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /## Checks/);
  assert.match(text, /checks:/);
});

test("new_verification refuses a check targeting an unknown Claim ID", () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);

  const result = runScript("verification-doc", "new_verification.js", [
    "--title", "Phantom coverage",
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-99" })),
  ], { cwd: repo });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown Claim ID|declares no claim/);
  assert.equal(fs.existsSync(path.join(repo, "docs/verification")), false);
});

test("new_verification refuses malformed check payloads before any write", () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);

  for (const payload of ["{not json", JSON.stringify({ method: "unit" }), JSON.stringify(checkPayload({ method: "vibe" }))]) {
    const result = runScript("verification-doc", "new_verification.js", [
      "--title", "Bad payload",
      "--check", payload,
    ], { cwd: repo });
    assert.notEqual(result.status, 0, payload);
  }
  assert.equal(fs.existsSync(path.join(repo, "docs/verification")), false);
});

// ---------------------------------------------------------------------------
// update_verification.js — the reuse path
// ---------------------------------------------------------------------------

function repoWithVerificationDesign(): { repo: string; docId: string } {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01", "R-02", "R-03"]);
  const created = runScript("verification-doc", "new_verification.js", [
    "--title", "Existing design",
    "--check", JSON.stringify(checkPayload()),
  ], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);
  const data = readFrontMatter(repo, "docs/verification/existing-design.md");
  return { repo, docId: data.id as string };
}

test("update_verification upserts checks by id and preserves stable ids", () => {
  const { repo, docId } = repoWithVerificationDesign();

  // Append an idless check — allocates the next CHK-NN.
  const append = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-02", method: "integration", passCriteria: { kind: "integration", expect: "boundary holds" }, required: false, preconditions: [] })),
  ], { cwd: repo });
  assert.equal(append.status, 0, append.stderr);
  let checks = readFrontMatter(repo, "docs/verification/existing-design.md").checks as Record<string, unknown>[];
  assert.equal(checks.length, 2);
  assert.equal(checks[1].id, "CHK-02");

  // Upsert CHK-01 by explicit id — stable id, new definition.
  const upsert = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--check", JSON.stringify(checkPayload({ id: "CHK-01", implementation: "cart.test.ts::total_v2", method: "property", passCriteria: { kind: "property", invariant: "sum is associative" } })),
  ], { cwd: repo });
  assert.equal(upsert.status, 0, upsert.stderr);
  checks = readFrontMatter(repo, "docs/verification/existing-design.md").checks as Record<string, unknown>[];
  assert.equal(checks.length, 2);
  assert.equal(checks[0].id, "CHK-01");
  assert.equal(checks[0].method, "property");
  assert.equal(checks[1].id, "CHK-02");
});

test("update_verification removes checks without renumbering", () => {
  const { repo, docId } = repoWithVerificationDesign();
  runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-02" })),
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-03" })),
  ], { cwd: repo });
  let checks = readFrontMatter(repo, "docs/verification/existing-design.md").checks as Record<string, unknown>[];
  assert.deepEqual(checks.map((check) => check.id), ["CHK-01", "CHK-02", "CHK-03"]);

  const removed = runScript("verification-doc", "update_verification.js", ["--doc", docId, "--remove-check", "CHK-02"], { cwd: repo });
  assert.equal(removed.status, 0, removed.stderr);
  checks = readFrontMatter(repo, "docs/verification/existing-design.md").checks as Record<string, unknown>[];
  assert.deepEqual(checks.map((check) => check.id), ["CHK-01", "CHK-03"], "unrelated ids stay stable");

  // Allocation continues past the highest declared id — CHK-02 is never reissued.
  const appended = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-02" })),
  ], { cwd: repo });
  assert.equal(appended.status, 0, appended.stderr);
  checks = readFrontMatter(repo, "docs/verification/existing-design.md").checks as Record<string, unknown>[];
  assert.deepEqual(checks.map((check) => check.id), ["CHK-01", "CHK-03", "CHK-04"]);
});

test("update_verification fails closed — no partial writes", () => {
  const { repo, docId } = repoWithVerificationDesign();
  const before = fs.readFileSync(path.join(repo, "docs/verification/existing-design.md"), "utf8");

  const unknownRemoval = runScript("verification-doc", "update_verification.js", ["--doc", docId, "--remove-check", "CHK-99"], { cwd: repo });
  assert.notEqual(unknownRemoval.status, 0);
  const badCheck = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--check", JSON.stringify(checkPayload({ target: "SPEC-AAA::R-99" })),
  ], { cwd: repo });
  assert.notEqual(badCheck.status, 0);
  const wrongTypeDoc = runScript("verification-doc", "update_verification.js", ["--doc", "docs/specs/spec.md", "--status", "approved"], { cwd: repo });
  assert.notEqual(wrongTypeDoc.status, 0);
  const badStatus = runScript("verification-doc", "update_verification.js", ["--doc", docId, "--status", "bogus"], { cwd: repo });
  assert.notEqual(badStatus.status, 0);

  assert.equal(fs.readFileSync(path.join(repo, "docs/verification/existing-design.md"), "utf8"), before);
});

test("update_verification edits status and relations in place", () => {
  const { repo, docId } = repoWithVerificationDesign();
  writeVerification(repo, "VD-OLD", [], "docs/verification/old-design.md");

  const result = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--status", "proposed",
    "--lifecycle", "current",
    "--from", "docs/specs/spec.md",
    "--supersedes", "VD-OLD",
  ], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  const data = readFrontMatter(repo, "docs/verification/existing-design.md");
  assert.equal(data.status, "proposed");
  assert.equal(data.lifecycle, "current");
  const relations = data.relations as Record<string, unknown>;
  assert.deepEqual(relations.source, ["docs/specs/spec.md"]);
  assert.deepEqual(relations.supersedes, ["VD-OLD"]);

  const wrongType = runScript("verification-doc", "update_verification.js", [
    "--doc", docId,
    "--supersedes", "docs/specs/spec.md",
  ], { cwd: repo });
  assert.notEqual(wrongType.status, 0);
});

// ---------------------------------------------------------------------------
// resolve_verification.js — reuse-first resolution surface
// ---------------------------------------------------------------------------

test("resolve_verification finds covering checks for a claim", () => {
  const { repo } = repoWithVerificationDesign();
  const resolved = runScript("verification-doc", "resolve_verification.js", ["--for-claim", "SPEC-AAA::R-01", "--json"], { cwd: repo });
  assert.equal(resolved.status, 0, resolved.stderr);
  const payload = JSON.parse(resolved.stdout);
  assert.equal(payload.claimStatus, "resolved");
  assert.equal(payload.coveringChecks.length, 1);
  assert.match(payload.coveringChecks[0].check, /^VD-.+::CHK-01$/);
  assert.equal(payload.coveringChecks[0].method, "unit");

  // An uncovered claim is a normal "create one" answer, not an error.
  const uncovered = runScript("verification-doc", "resolve_verification.js", ["--for-claim", "SPEC-AAA::R-02", "--json"], { cwd: repo });
  assert.equal(uncovered.status, 0);
  assert.equal(JSON.parse(uncovered.stdout).coveringChecks.length, 0);
});

test("resolve_verification resolves qualified check refs and doc inventories", () => {
  const { repo, docId } = repoWithVerificationDesign();

  const byRef = runScript("verification-doc", "resolve_verification.js", ["--ref", `${docId}::CHK-01`, "--json"], { cwd: repo });
  assert.equal(byRef.status, 0, byRef.stderr);
  assert.equal(JSON.parse(byRef.stdout).check.id, "CHK-01");

  const badRef = runScript("verification-doc", "resolve_verification.js", ["--ref", `${docId}::CHK-42`, "--json"], { cwd: repo });
  assert.notEqual(badRef.status, 0);
  assert.equal(JSON.parse(badRef.stdout).status, "unresolved-check");

  const byDoc = runScript("verification-doc", "resolve_verification.js", ["--doc", docId, "--json"], { cwd: repo });
  assert.equal(byDoc.status, 0);
  const doc = JSON.parse(byDoc.stdout).document;
  assert.equal(doc.id, docId);
  assert.equal(doc.checks.length, 1);
  assert.match(doc.checks[0].designRevision, /^sha256:/);
});

// ---------------------------------------------------------------------------
// Execution Store task checks — the shared resolution path (#239)
// ---------------------------------------------------------------------------

test("execution_store resolves task checks through the Check contract", () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeVerification(repo, "VD-AAA", [checkFrontMatter()]);

  assert.equal(runScript("doc-driven-dev-graph", "execution_store.js", ["init"], { cwd: repo }).status, 0);
  const created = runScript("doc-driven-dev-graph", "execution_store.js", ["create", "--run-id", "RUN-1"], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);

  // A live check reference is accepted.
  const goodTask = path.join(repo, "task.json");
  fs.writeFileSync(goodTask, JSON.stringify({ taskId: "T-01", title: "verify", checks: ["VD-AAA::CHK-01"] }), "utf8");
  const put = runScript("doc-driven-dev-graph", "execution_store.js", ["put-task", "RUN-1", "--file", "task.json"], { cwd: repo });
  assert.equal(put.status, 0, put.stderr + put.stdout);

  // Unresolvable references fail closed at the write boundary.
  for (const checks of [["VD-AAA::CHK-99"], ["VD-NULL::CHK-01"], ["SPEC-AAA::CHK-01"], ["CHK-01"], ["docs/verification/design.md"]]) {
    fs.writeFileSync(goodTask, JSON.stringify({ taskId: "T-02", title: "bad", checks }), "utf8");
    const refused = runScript("doc-driven-dev-graph", "execution_store.js", ["put-task", "RUN-1", "--file", "task.json"], { cwd: repo });
    assert.notEqual(refused.status, 0, JSON.stringify(checks));
  }
});

// ---------------------------------------------------------------------------
// Legacy test-spec boundary + schema preflight
// ---------------------------------------------------------------------------

test("test-spec creation is refused and legacy specs route to migration", () => {
  const repo = tempRepo();
  const refused = runScript("test-spec-doc", "new_test_spec.js", ["--title", "Legacy", "--verifies", "docs/specs/spec.md"], { cwd: repo });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /legacy|migration/i);

  // Under a declared manifest a test-spec file is migration-required, and
  // the repository model classifies it as legacy — never a verification doc.
  fs.mkdirSync(path.join(repo, "docs/.doc-driven-dev"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/.doc-driven-dev/schema.json"), schemaManifestText(), "utf8");
  writeDoc(repo, "docs/test-specs/legacy.md", { id: "TSPEC-1", type: "test-spec", status: "draft", title: "Legacy spec" }, "# Legacy\n");
  const report = evaluateSchemaPreflight(repo);
  assert.equal(report.status, "migration-required");
  assert.ok(report.issues.some((issue) => issue.reason === "legacy-execution-doc" && issue.path === "docs/test-specs/legacy.md"));
});

test("normal scanning keeps test-specs out of the verification node set", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/test-specs/legacy.md", { id: "TSPEC-1", type: "test-spec", status: "draft", title: "Legacy" }, "# Legacy\n");

  const model = await scanRepository({ cwd: repo });
  assert.equal(model.legacyDocuments.some((doc) => doc.path === "docs/test-specs/legacy.md"), true);
  const graph = projectKnowledgeGraph(model);
  assert.equal(graph.nodes.every((node) => node.type !== "test-spec"), true);
  assert.equal(graph.checkEdges.length, 0);
});

// ---------------------------------------------------------------------------
// Lint integration
// ---------------------------------------------------------------------------

test("doc_status lint reports check contract findings", () => {
  const repo = tempRepo();
  writeSpecWithClaims(repo, "SPEC-AAA", ["R-01"]);
  writeDoc(
    repo,
    "docs/verification/design.md",
    frontMatter("verification", "VD-AAA", {
      checks: [
        checkFrontMatter({ id: "CHK-01" }),
        checkFrontMatter({ id: "CHK-01", target: "SPEC-AAA::R-01", method: "unit" }),
        checkFrontMatter({ id: "CHK-02", method: "unit", passCriteria: { kind: "formal-proof", theorem: "x" } }),
      ],
      relations: { checks: ["SPEC-AAA::R-01"] },
    }),
    "# Design\n\n- <!-- check:CHK-77 --> phantom\n",
  );

  const lint = runScript("doc-status", "doc_status.js", ["lint", "--type", "verification", "--json"], { cwd: repo });
  assert.equal(lint.status, 0, lint.stderr);
  const ruleIds = JSON.parse(lint.stdout).findings.map((finding: { ruleId: string }) => finding.ruleId);
  assert.ok(ruleIds.includes("duplicate-check"), "duplicate check id reported");
  assert.ok(ruleIds.includes("check-criteria-mismatch"), "kind/method contradiction reported");
  assert.ok(ruleIds.includes("unresolved-check-anchor"), "phantom anchor reported");
  assert.ok(ruleIds.includes("legacy-relation-field"), "manual relations.checks reported");
});

// ---------------------------------------------------------------------------
// English/Japanese surface parity
// ---------------------------------------------------------------------------

test("verification-doc ships synchronized EN/JA skill, conventions, and templates", () => {
  const skillDir = path.join(skillRoot, "verification-doc");
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/verification-conventions.md",
    "references/verification-conventions.ja.md",
    "assets/templates/verification.md",
    "assets/templates/verification.ja.md",
  ];
  for (const relative of files) {
    assert.equal(fs.existsSync(path.join(skillDir, relative)), true, `${relative} exists`);
  }

  const scripts = fs.readdirSync(path.join(skillDir, "scripts")).sort();
  for (const script of ["new_verification.js", "update_verification.js", "resolve_verification.js"]) {
    assert.ok(scripts.includes(script), `verification-doc ships ${script}`);
  }

  // Both languages document the Check contract: the checks: authority,
  // CHK-NN ids, all nine methods, and the passCriteria.kind === method rule.
  for (const relative of files) {
    const text = fs.readFileSync(path.join(skillDir, relative), "utf8");
    assert.match(text, /checks:/, `${relative} names the checks authority`);
    assert.match(text, /CHK-/, `${relative} documents CHK ids`);
    assert.match(text, /passCriteria/, `${relative} documents passCriteria`);
  }

  const methods = ["unit", "integration", "e2e", "property", "static", "model-checking", "formal-proof", "runtime-monitoring", "manual-review"];
  for (const relative of ["SKILL.md", "SKILL.ja.md", "references/verification-conventions.md", "references/verification-conventions.ja.md"]) {
    const text = fs.readFileSync(path.join(skillDir, relative), "utf8");
    for (const method of methods) {
      assert.ok(text.includes(method), `${relative} covers method ${method}`);
    }
  }
});
