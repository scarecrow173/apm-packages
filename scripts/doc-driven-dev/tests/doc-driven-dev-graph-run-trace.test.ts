import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import {
  createArtifactScanCollector,
  scanArtifactGraph,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const CANONICAL_TARGETS = [
  "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
  "docs/tasks", "docs/test-specs", "docs/adr", "docs/impl/ir", "docs/impl/exp",
];

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): number {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = matter.stringify(body, {
    created: "2026-08-24", updated: "2026-08-24", owners: [], relations: {}, ...data,
  });
  fs.writeFileSync(file, content, "utf8");
  return Buffer.byteLength(content, "utf8");
}

function fixtureRepo(): { repo: string; artifactFiles: number; totalBytes: number } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-run-trace-"));
  for (const directory of CANONICAL_TARGETS) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  let totalBytes = 0;
  totalBytes += writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  totalBytes += writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  totalBytes += writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  return { repo, artifactFiles: 3, totalBytes };
}

test("scan collector counts files, bytes, and unique paths", () => {
  const { repo, artifactFiles, totalBytes } = fixtureRepo();
  const collector = createArtifactScanCollector();
  scanArtifactGraph({ cwd: repo }, collector);
  assert.equal(collector.scans, 1);
  assert.equal(collector.filesRead, artifactFiles);
  assert.equal(collector.bytesRead, totalBytes);
  assert.equal(collector.filePaths.size, artifactFiles);

  scanArtifactGraph({ cwd: repo }, collector);
  assert.equal(collector.scans, 2);
  assert.equal(collector.filesRead, artifactFiles * 2);
  assert.equal(collector.bytesRead, totalBytes * 2);
  assert.equal(collector.filePaths.size, artifactFiles, "unique paths dedupe repeat scans");
});

test("projectGraphState reports both internal scans through the collector", () => {
  const { repo, artifactFiles, totalBytes } = fixtureRepo();
  const collector = createArtifactScanCollector();
  projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] }, collector);
  // projectGraphState scans once, then evaluateGraphGates re-scans once.
  assert.equal(collector.scans, 2);
  assert.equal(collector.filesRead, artifactFiles * 2);
  assert.equal(collector.bytesRead, totalBytes * 2);
});

test("omitting the collector keeps projections identical", () => {
  const { repo } = fixtureRepo();
  const plain = projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] });
  const collector = createArtifactScanCollector();
  const traced = projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] }, collector);
  assert.deepEqual(traced, plain);
});
