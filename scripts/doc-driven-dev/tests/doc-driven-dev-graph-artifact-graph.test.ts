import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { projectArtifactGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph";

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify("# Artifact\n", data), "utf8");
}

test("existing non-Markdown local relations are valid while missing files remain broken", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-local-file-"));
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/example.py"), "VALUE = 1\n", "utf8");
  writeArtifact(repo, "docs/specs/0001-spec.md", {
    id: "SPEC-0001",
    type: "spec",
    status: "approved",
    relations: {
      source: ["../../src/example.py", "../../src/missing.py"],
    },
  });

  const graph = projectArtifactGraph({ cwd: repo });
  const sourceEdges = graph.edges.filter((edge: { relation: string }) => edge.relation === "source");

  assert.equal(sourceEdges.length, 2);
  assert.ok(sourceEdges.every((edge: { to: string | null; external: boolean }) => (
    edge.to === null && edge.external === false
  )));
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/example.py")), false);
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/missing.py")), true);
  assert.equal(graph.issues.filter((issue: { code: string }) => issue.code === "broken-relation").length, 1);
});
