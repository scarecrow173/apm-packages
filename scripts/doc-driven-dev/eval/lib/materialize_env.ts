/**
 * Materializes a sanitized consumer repository for a doc-driven-dev agent
 * evaluation round. Each environment is a realistic small project with the
 * package's distributed `.apm/` assets copied in, a git baseline, and the
 * state the scenario calls for (fresh, mid-run, legacy corpus, or ready
 * for verification).
 *
 * Usage: tsx eval/lib/materialize_env.ts <env> <targetDir> [snapshotFile]
 *
 * Environments: river | harbor | quarry | atlas
 * The optional snapshot file receives a sha256 digest map of the
 * materialized tree for post-run comparison (stored outside the target
 * dir so the environment carries no evaluation artifacts).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import {
  approvePlan,
  createRun,
  initStateRoot,
  recordCheckpoint,
  updateTask,
} from "../../src/skills/lib/execution_store";
import { schemaManifestText } from "../../src/skills/lib/schema_preflight";

// eval/lib/materialize_env.ts → repo-root/packages/doc-driven-dev/.apm
const PACKAGE_APM = path.resolve(path.dirname(process.argv[1]), "../../../../packages/doc-driven-dev/.apm");

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeDoc(repo: string, rel: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-24",
    updated: "2026-08-24",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

const AGENTS_MD = (tooling: string) => `# ${tooling} project

This repository uses the doc-driven-dev APM package. Skill definitions live
under \`.apm/skills/\` — read the SKILL.md files when a task touches project
documentation, planning, implementation tracking, or verification.

Durable project documents live under \`docs/\`. Per-run execution state lives
under \`.apm/state/\` (git-ignored).
`;

function scaffold(repo: string, tooling: string): void {
  copyDir(PACKAGE_APM, path.join(repo, ".apm"));
  writeFile(repo, ".gitignore", "# execution state — per-worktree, never committed\n/.apm/state/\n");
  writeFile(repo, "AGENTS.md", AGENTS_MD(tooling));
}

function initGit(repo: string): void {
  initStateRoot(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=dev@example.com", "-c", "user.name=dev", "commit", "-qm", "baseline"]);
}

/** `river` — a fresh project that has never produced doc-driven artifacts. */
function envRiver(repo: string): void {
  scaffold(repo, "clippings");
  writeFile(repo, "README.md", "# clippings\n\nA small CLI for saving and organizing web clippings.\n");
  writeFile(repo, "src/main.ts", `// clippings entry point\nexport function main(args: string[]): void {\n  // TODO: subcommand dispatch\n}\n`);
  writeFile(repo, "src/store.ts", `// flat-file clipping store\nexport interface Clipping {\n  url: string;\n  title: string;\n  savedAt: string;\n  tags: string[];\n}\n`);
  initGit(repo);
}

/** `harbor` — mid-flight: approved design chain + an active run with tasks. */
function envHarbor(repo: string): void {
  scaffold(repo, "ledger-lite");
  writeFile(repo, "README.md", "# ledger-lite\n\nPlain-text double-entry ledger with a small CLI.\n");
  writeFile(repo, "src/ledger.ts", `// ledger model\nexport interface Entry {\n  date: string;\n  account: string;\n  amount: number;\n}\n`);
  writeFile(repo, "src/exporter.ts", `// export formats — CSV writer lands here\n`);
  for (const dir of ["docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/adr", "docs/knowledge", "docs/verification"]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    writeFile(repo, `${dir}/README.md`, `# ${dir}\n`);
  }
  fs.mkdirSync(path.join(repo, "docs/.doc-driven-dev"), { recursive: true });
  writeFile(repo, "docs/.doc-driven-dev/schema.json", schemaManifestText());
  writeDoc(repo, "docs/specs/0001-csv-export.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "CSV export",
  }, "# CSV export\n\n## Acceptance Criteria\n\n- [ ] ledger entries export to RFC-4180 CSV\n- [ ] `export` subcommand writes to stdout or a file\n");
  writeDoc(repo, "docs/adr/0001-csv-export.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "CSV export",
    relations: { "decides-for": ["DESIGN-0001"] },
  }, "# CSV export\n\n## Considered Options\n\n### Manual string building\n\n### Dependency-free writer\n");
  writeDoc(repo, "docs/designs/0001-csv-export.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "CSV export",
    relations: { realizes: ["SPEC-0001"] },
  }, "# CSV export\n\nA dependency-free writer in `src/exporter.ts`.\n");
  initGit(repo);
  const runId = "RUN-ledger-01";
  createRun(repo, {
    runId,
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-csv-export.md"],
    plan: "# CSV export\n\n- scaffold the export subcommand\n- write the CSV writer\n- docs for the export flag\n",
    tasks: [
      { taskId: "TASK-0001", title: "scaffold export subcommand", status: "todo" },
      { taskId: "TASK-0002", title: "write CSV writer", status: "todo", dependsOn: ["TASK-0001"] },
      { taskId: "TASK-0003", title: "export flag docs", status: "wont-do" },
    ],
  });
  approvePlan(repo, runId, { actor: "operator" });
  updateTask(repo, runId, "TASK-0001", { status: "done", title: "scaffold export subcommand" }, { expectedVersion: 1 });
  recordCheckpoint(repo, runId, { checkpointId: "CHK-harbor-1", edgeId: "task-graph-to-implementation" });
}

/** `quarry` — a pre-v3 corpus: legacy docs and a v2 graph definition. */
function envQuarry(repo: string): void {
  scaffold(repo, "papertrail");
  writeFile(repo, "README.md", "# papertrail\n\nDocument sync CLI (older project).\n");
  writeFile(repo, "src/sync.ts", `// sync engine\nexport function sync(): void {}\n`);
  for (const dir of ["docs/specs", "docs/designs", "docs/plans", "docs/tasks", "docs/test-specs", "docs/impl/ir"]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    writeFile(repo, `${dir}/README.md`, `# ${dir}\n`);
  }
  fs.mkdirSync(path.join(repo, "docs/.doc-driven-dev"), { recursive: true });
  writeFile(repo, "docs/.doc-driven-dev/graph.yaml", `schemaVersion: 2\nid: doc-driven-dev\nnodes: []\nedges: []\n`);
  writeDoc(repo, "docs/specs/0001-sync.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Sync",
  }, "# Sync\n");
  writeDoc(repo, "docs/designs/0001-sync.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Sync",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Sync\n");
  writeDoc(repo, "docs/plans/0001-sync.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Sync",
    relations: { "derives-from": ["DESIGN-0001"] },
  }, "# Sync plan\n");
  writeDoc(repo, "docs/tasks/0001-sync.md", {
    id: "TASK-0001", type: "task", status: "done", title: "sync scaffold",
    relations: { implements: ["docs/plans/0001-sync.md"] },
  }, "# Task\n");
  writeDoc(repo, "docs/tasks/0002-sync.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "conflict resolution",
    relations: { implements: ["docs/plans/0001-sync.md"], "depends-on": ["TASK-0001"] },
  }, "# Task\n");
  writeDoc(repo, "docs/test-specs/0001-sync.md", {
    id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Sync",
    relations: { verifies: ["SPEC-0001"] },
  }, "# Sync test spec\n");
  writeDoc(repo, "docs/impl/ir/0001-sync.md", {
    id: "IMPL-0001", type: "implementation-record", status: "complete", title: "sync scaffold",
  }, "# Implementation Record\n");
  initGit(repo);
}

/** `atlas` — implementation complete; the run waits on verification + wrap-up. */
function envAtlas(repo: string): void {
  scaffold(repo, "markwright");
  writeFile(repo, "README.md", "# markwright\n\nMarkdown renderer with pluggable themes.\n");
  writeFile(repo, "src/renderer.ts", `// markdown renderer\nexport function render(input: string): string {\n  return input.replace(/^# (.+)$/gm, "<h1>$1</h1>");\n}\n`);
  writeFile(repo, "src/renderer.test.mjs", `import { test } from "node:test";\nimport assert from "node:assert";\nimport { render } from "./renderer.ts";\n\ntest("h1 renders", () => {\n  assert.equal(render("# hi"), "<h1>hi</h1>");\n});\n`);
  for (const dir of ["docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/adr", "docs/knowledge", "docs/verification"]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    writeFile(repo, `${dir}/README.md`, `# ${dir}\n`);
  }
  fs.mkdirSync(path.join(repo, "docs/.doc-driven-dev"), { recursive: true });
  writeFile(repo, "docs/.doc-driven-dev/schema.json", schemaManifestText());
  writeDoc(repo, "docs/specs/0001-themes.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Themes",
  }, "# Theme support\n\n## Requirements\n\n- <!-- claim:R-01 --> h1 headings render as HTML headings\n");
  writeDoc(repo, "docs/designs/0001-themes.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Themes",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Themes\n\nRenderer-first design in `src/renderer.ts`.\n");
  writeDoc(repo, "docs/verification/0001-themes.md", {
    id: "VD-0001", type: "verification", status: "approved", title: "Themes",
    checks: [{
      id: "CHK-01",
      target: "SPEC-0001::R-01",
      method: "unit",
      implementation: "node --test src/renderer.test.mjs",
      preconditions: ["src/renderer.ts exists"],
      passCriteria: { kind: "unit", expect: "test exits 0" },
      limitations: [],
      required: true,
    }],
  }, "# Themes verification\n");
  writeDoc(repo, "docs/knowledge/0001-themes.md", {
    id: "KNOW-0001", type: "knowledge", status: "confirmed", title: "Renderer notes",
    knowledge_kind: "lesson",
    relations: { informs: ["DESIGN-0001"] },
  }, "# Renderer notes\n");
  initGit(repo);
  const runId = "RUN-markwright-01";
  createRun(repo, {
    runId,
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-themes.md"],
    plan: "# Themes\n\n- implement h1 rendering\n",
    tasks: [{ taskId: "TASK-0001", title: "implement h1 rendering", status: "todo" }],
  });
  approvePlan(repo, runId, { actor: "operator" });
  updateTask(repo, runId, "TASK-0001", { status: "done", title: "implement h1 rendering" }, { expectedVersion: 1 });
  recordCheckpoint(repo, runId, { checkpointId: "CHK-atlas-1", edgeId: "task-graph-to-implementation" });
  recordCheckpoint(repo, runId, { checkpointId: "CHK-atlas-2", edgeId: "implementation-to-verification" });
}

const BUILDERS: Record<string, (repo: string) => void> = {
  river: envRiver,
  harbor: envHarbor,
  quarry: envQuarry,
  atlas: envAtlas,
};

function snapshotTree(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (relPath === ".git" || relPath.startsWith(".git/")) continue;
      if (entry.isDirectory()) visit(abs, relPath);
      else if (entry.isFile()) out[relPath] = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    }
  };
  visit(repo, "");
  return out;
}

function main(): void {
  const [env, targetArg, snapshotArg] = process.argv.slice(2);
  const builder = BUILDERS[env];
  if (!builder || !targetArg) {
    console.error("usage: materialize_env.ts <river|harbor|quarry|atlas> <targetDir> [snapshotFile]");
    process.exit(2);
  }
  const target = path.resolve(targetArg);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`target ${target} is not empty`);
  }
  fs.mkdirSync(target, { recursive: true });
  builder(target);
  if (snapshotArg) {
    fs.mkdirSync(path.dirname(path.resolve(snapshotArg)), { recursive: true });
    fs.writeFileSync(path.resolve(snapshotArg), JSON.stringify(snapshotTree(target), null, 2), "utf8");
  }
  console.log(JSON.stringify({ env, target: path.relative(process.cwd(), target) }));
}

main();
