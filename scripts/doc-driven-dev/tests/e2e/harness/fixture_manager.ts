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
import {
  approvePlan,
  createRun,
  initStateRoot,
  loadRun,
  updateTask,
} from "../../../src/skills/lib/execution_store";

/**
 * The deterministic Execution Store run every fixture carries (Issue #237):
 * the run's plan.md + task records are the graph's authority; the legacy
 * docs/plans + docs/tasks files remain on disk as a pre-v3 corpus —
 * inventory the projection must never consult. `E2E_RUN_FOCUS` binds the
 * run to the default spec/adr/design chain (a manifest focus is a list of
 * artifact paths inside the focused chain).
 */
export const E2E_RUN_ID = "e2e-run";
export const E2E_PLAN_CONTENT = "# Plan\n\n- implement the graph\n";
export const E2E_RUN_FOCUS = ["docs/designs/0001-graph.md"];

/**
 * Canonical doc-bearing directories (front-matter artifacts live here).
 * Registry 3: the durable tree is idea/discovery/spec/design/adr/knowledge/
 * verification; plan/task/test-spec/impl artifacts remain on disk as
 * execution-bound and legacy migration-owned content until the Execution
 * Store lands (Issue #234).
 */
export const CANONICAL_DIRS = [
  "docs/specs",
  "docs/adr",
  "docs/designs",
  "docs/plans",
  "docs/test-specs",
  "docs/tasks",
  "docs/impl/ir",
  "docs/knowledge",
  "docs/verification",
];

/**
 * Directories the bootstrap gate requires (durable CANONICAL_DOC_DIRS) plus
 * the legacy dirs the default artifact set writes into. The "." workspace
 * fingerprint scans the full historical CANONICAL_DOC_DIRS union.
 */
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
  "docs/knowledge",
  "docs/verification",
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
  // The Execution Store boundary refuses state writes unless the root is
  // ignore-covered — the fixture declares the same entry `init` writes.
  fs.writeFileSync(
    path.join(repo, ".gitignore"),
    "# doc-driven-dev execution state — per-worktree, never committed\n/.apm/state/\n",
    "utf8",
  );
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

export function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  // Store records are Git-ignored, so an evidence commit can legitimately be
  // empty — still advance HEAD so the commit gate observes the commit.
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "checkpoint", "--allow-empty"]);
}

/**
 * Add one task to an existing fixture: the legacy corpus doc (inventory,
 * never consulted) plus the authoritative task record in the run.
 */
export function addTask(repo: string, index: number, status: TaskStatus = "todo", runId: string = E2E_RUN_ID): void {
  const id = `TASK-${String(index).padStart(4, "0")}`;
  writeArtifact(repo, `docs/tasks/${String(index).padStart(4, "0")}-task.md`, {
    id, type: "task", status, title: id,
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  const current = loadRun(repo, runId).tasks.find((task) => task.taskId === id);
  updateTask(repo, runId, id, { title: id, status }, { expectedVersion: current?.version });
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
      frontmatter: {
        id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
        // Knowledge Relations v1: the stored ADR edge is adr → design.
        relations: { "decides-for": ["DESIGN-0001"] },
      },
      body: "# Graph\n\n## Considered Options\n\n### A\n\n### B\n",
    },
    "docs/designs/0001-graph.md": {
      frontmatter: {
        id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
        relations: { realizes: ["SPEC-0001"] },
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

/**
 * Seed the run's Execution Store task records from the fixture's task docs.
 * Under Registry 3 the Dynamic Task Graph projects only the selected run's
 * store records — `docs/tasks` Markdown is corpus history the projection
 * never reads (Issue #243). The fixture merely reuses each doc's id/status
 * as the seed for one v1 record, so `execution-task` input bindings resolve
 * against task records inside the bound run.
 */
export function fixtureTaskSeeds(repo: string): Array<{ taskId: string; status: TaskStatus }> {
  const dir = path.join(repo, "docs/tasks");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => {
      const data = matter(fs.readFileSync(path.join(dir, file), "utf8")).data;
      return { taskId: data.id as string, status: (data.status ?? "todo") as TaskStatus };
    });
}

export const VERIFICATION_DOC = "docs/verification/0001-graph.md";
export const VERIFICATION_DOC_SPEC: DocSpec = {
  // Registry 3 durable successor to legacy test-spec verification intent —
  // the `verification` audit's durable scope. It declares NO checks, so the
  // auto-computed Verification Summary verifies vacuously once every
  // selected task is done, and it declares NO stored relation — `verifies`
  // is a pre-v1 spelling whose projection surfaces as a
  // `legacy-relation-field` knowledge issue (a hard blocker).
  frontmatter: {
    id: "VD-0001", type: "verification", status: "approved", title: "Graph",
  },
  body: "# Graph\n",
};

/**
 * The durable knowledge record the `knowledge` audit and `knowledge-doc`
 * delegate bind. `knowledge_kind` is a required field (Registry 3); the
 * stored `informs` edge is Knowledge Relations v1.
 */
export const KNOWLEDGE_DOC = "docs/knowledge/0001-graph.md";
export const KNOWLEDGE_DOC_SPEC: DocSpec = {
  frontmatter: {
    id: "KNOW-0001", type: "knowledge", status: "confirmed", title: "Graph Knowledge",
    knowledge_kind: "lesson",
    relations: { informs: ["DESIGN-0001"] },
  },
  body: "# Graph Knowledge\n",
};

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
  taskScopes?: string[][];
  secondPlan?: boolean;
  /**
   * Write the Registry 3 verification document the `verification` audit's
   * durable scope binds. Off by default: corpus consumers (lifecycle stats)
   * pin fixtures that predate the verification type.
   */
  verificationDoc?: boolean;
  /**
   * Write the Registry 3 durable knowledge record the `knowledge` audit and
   * `knowledge-doc` delegate bind. Off by default for the same reason.
   */
  knowledgeDoc?: boolean;
  /** Default true: canonical dirs + README indexes. */
  scaffoldDirs?: boolean;
  /**
   * Execution Store run (Issue #237): default true — the fixture materializes
   * `runId` with `plan.md`, the task records parameterized by
   * taskStatuses/dependsOn/taskScopes, and a digest-bound approval unless
   * `planApproved` is false. Set false for a repo with no run at all.
   */
  run?: boolean;
  runId?: string;
  /** Manifest focus — artifact paths inside the focused chain. */
  runFocus?: string[];
  /** plan.md content for the run. */
  planContent?: string;
  /** Default true: approvePlan binds the current digest. */
  planApproved?: boolean;
  /**
   * Raw files written inside `runs/<runId>/` AFTER createRun — the only way
   * to materialize corrupt state the write API would refuse (e.g. two
   * records claiming one taskId for `duplicate-task-id`).
   */
  runFiles?: Record<string, string>;
} = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-e2e-"));
  if (options.scaffoldDirs !== false) {
    for (const directory of SCAFFOLD_DIRS) {
      fs.mkdirSync(path.join(repo, directory), { recursive: true });
      fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
    }
  }
  const docs: Record<string, DocSpec | string> = defaultDocs(options);
  if (options.verificationDoc) docs[VERIFICATION_DOC] = VERIFICATION_DOC_SPEC;
  if (options.knowledgeDoc) docs[KNOWLEDGE_DOC] = KNOWLEDGE_DOC_SPEC;
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
  if (options.run !== false) {
    // .apm/state/ ignore coverage must exist before the baseline commit so
    // the fixture's tree stays clean; the run itself is written afterwards.
    initStateRoot(repo);
  }
  gitInit(repo);
  if (options.run !== false) {
    const runId = options.runId ?? E2E_RUN_ID;
    const statuses = options.taskStatuses ?? ["todo"];
    createRun(repo, {
      runId,
      graphId: "doc-driven-dev",
      focus: options.runFocus ?? E2E_RUN_FOCUS,
      plan: options.planContent ?? E2E_PLAN_CONTENT,
      tasks: statuses.map((status, index) => {
        const taskId = `TASK-${String(index + 1).padStart(4, "0")}`;
        return {
          taskId,
          title: taskId,
          status,
          dependsOn: options.dependsOn?.[index],
          scope: options.taskScopes?.[index],
        };
      }),
    });
    if (options.planApproved !== false) {
      approvePlan(repo, runId, { actor: "e2e" });
    }
    for (const [rel, content] of Object.entries(options.runFiles ?? {})) {
      const file = path.join(repo, ".apm", "state", "doc-driven-dev", "runs", runId, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    }
  }
  return repo;
}
