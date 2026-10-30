/**
 * Fixture manager for the deterministic e2e harness. Each case gets a fresh
 * temp repository with canonical doc scaffolding, deterministic artifact
 * front matter (fixed ids/statuses/dates — no wall-clock values), and real
 * git history. Git commands only ever run inside the fixture repo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import type { TaskStatus } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

/**
 * Canonical doc-bearing directories (front-matter artifacts live here).
 * NOTE: the full scaffold (`SCAFFOLD_DIRS` below) is wider — the bootstrap
 * gate and the "." workspace fingerprint also require docs/ideas,
 * docs/discovery, and docs/impl/exp, so scaffolding always creates all ten.
 */
export const CANONICAL_DIRS = [
  "docs/specs",
  "docs/adr",
  "docs/designs",
  "docs/plans",
  "docs/test-specs",
  "docs/tasks",
  "docs/impl/ir",
];

/** Directories the bootstrap gate fingerprints (artifact CANONICAL_DOC_DIRS). */
const SCAFFOLD_DIRS = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
];

export type DocSpec = { frontmatter: Record<string, unknown>; body: string };

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function writeArtifact(repo: string, rel: string, data: Record<string, unknown>, body: string): void {
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

/** Merge front matter, keep body. */
export function updateArtifact(repo: string, rel: string, data: Record<string, unknown>): void {
  const file = path.join(repo, rel);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, ...data }), "utf8");
}

export function gitInit(repo: string): void {
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

export function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "checkpoint"]);
}

/** Add one task document to an existing fixture (oracle addTask, verbatim). */
export function addTask(repo: string, index: number, status: TaskStatus = "todo"): void {
  const id = `TASK-${String(index).padStart(4, "0")}`;
  writeArtifact(repo, `docs/tasks/${String(index).padStart(4, "0")}-task.md`, {
    id, type: "task", status, title: id,
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
}

/**
 * The oracle `fixtureRepo` default document set (run-to-yield lines 587–636),
 * parameterized by task statuses / dependencies / optional second plan.
 */
function defaultDocs(options: {
  taskStatuses?: TaskStatus[];
  dependsOn?: string[][];
  secondPlan?: boolean;
}): Record<string, DocSpec> {
  const docs: Record<string, DocSpec> = {
    "docs/specs/0001-graph.md": {
      frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Graph" },
      body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n",
    },
    "docs/adr/0001-graph.md": {
      frontmatter: { id: "ADR-0001", type: "adr", status: "accepted", title: "Graph" },
      body: "# Graph\n\n## Considered Options\n\n### A\n\n### B\n",
    },
    "docs/designs/0001-graph.md": {
      frontmatter: {
        id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
        relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
      },
      body: "# Graph\n",
    },
    "docs/plans/0001-graph.md": {
      frontmatter: {
        id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
        relations: { "derives-from": ["DESIGN-0001"], "verified-by": ["docs/test-specs/0001-graph.md"] },
      },
      body: "# Graph\n",
    },
    "docs/test-specs/0001-graph.md": {
      frontmatter: {
        id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Graph",
        relations: { verifies: ["SPEC-0001"] },
      },
      body: "# Graph\n",
    },
    "docs/impl/ir/0001-task.md": {
      frontmatter: {
        id: "IMPL-0001", type: "implementation-record", status: "complete", title: "Graph implementation",
      },
      body: "# Implementation Record\n",
    },
  };
  (options.taskStatuses ?? ["todo"]).forEach((status, index) => {
    const id = `TASK-${String(index + 1).padStart(4, "0")}`;
    docs[`docs/tasks/${String(index + 1).padStart(4, "0")}-task.md`] = {
      frontmatter: {
        id, type: "task", status, title: id,
        relations: {
          implements: ["docs/plans/0001-graph.md"],
          ...(options.dependsOn?.[index]?.length ? { "depends-on": options.dependsOn[index] } : {}),
        },
      },
      body: "# Task\n\n## Verification\n\n- [ ] node --test\n",
    };
  });
  if (options.secondPlan) {
    docs["docs/plans/0002-other.md"] = {
      frontmatter: {
        id: "PLAN-0002", type: "plan", status: "approved", title: "Other",
        relations: { "derives-from": ["DESIGN-0001"] },
      },
      body: "# Other\n",
    };
  }
  return docs;
}

export function createFixtureRepo(options: {
  /**
   * Applied over the default doc set: `DocSpec` writes an artifact with
   * canonical front-matter defaults, `string` writes raw file content, and
   * `null` removes a default doc entirely. Omit `files` for the standard
   * happy fixture (oracle fixtureRepo layout).
   */
  files?: Record<string, DocSpec | string | null>;
  taskStatuses?: TaskStatus[];
  dependsOn?: string[][];
  secondPlan?: boolean;
  /** Default true: canonical dirs + README indexes. */
  scaffoldDirs?: boolean;
} = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-e2e-"));
  if (options.scaffoldDirs !== false) {
    for (const directory of SCAFFOLD_DIRS) {
      fs.mkdirSync(path.join(repo, directory), { recursive: true });
      fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
    }
  }
  const docs: Record<string, DocSpec | string> = defaultDocs(options);
  for (const [rel, spec] of Object.entries(options.files ?? {})) {
    if (spec === null) delete docs[rel];
    else docs[rel] = spec;
  }
  for (const [rel, spec] of Object.entries(docs)) {
    const file = path.join(repo, rel);
    if (typeof spec === "string") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, spec, "utf8");
    } else {
      writeArtifact(repo, rel, spec.frontmatter, spec.body);
    }
  }
  gitInit(repo);
  return repo;
}
