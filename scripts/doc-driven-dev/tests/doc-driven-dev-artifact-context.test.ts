import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFixtureRepo, updateArtifact, writeArtifact } from "./e2e/harness/fixture_manager";
import { canonicalReference } from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import {
  expandArtifactContext,
  fetchArtifactBodies,
  listArtifactMetadata,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_context";
import { summarizeBaseline } from "../src/skills/doc-driven-dev-graph/scripts/lib/context_metrics";

// --- L1: listArtifactMetadata ------------------------------------------------

test("L1 returns body-free chain metadata plus typed-relation neighbors, sorted by path", () => {
  const repo = createFixtureRepo();
  const { metadata, findings } = listArtifactMetadata(repo, ["PLAN-0001"]);

  assert.deepEqual(metadata.map((entry) => entry.path), [
    "docs/adr/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/specs/0001-graph.md",
    "docs/tasks/0001-task.md",
    "docs/test-specs/0001-graph.md",
  ]);
  for (const entry of metadata) {
    assert.equal("body" in entry, false, `${entry.path} must not carry a body`);
    assert.equal("absolutePath" in entry, false, `${entry.path} must not leak absolute paths`);
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.type, "string");
    assert.equal(typeof entry.status, "string");
    assert.equal(typeof entry.relations, "object");
  }
  // The implementation record shares the repo but is outside the focus chain
  // and no typed relation points at it.
  assert.equal(metadata.some((entry) => entry.path === "docs/impl/ir/0001-task.md"), false);
  assert.deepEqual(findings, []);
});

test("L1 metadata relations mirror the declared typed-relation map", () => {
  const repo = createFixtureRepo();
  const { metadata } = listArtifactMetadata(repo, ["PLAN-0001"]);
  const plan = metadata.find((entry) => entry.path === "docs/plans/0001-graph.md");
  assert.deepEqual(plan?.relations, {
    "derives-from": ["DESIGN-0001"],
    "verified-by": ["docs/test-specs/0001-graph.md"],
  });
});

test("L1 fails closed with focus-required on empty focus", () => {
  const repo = createFixtureRepo();
  const { metadata, findings } = listArtifactMetadata(repo, []);
  assert.deepEqual(metadata, []);
  assert.ok(findings.some((finding) => finding.code === "focus-required"));
});

test("L1 fails closed with focus-invalid on ambiguous and unresolvable focus", () => {
  const ambiguous = createFixtureRepo({ secondPlan: true });
  const ambiguousResult = listArtifactMetadata(ambiguous, ["DESIGN-0001"]);
  assert.deepEqual(ambiguousResult.metadata, []);
  assert.ok(ambiguousResult.findings.some((finding) => finding.code === "focus-invalid"));

  const repo = createFixtureRepo();
  const missing = listArtifactMetadata(repo, ["docs/specs/9999-missing.md"]);
  assert.deepEqual(missing.metadata, []);
  assert.ok(missing.findings.some((finding) => finding.code === "focus-invalid"));
});

test("L1 passes duplicate-id graph issues through as findings", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/plans/0002-dup.md": {
        frontmatter: { id: "PLAN-0001", type: "plan", status: "approved", title: "Duplicate" },
        body: "# Duplicate\n",
      },
    },
  });
  const { metadata, findings } = listArtifactMetadata(repo, ["docs/plans/0001-graph.md"]);
  assert.ok(findings.some((finding) => finding.code === "duplicate-id"));
  assert.ok(metadata.length > 0);
});

test("L1 reports unresolved typed-relation targets as per-lookup findings", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/plans/0001-graph.md": {
        frontmatter: {
          id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
          relations: {
            "derives-from": ["DESIGN-0001"],
            "verified-by": ["docs/test-specs/0001-graph.md"],
            "relates-to": ["GHOST-0001"],
          },
        },
        body: "# Graph\n",
      },
    },
  });
  const { findings } = listArtifactMetadata(repo, ["PLAN-0001"]);
  // The scan-level pass-through and the per-lookup finding are both recorded.
  assert.ok(findings.some((finding) => finding.code === "broken-relation"
    && finding.path === "docs/plans/0001-graph.md"
    && finding.message.includes("GHOST-0001")));
});

// --- L2: fetchArtifactBodies -------------------------------------------------

test("L2 returns validated document bodies at level L2", () => {
  const repo = createFixtureRepo();
  const reference = canonicalReference(repo, "docs/plans/0001-graph.md");
  const result = fetchArtifactBodies(repo, [{
    path: "docs/plans/0001-graph.md",
    id: "PLAN-0001",
    fingerprint: reference.fingerprint,
  }]);
  assert.equal(result.level, "L2");
  assert.deepEqual(result.findings, []);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].path, "docs/plans/0001-graph.md");
  assert.equal(result.documents[0].id, "PLAN-0001");
  assert.ok(result.documents[0].body.includes("# Graph"));
});

test("L2 also validates refs supplied without id or fingerprint", () => {
  const repo = createFixtureRepo();
  const result = fetchArtifactBodies(repo, [{ path: "docs/specs/0001-graph.md" }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, "SPEC-0001");
});

test("L2 rejects an id that does not match the record", () => {
  const repo = createFixtureRepo();
  const result = fetchArtifactBodies(repo, [{ path: "docs/plans/0001-graph.md", id: "PLAN-9999" }]);
  assert.deepEqual(result.documents, []);
  assert.ok(result.findings.some((finding) => finding.code === "id-mismatch"
    && finding.path === "docs/plans/0001-graph.md"));
});

test("L2 rejects a stale fingerprint after the document changed", () => {
  const repo = createFixtureRepo();
  const reference = canonicalReference(repo, "docs/plans/0001-graph.md");
  fs.appendFileSync(path.join(repo, "docs/plans/0001-graph.md"), "\nMore context.\n", "utf8");
  const result = fetchArtifactBodies(repo, [{
    path: "docs/plans/0001-graph.md",
    fingerprint: reference.fingerprint,
  }]);
  assert.deepEqual(result.documents, []);
  assert.ok(result.findings.some((finding) => finding.code === "stale-fingerprint"));
});

test("L2 rejects missing files, escapes, non-canonical and unparsable paths", () => {
  const repo = createFixtureRepo();
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/code.ts"), "export {};\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/specs/0009-bad.md"), "---\ntitle: [unclosed\n---\n# Bad\n", "utf8");

  const result = fetchArtifactBodies(repo, [
    { path: "docs/specs/9999-missing.md" },
    { path: "../outside.md" },
    { path: path.join(repo, "docs/specs/0001-graph.md") },
    { path: "src/code.ts" },
    { path: "docs/specs/README.md" },
    { path: "docs/specs/0009-bad.md" },
  ]);
  assert.deepEqual(result.documents, []);
  const codeFor = (ref: string) => result.findings.filter((finding) => finding.path === ref).map((finding) => finding.code);
  assert.deepEqual(codeFor("docs/specs/9999-missing.md"), ["not-found"]);
  assert.deepEqual(codeFor("../outside.md"), ["path-escape"]);
  assert.deepEqual(codeFor(path.join(repo, "docs/specs/0001-graph.md")), ["path-escape"]);
  assert.deepEqual(codeFor("src/code.ts"), ["not-canonical"]);
  assert.deepEqual(codeFor("docs/specs/README.md"), ["not-canonical"]);
  assert.deepEqual(codeFor("docs/specs/0009-bad.md"), ["unreadable"]);
});

// --- L3: expandArtifactContext -----------------------------------------------

test("L3 traverses lineage relations in BFS order with depth and via", () => {
  const repo = createFixtureRepo();
  const { nodes, findings } = expandArtifactContext(repo, "docs/plans/0001-graph.md", {});
  assert.deepEqual(findings, []);
  assert.deepEqual(nodes, [
    { path: "docs/plans/0001-graph.md", id: "PLAN-0001", depth: 0, via: null },
    { path: "docs/designs/0001-graph.md", id: "DESIGN-0001", depth: 1, via: "derives-from" },
    { path: "docs/adr/0001-graph.md", id: "ADR-0001", depth: 2, via: "derives-from" },
    { path: "docs/specs/0001-graph.md", id: "SPEC-0001", depth: 2, via: "derives-from" },
  ]);
  // Non-lineage relations (verified-by) and undeclared inverses (a task's
  // implements edge pointing at the plan) are not traversed by default.
  assert.equal(nodes.some((node) => node.path === "docs/test-specs/0001-graph.md"), false);
  assert.equal(nodes.some((node) => node.path === "docs/tasks/0001-task.md"), false);
});

function cycleRepo(): string {
  return createFixtureRepo({
    files: {
      "docs/specs/0007-cyc-a.md": {
        frontmatter: {
          id: "CYC-A", type: "spec", status: "approved", title: "Cycle A",
          relations: { "derives-from": ["CYC-B"] },
        },
        body: "# Cycle A\n",
      },
      "docs/specs/0008-cyc-b.md": {
        frontmatter: {
          id: "CYC-B", type: "spec", status: "approved", title: "Cycle B",
          relations: { "derives-from": ["CYC-A"] },
        },
        body: "# Cycle B\n",
      },
    },
  });
}

test("L3 resolves a document-id root and stops at the visited set on cycles", () => {
  const repo = cycleRepo();
  const { nodes } = expandArtifactContext(repo, "CYC-A", {});
  assert.deepEqual(nodes, [
    { path: "docs/specs/0007-cyc-a.md", id: "CYC-A", depth: 0, via: null },
    { path: "docs/specs/0008-cyc-b.md", id: "CYC-B", depth: 1, via: "derives-from" },
  ]);
});

function diamondRepo(): string {
  return createFixtureRepo({
    files: {
      "docs/specs/0010-dia-a.md": {
        frontmatter: {
          id: "DIA-A", type: "spec", status: "approved", title: "Diamond A",
          relations: { "derives-from": ["DIA-B", "DIA-C"] },
        },
        body: "# Diamond A\n",
      },
      "docs/specs/0011-dia-b.md": {
        frontmatter: {
          id: "DIA-B", type: "spec", status: "approved", title: "Diamond B",
          relations: { "derives-from": ["DIA-D"] },
        },
        body: "# Diamond B\n",
      },
      "docs/specs/0012-dia-c.md": {
        frontmatter: {
          id: "DIA-C", type: "spec", status: "approved", title: "Diamond C",
          relations: { "derives-from": ["DIA-D"] },
        },
        body: "# Diamond C\n",
      },
      "docs/specs/0013-dia-d.md": {
        frontmatter: { id: "DIA-D", type: "spec", status: "approved", title: "Diamond D" },
        body: "# Diamond D\n",
      },
    },
  });
}

test("L3 suppresses duplicates when two paths reach the same node", () => {
  const repo = diamondRepo();
  const { nodes } = expandArtifactContext(repo, "docs/specs/0010-dia-a.md", {});
  assert.deepEqual(nodes, [
    { path: "docs/specs/0010-dia-a.md", id: "DIA-A", depth: 0, via: null },
    { path: "docs/specs/0011-dia-b.md", id: "DIA-B", depth: 1, via: "derives-from" },
    { path: "docs/specs/0012-dia-c.md", id: "DIA-C", depth: 1, via: "derives-from" },
    { path: "docs/specs/0013-dia-d.md", id: "DIA-D", depth: 2, via: "derives-from" },
  ]);
});

test("L3 respects maxDepth and echoes the expansion reason", () => {
  const repo = diamondRepo();
  const shallow = expandArtifactContext(repo, "docs/specs/0010-dia-a.md", {
    maxDepth: 1,
    reason: "delegate needs only direct upstream",
  });
  assert.deepEqual(shallow.nodes.map((node) => node.path), [
    "docs/specs/0010-dia-a.md",
    "docs/specs/0011-dia-b.md",
    "docs/specs/0012-dia-c.md",
  ]);
  assert.equal(shallow.reason, "delegate needs only direct upstream");

  const reasonless = expandArtifactContext(repo, "docs/specs/0010-dia-a.md", {});
  assert.equal(reasonless.reason, undefined);
});

test("L3 records broken-relation and ambiguous-target lookups as findings", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/specs/0020-src.md": {
        frontmatter: {
          id: "SRC-0001", type: "spec", status: "approved", title: "Source",
          relations: { "derives-from": ["MISSING-0001", "DUP-T"] },
        },
        body: "# Source\n",
      },
      "docs/specs/0021-dup-a.md": {
        frontmatter: { id: "DUP-T", type: "spec", status: "approved", title: "Dup A" },
        body: "# Dup A\n",
      },
      "docs/specs/0022-dup-b.md": {
        frontmatter: { id: "DUP-T", type: "spec", status: "approved", title: "Dup B" },
        body: "# Dup B\n",
      },
    },
  });
  const { nodes, findings } = expandArtifactContext(repo, "docs/specs/0020-src.md", {});
  assert.deepEqual(nodes, [
    { path: "docs/specs/0020-src.md", id: "SRC-0001", depth: 0, via: null },
  ]);
  assert.ok(findings.some((finding) => finding.code === "broken-relation"
    && finding.path === "docs/specs/0020-src.md"
    && finding.message.includes("MISSING-0001")));
  assert.ok(findings.some((finding) => finding.code === "ambiguous-target"
    && finding.path === "docs/specs/0020-src.md"
    && finding.message.includes("DUP-T")));
});

test("L3 fails closed on a duplicated-id expansion root", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/specs/0021-dup-a.md": {
        frontmatter: { id: "DUP-T", type: "spec", status: "approved", title: "Dup A" },
        body: "# Dup A\n",
      },
      "docs/specs/0022-dup-b.md": {
        frontmatter: { id: "DUP-T", type: "spec", status: "approved", title: "Dup B" },
        body: "# Dup B\n",
      },
    },
  });
  const { nodes, findings } = expandArtifactContext(repo, "DUP-T", {});
  assert.deepEqual(nodes, []);
  assert.ok(findings.some((finding) => finding.code === "duplicate-id"));
});

test("L3 only follows the relations it is asked to follow", () => {
  const repo = createFixtureRepo({
    files: {
      "docs/tasks/0001-task.md": {
        frontmatter: {
          id: "TASK-0001", type: "task", status: "todo", title: "TASK-0001",
          relations: { implements: ["docs/plans/0001-graph.md"], "depends-on": ["TASK-0002"] },
        },
        body: "# Task\n\n## Verification\n\n- [ ] node --test\n",
      },
      "docs/tasks/0002-task.md": {
        frontmatter: { id: "TASK-0002", type: "task", status: "todo", title: "TASK-0002" },
        body: "# Task\n",
      },
    },
  });
  const lineage = expandArtifactContext(repo, "docs/tasks/0001-task.md", {});
  assert.deepEqual(lineage.nodes.map((node) => node.path), [
    "docs/tasks/0001-task.md",
    "docs/plans/0001-graph.md",
    "docs/designs/0001-graph.md",
  ]);
  const dependency = expandArtifactContext(repo, "docs/tasks/0001-task.md", { relations: ["depends-on"] });
  assert.deepEqual(dependency.nodes.map((node) => node.path), [
    "docs/tasks/0001-task.md",
    "docs/tasks/0002-task.md",
  ]);
  assert.equal(dependency.nodes[1].via, "depends-on");
});

// --- summarizeBaseline --------------------------------------------------------

test("summarizeBaseline separates scan reads from unique delegate-input reads", () => {
  const sizes: Record<string, number> = { "docs/a.md": 100, "docs/b.md": 200 };
  const baseline = summarizeBaseline(
    { filesRead: 10, bytesRead: 5000 },
    ["docs/a.md", "docs/b.md"],
    (file) => sizes[file],
  );
  assert.deepEqual(baseline, {
    scan: { files: 10, bytes: 5000 },
    delegateInputs: { files: 2, bytes: 300 },
    ratio: 0.06,
  });
});

test("summarizeBaseline dedupes delegate paths and guards zero-byte scans", () => {
  const sizes: Record<string, number> = { "docs/a.md": 100 };
  const deduped = summarizeBaseline({ filesRead: 3, bytesRead: 50 }, ["docs/a.md", "docs/a.md"], (file) => sizes[file]);
  assert.deepEqual(deduped.delegateInputs, { files: 1, bytes: 100 });
  assert.equal(deduped.ratio, 2);

  const zero = summarizeBaseline({ filesRead: 0, bytesRead: 0 }, ["docs/a.md"], (file) => sizes[file]);
  assert.equal(zero.ratio, 0);
});
