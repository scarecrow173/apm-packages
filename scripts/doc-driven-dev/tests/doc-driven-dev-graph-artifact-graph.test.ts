const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  projectArtifactGraph,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts");

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
