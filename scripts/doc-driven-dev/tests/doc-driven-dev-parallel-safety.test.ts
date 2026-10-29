import assert from "node:assert/strict";
import test from "node:test";
import type { TaskGraphResult } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";
import {
  evaluateParallelSafety,
  parseAffectedFiles,
} from "../src/skills/implementation-flow/scripts/lib/parallel_safety";

function taskGraph(overrides: Partial<TaskGraphResult> = {}): TaskGraphResult {
  return {
    schemaVersion: 1,
    plan: "docs/plans/0001-plan.md",
    nodes: [],
    edges: [],
    runnable: [],
    active: [],
    resumableActive: [],
    completed: [],
    blocked: [],
    issues: [],
    ...overrides,
  };
}

function taskBody(affectedFiles: string | null): string {
  if (affectedFiles === null) return "# Task\n\n## Verification\n\n- [ ] node --test\n";
  return `# Task\n\n## Affected Files\n\n${affectedFiles}\n\n## Verification\n\n- [ ] node --test\n`;
}

function serialReasons(report: ReturnType<typeof evaluateParallelSafety>, id: string): string[] {
  return report.serial.find((entry) => entry.id === id)?.reasons ?? [];
}

// --- parseAffectedFiles ---------------------------------------------------

test("parseAffectedFiles returns null when the Affected Files section is absent", () => {
  assert.equal(parseAffectedFiles(taskBody(null)), null);
  assert.equal(parseAffectedFiles("# Task\n"), null);
});

test("parseAffectedFiles parses a file entry", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("- src/foo.ts")), [
    { pattern: { kind: "file", path: "src/foo.ts" } },
  ]);
});

test("parseAffectedFiles parses trailing-slash and glob-star entries as dirs", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("- src/auth/")), [
    { pattern: { kind: "dir", path: "src/auth" } },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- src/gen/*")), [
    { pattern: { kind: "dir", path: "src/gen" } },
  ]);
});

test("parseAffectedFiles marks non-path text as opaque", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("- auth module")), [
    { opaque: "auth module" },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- README")), [
    { opaque: "README" },
  ]);
});

test("parseAffectedFiles strips HTML comment lines and comment-only placeholders", () => {
  const body = taskBody("<!-- section note -->\n- <!-- file, directory, module, or interface -->\n- src/real.ts");
  assert.deepEqual(parseAffectedFiles(body), [
    { pattern: { kind: "file", path: "src/real.ts" } },
  ]);
});

test("parseAffectedFiles returns an empty list for a present-but-empty section", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("")), []);
  assert.deepEqual(parseAffectedFiles(taskBody("\n")), []);
});

test("parseAffectedFiles normalizes ./ prefixes and backslashes", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("- ./src/x.ts")), [
    { pattern: { kind: "file", path: "src/x.ts" } },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- src\\auth\\login.ts")), [
    { pattern: { kind: "file", path: "src/auth/login.ts" } },
  ]);
});

test("parseAffectedFiles marks absolute paths and .. escapes as opaque", () => {
  assert.deepEqual(parseAffectedFiles(taskBody("- /etc/passwd")), [
    { opaque: "/etc/passwd" },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- C:/temp/x.ts")), [
    { opaque: "C:/temp/x.ts" },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- ../outside.ts")), [
    { opaque: "../outside.ts" },
  ]);
  assert.deepEqual(parseAffectedFiles(taskBody("- src/../outside.ts")), [
    { opaque: "src/../outside.ts" },
  ]);
});

// --- evaluateParallelSafety -------------------------------------------------

test("two runnable tasks with disjoint scopes run in parallel", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- src/foo.ts") },
      { id: "TASK-0002", body: taskBody("- src/bar.ts") },
    ],
  );
  assert.equal(report.decision, "parallel");
  assert.deepEqual(report.eligible, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(report.parallel, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(report.serial, []);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.taskGraphIssues, []);
});

test("the same file declared by two tasks is a write conflict on both sides", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- src/shared.ts") },
      { id: "TASK-0002", body: taskBody("- src/shared.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.parallel, []);
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/shared.ts" }]);
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["write-conflict"]);
  assert.deepEqual(serialReasons(report, "TASK-0002"), ["write-conflict"]);
});

test("a dir pattern overlapping another task's file is a write conflict", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- src/") },
      { id: "TASK-0002", body: taskBody("- src/auth/login.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/auth/login.ts" }]);
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["write-conflict"]);
  assert.deepEqual(serialReasons(report, "TASK-0002"), ["write-conflict"]);
});

test("nested dir patterns conflict in either direction", () => {
  for (const [first, second] of [["- src/", "- src/auth/"], ["- src/auth/", "- src/"]] as const) {
    const report = evaluateParallelSafety(
      taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
      [
        { id: "TASK-0001", body: taskBody(first) },
        { id: "TASK-0002", body: taskBody(second) },
      ],
    );
    assert.equal(report.decision, "serial");
    assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/auth" }]);
  }
});

test("resumableActive takes priority over runnable for eligibility", () => {
  const report = evaluateParallelSafety(
    taskGraph({
      runnable: ["TASK-0001", "TASK-0003"],
      resumableActive: ["TASK-0002"],
      active: ["TASK-0002"],
    }),
    [
      { id: "TASK-0001", body: taskBody("- src/a.ts") },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
      { id: "TASK-0003", body: taskBody("- src/c.ts") },
    ],
  );
  assert.deepEqual(report.eligible, ["TASK-0002"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
  assert.equal(report.decision, "serial");
});

test("a non-empty task graph issue list blocks the whole evaluation", () => {
  const report = evaluateParallelSafety(
    taskGraph({
      runnable: ["TASK-0001", "TASK-0002"],
      issues: [{ code: "task-cycle", message: "Task dependency cycle detected: TASK-0001 -> TASK-0002", tasks: ["TASK-0001", "TASK-0002"] }],
    }),
    [
      { id: "TASK-0001", body: taskBody("- src/a.ts") },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
    ],
  );
  assert.equal(report.decision, "blocked");
  assert.deepEqual(report.eligible, []);
  assert.deepEqual(report.parallel, []);
  assert.deepEqual(report.serial, []);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.taskGraphIssues, ["task-cycle"]);
});

test("a task without an Affected Files section is serial scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody(null) },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("an empty Affected Files section is also scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- <!-- file, directory -->") },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
});

test("an eligible task missing from the tasks map is scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [{ id: "TASK-0002", body: taskBody("- src/b.ts") }],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("an opaque entry makes the task serial scope-unverifiable", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- auth module") },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-unverifiable"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("an unverifiable path escape also counts as scope-unverifiable", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- src/a.ts\n- ../escape.ts") },
      { id: "TASK-0002", body: taskBody("- src/b.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-unverifiable"]);
});

test("with three tasks only the conflicting pair goes serial", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002", "TASK-0003"] }),
    [
      { id: "TASK-0001", body: taskBody("- src/shared.ts") },
      { id: "TASK-0002", body: taskBody("- src/shared.ts") },
      { id: "TASK-0003", body: taskBody("- docs/other.md") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.parallel, ["TASK-0003"]);
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["write-conflict"]);
  assert.deepEqual(serialReasons(report, "TASK-0002"), ["write-conflict"]);
  assert.deepEqual(serialReasons(report, "TASK-0003"), []);
});

test("a single clean eligible task cannot run in parallel", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001"] }),
    [{ id: "TASK-0001", body: taskBody("- src/a.ts") }],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.parallel, ["TASK-0001"]);
  assert.deepEqual(report.serial, []);
});

test("normalized paths still conflict across differing spellings", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", body: taskBody("- ./src/shared.ts") },
      { id: "TASK-0002", body: taskBody("- src\\shared.ts") },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/shared.ts" }]);
});
