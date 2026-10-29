import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { commitAll, createFixtureRepo } from "./e2e/harness/fixture_manager";
import type { TaskStatus } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

const CHECK_PARALLEL = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/implementation-flow/scripts/check_parallel.js",
);

const PLAN = "PLAN-0001";
const TASK_DOC = (index: number) => `docs/tasks/${String(index).padStart(4, "0")}-task.md`;
const TASK_ID = (index: number) => `TASK-${String(index).padStart(4, "0")}`;

type CliRun = { status: number | null; report: Record<string, unknown>; stderr: string };

function runCli(repo: string, args: string[]): CliRun {
  const result = spawnSync(
    process.execPath,
    [CHECK_PARALLEL, "--cwd", repo, "--json", ...args],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    assert.fail(`CLI stdout is not JSON (status ${result.status}): ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return { status: result.status, report, stderr: result.stderr };
}

function checkParallel(repo: string): CliRun {
  return runCli(repo, ["--plan", PLAN]);
}

function verifyMerge(repo: string, slices: unknown[], extraArgs: string[] = []): CliRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-parallel-slices-"));
  const file = path.join(dir, "slices.json");
  fs.writeFileSync(file, JSON.stringify(slices), "utf8");
  return runCli(repo, ["--verify-merge", file, ...extraArgs]);
}

/** Rewrite a task doc body while preserving the fixture's front matter. */
function setTaskBody(repo: string, index: number, body: string): void {
  const file = path.join(repo, TASK_DOC(index));
  const parsed = matter(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, matter.stringify(body, parsed.data), "utf8");
}

function scopedBody(entries: string[]): string {
  const items = entries.map((entry) => `- ${entry}`).join("\n");
  return `# Task\n\n## Affected Files\n\n${items}\n\n## Verification\n\n- [ ] node --test\n`;
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function serialIds(report: Record<string, unknown>): string[] {
  return (report.serial as Array<{ id: string }>).map((entry) => entry.id);
}

function serialReasons(report: Record<string, unknown>, id: string): string[] {
  const entry = (report.serial as Array<{ id: string; reasons: string[] }>).find((candidate) => candidate.id === id);
  return entry ? entry.reasons : [];
}

function scopeFixture(scopes: Record<number, string[]>, options: {
  taskStatuses?: TaskStatus[];
  dependsOn?: string[][];
} = {}): string {
  const count = Math.max(...Object.keys(scopes).map(Number),
    (options.taskStatuses ?? []).length, (options.dependsOn ?? []).length);
  const repo = createFixtureRepo({
    taskStatuses: options.taskStatuses ?? Array.from({ length: count }, () => "todo" as TaskStatus),
    ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
  });
  for (const [index, entries] of Object.entries(scopes)) {
    setTaskBody(repo, Number(index), scopedBody(entries));
    // Create the declared target files so scopes point at real paths.
    for (const entry of entries) {
      if (entry.endsWith("/") || entry.endsWith("/*") || !entry.includes(".")) continue;
      writeFile(repo, entry, "// fixture\n");
    }
  }
  return repo;
}

// --- default mode: eligibility + write-scope judgment -------------------------

test("eligible pair with disjoint scopes decides parallel and exits 0", () => {
  const repo = scopeFixture({ 1: ["src/alpha.ts"], 2: ["src/beta.ts"] });
  const { status, report, stderr } = checkParallel(repo);
  assert.equal(status, 0, stderr);
  assert.equal(report.decision, "parallel");
  assert.deepEqual(report.eligible, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(report.parallel, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(report.serial, []);
  assert.deepEqual(report.conflicts, []);
});

test("the same file in both scopes is a serial write-conflict and exits 1", () => {
  const repo = scopeFixture({ 1: ["src/shared.ts", "src/alpha.ts"], 2: ["src/shared.ts"] });
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.deepEqual(
    report.conflicts,
    [{ a: "TASK-0001", b: "TASK-0002", path: "src/shared.ts" }],
  );
  assert.ok(serialReasons(report, "TASK-0001").includes("write-conflict"));
  assert.ok(serialReasons(report, "TASK-0002").includes("write-conflict"));
});

test("a generated index declared by two tasks is a serial write-conflict", () => {
  const repo = scopeFixture({ 1: ["docs/tasks/README.md"], 2: ["docs/tasks/README.md"] });
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.ok(
    (report.conflicts as Array<{ path: string }>).some((conflict) => conflict.path === "docs/tasks/README.md"),
  );
  assert.deepEqual(serialIds(report).sort(), ["TASK-0001", "TASK-0002"]);
});

test("a dir pattern overlapping another task's file is a serial write-conflict", () => {
  const repo = scopeFixture({ 1: ["package-lock.json", "src/"], 2: ["src/auth/login.ts"] });
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.ok(
    (report.conflicts as Array<{ path: string }>).some((conflict) => conflict.path === "src/auth/login.ts"),
  );
  assert.ok(serialReasons(report, "TASK-0001").includes("write-conflict"));
  assert.ok(serialReasons(report, "TASK-0002").includes("write-conflict"));
});

test("an opaque scope entry is serial scope-unverifiable", () => {
  const repo = scopeFixture({ 1: ["auth module"], 2: ["src/beta.ts"] });
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.ok(serialReasons(report, "TASK-0001").includes("scope-unverifiable"));
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("a task without an Affected Files section is serial scope-undeclared", () => {
  const repo = scopeFixture({ 2: ["src/beta.ts"] });
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.ok(serialReasons(report, "TASK-0001").includes("scope-undeclared"));
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("a task whose dependsOn is unmet is absent from eligible", () => {
  const repo = scopeFixture(
    { 1: ["src/alpha.ts"], 2: ["src/beta.ts"], 3: ["src/gamma.ts"] },
    { dependsOn: [[], [], ["TASK-0001"]] },
  );
  const { status, report, stderr } = checkParallel(repo);
  assert.equal(status, 0, stderr);
  assert.equal(report.decision, "parallel");
  assert.deepEqual(report.eligible, ["TASK-0001", "TASK-0002"]);
  assert.ok(!(report.eligible as string[]).includes("TASK-0003"));
});

test("a resumable active task takes priority and runnable-only tasks are not eligible", () => {
  const repo = scopeFixture(
    { 1: ["src/alpha.ts"], 2: ["src/beta.ts"] },
    { taskStatuses: ["in-progress", "todo"] },
  );
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.eligible, ["TASK-0001"]);
  assert.ok(!(report.eligible as string[]).includes("TASK-0002"));
});

test("a task-graph issue (dependency cycle) fails closed to blocked", () => {
  const repo = scopeFixture(
    { 1: ["src/alpha.ts"], 2: ["src/beta.ts"] },
    { dependsOn: [["TASK-0002"], ["TASK-0001"]] },
  );
  const { status, report } = checkParallel(repo);
  assert.equal(status, 1);
  assert.equal(report.decision, "blocked");
  assert.ok((report.taskGraphIssues as string[]).includes("task-cycle"));
  assert.deepEqual(report.eligible, []);
  assert.deepEqual(report.parallel, []);
});

// --- --verify-merge mode ------------------------------------------------------

test("two clean slices verify to merge and exit 0", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "src/a.ts", "export const a = 1;\n");
  writeFile(repo, "src/auth/login.ts", "export const login = 1;\n");
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  writeFile(repo, "docs/impl/0002-evidence.md", "# Evidence\n\nTASK-0002 done.\n");
  const { status, report, stderr } = verifyMerge(repo, [
    {
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
      taskDocPath: TASK_DOC(1),
    },
    {
      taskId: "TASK-0002",
      declaredScope: ["src/auth/"],
      touchedPaths: ["src/auth/login.ts"],
      evidencePaths: ["docs/impl/0002-evidence.md"],
      taskDocPath: TASK_DOC(2),
    },
  ]);
  assert.equal(status, 0, stderr);
  assert.equal(report.verdict, "merge");
  assert.deepEqual(report.findings, []);
});

test("a slice without touchedPaths collects the real git diff", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0001 done.\n");
  commitAll(repo);
  writeFile(repo, "src/a.ts", "export const a = 1;\n");
  const { status, report, stderr } = verifyMerge(repo, [
    {
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
      taskDocPath: TASK_DOC(1),
    },
  ]);
  assert.equal(status, 0, stderr);
  assert.equal(report.verdict, "merge");
});

test("touching an undeclared task doc is blocked, exit 1", () => {
  const repo = createFixtureRepo();
  const { status, report } = verifyMerge(repo, [
    {
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts", "docs/tasks/0003-task.md"],
      evidencePaths: [],
      taskDocPath: TASK_DOC(1),
    },
  ]);
  assert.equal(status, 1);
  assert.equal(report.verdict, "blocked");
  const finding = (report.findings as Array<{ code: string; path?: string }>)[0];
  assert.equal(finding.code, "scope-violation");
  assert.equal(finding.path, "docs/tasks/0003-task.md");
});

test("two slices touching the same path yield merge-review, exit 1", () => {
  const repo = createFixtureRepo();
  const { status, report } = verifyMerge(repo, [
    {
      taskId: "TASK-0001",
      declaredScope: ["src/x.ts"],
      touchedPaths: ["src/x.ts"],
      evidencePaths: [],
      taskDocPath: TASK_DOC(1),
    },
    {
      taskId: "TASK-0002",
      declaredScope: ["src/x.ts"],
      touchedPaths: ["src/x.ts"],
      evidencePaths: [],
      taskDocPath: TASK_DOC(2),
    },
  ]);
  assert.equal(status, 1);
  assert.equal(report.verdict, "merge-review");
  assert.ok(
    (report.findings as Array<{ code: string; path?: string }>).some(
      (finding) => finding.code === "write-collision" && finding.path === "src/x.ts",
    ),
  );
});

test("evidence bound to another task's ID is a blocked evidence-mismatch", () => {
  const repo = createFixtureRepo();
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n\nTASK-0002 done.\n");
  const { status, report } = verifyMerge(repo, [
    {
      taskId: "TASK-0001",
      declaredScope: ["src/a.ts"],
      touchedPaths: ["src/a.ts"],
      evidencePaths: ["docs/impl/0001-evidence.md"],
      taskDocPath: TASK_DOC(1),
    },
  ]);
  assert.equal(status, 1);
  assert.equal(report.verdict, "blocked");
  const finding = (report.findings as Array<{ code: string; taskId?: string }>)[0];
  assert.equal(finding.code, "evidence-mismatch");
  assert.equal(finding.taskId, "TASK-0001");
});
