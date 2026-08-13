const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/scaffold_docs.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-scaffold-"));
}

function runScaffold(cwd) {
  const result = spawnSync(
    process.execPath,
    [tsxCli, sourceCli],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("scaffold_docs creates the canonical docs tree without overview.md", () => {
  const repo = tempRepo();

  const result = runScaffold(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created docs tree scaffold/);

  const expectedPaths = [
    "docs/ideas/README.md",
    "docs/discovery/README.md",
    "docs/specs/README.md",
    "docs/designs/README.md",
    "docs/plans/README.md",
    "docs/tasks/README.md",
    "docs/adr/README.md",
    "docs/impl/ir/README.md",
    "docs/impl/exp/README.md",
  ];

  for (const relPath of expectedPaths) {
    assert.equal(fs.existsSync(path.join(repo, relPath)), true, relPath);
  }

  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), false);
});

test("scaffold_docs preserves existing README files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/specs/README.md"), "# existing\n", "utf8");

  const result = runScaffold(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), "# existing\n");
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), false);
});
