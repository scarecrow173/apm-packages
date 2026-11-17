import assert from "node:assert/strict";
import test from "node:test";
import type { TaskGraphResult } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";
import { evaluateParallelSafety } from "../src/skills/implementation-flow/scripts/lib/parallel_safety";
import {
  scopeFromEntries,
  toScopeEntry,
} from "../src/skills/implementation-flow/scripts/lib/scope_entry";

function taskGraph(overrides: Partial<TaskGraphResult> = {}): TaskGraphResult {
  return {
    schemaVersion: 2,
    runId: "run-0001",
    plan: { path: "runs/run-0001/plan.md", digest: "a".repeat(64), approved: true },
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

function serialReasons(report: ReturnType<typeof evaluateParallelSafety>, id: string): string[] {
  return report.serial.find((entry) => entry.id === id)?.reasons ?? [];
}

// --- scope-entry classification (scope_entry.ts — the shared authority) ----
//
// Task records carry raw scope strings — the same vocabulary the v2
// `## Affected Files` bullets did. `toScopeEntry`/`scopeFromEntries` are the
// one place that vocabulary classifies; these tests pin the contract both
// parallel_safety and merge_verification consume.

test("toScopeEntry resolves a file entry", () => {
  assert.deepEqual(toScopeEntry("src/foo.ts"), {
    pattern: { kind: "file", path: "src/foo.ts" },
  });
});

test("toScopeEntry resolves trailing-slash and glob-star entries as dirs", () => {
  assert.deepEqual(toScopeEntry("src/auth/"), {
    pattern: { kind: "dir", path: "src/auth" },
  });
  assert.deepEqual(toScopeEntry("src/gen/*"), {
    pattern: { kind: "dir", path: "src/gen" },
  });
});

test("toScopeEntry marks non-path text as opaque", () => {
  assert.deepEqual(toScopeEntry("auth module"), { opaque: "auth module" });
  assert.deepEqual(toScopeEntry("README"), { opaque: "README" });
});

test("toScopeEntry normalizes ./ prefixes and backslashes", () => {
  assert.deepEqual(toScopeEntry("./src/x.ts"), {
    pattern: { kind: "file", path: "src/x.ts" },
  });
  assert.deepEqual(toScopeEntry("src\\auth\\login.ts"), {
    pattern: { kind: "file", path: "src/auth/login.ts" },
  });
});

test("toScopeEntry marks absolute paths and .. escapes as opaque", () => {
  assert.deepEqual(toScopeEntry("/etc/passwd"), { opaque: "/etc/passwd" });
  assert.deepEqual(toScopeEntry("C:/temp/x.ts"), { opaque: "C:/temp/x.ts" });
  assert.deepEqual(toScopeEntry("../outside.ts"), { opaque: "../outside.ts" });
  assert.deepEqual(toScopeEntry("src/../outside.ts"), { opaque: "src/../outside.ts" });
});

test("toScopeEntry turns markup-wrapped entries opaque instead of fake patterns", () => {
  assert.deepEqual(toScopeEntry("{{src/x.ts}}"), { opaque: "{{src/x.ts}}" });
  assert.deepEqual(toScopeEntry("[link](src/x.ts)"), { opaque: "[link](src/x.ts)" });
  assert.deepEqual(toScopeEntry("src/<module>.ts"), { opaque: "src/<module>.ts" });
  assert.deepEqual(toScopeEntry("src/`gen`/x.ts"), { opaque: "src/`gen`/x.ts" });
});

test("scopeFromEntries returns null for an absent scope declaration", () => {
  assert.equal(scopeFromEntries(undefined), null);
});

test("scopeFromEntries resolves a record scope list into patterns and opacity", () => {
  assert.deepEqual(scopeFromEntries(["src/foo.ts", "src/auth/"]), {
    patterns: [
      { kind: "file", path: "src/foo.ts" },
      { kind: "dir", path: "src/auth" },
    ],
    hasOpaque: false,
  });
  assert.deepEqual(scopeFromEntries(["src/foo.ts", "auth module"]), {
    patterns: [{ kind: "file", path: "src/foo.ts" }],
    hasOpaque: true,
  });
});

test("scopeFromEntries skips empty entries and unwraps one code span", () => {
  assert.deepEqual(scopeFromEntries([]), { patterns: [], hasOpaque: false });
  assert.deepEqual(scopeFromEntries(["", "  "]), { patterns: [], hasOpaque: false });
  assert.deepEqual(scopeFromEntries(["`src/auth/`"]), {
    patterns: [{ kind: "dir", path: "src/auth" }],
    hasOpaque: false,
  });
});

// --- evaluateParallelSafety -------------------------------------------------
//
// The evaluator consumes the run projection's graph + each task record's
// `scope` field (Issue #237) — never Markdown task bodies.

test("two runnable tasks with disjoint scopes run in parallel", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["src/foo.ts"] },
      { id: "TASK-0002", scope: ["src/bar.ts"] },
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
      { id: "TASK-0001", scope: ["src/shared.ts"] },
      { id: "TASK-0002", scope: ["src/shared.ts"] },
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
      { id: "TASK-0001", scope: ["src/"] },
      { id: "TASK-0002", scope: ["src/auth/login.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/auth/login.ts" }]);
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["write-conflict"]);
  assert.deepEqual(serialReasons(report, "TASK-0002"), ["write-conflict"]);
});

test("nested dir patterns conflict in either direction", () => {
  for (const [first, second] of [["src/", "src/auth/"], ["src/auth/", "src/"]] as const) {
    const report = evaluateParallelSafety(
      taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
      [
        { id: "TASK-0001", scope: [first] },
        { id: "TASK-0002", scope: [second] },
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
      { id: "TASK-0001", scope: ["src/a.ts"] },
      { id: "TASK-0002", scope: ["src/b.ts"] },
      { id: "TASK-0003", scope: ["src/c.ts"] },
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
      { id: "TASK-0001", scope: ["src/a.ts"] },
      { id: "TASK-0002", scope: ["src/b.ts"] },
    ],
  );
  assert.equal(report.decision, "blocked");
  assert.deepEqual(report.eligible, []);
  assert.deepEqual(report.parallel, []);
  assert.deepEqual(report.serial, []);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.taskGraphIssues, ["task-cycle"]);
});

test("a task record with no scope field is serial scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001" },
      { id: "TASK-0002", scope: ["src/b.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("an empty scope declaration is also scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: [] },
      { id: "TASK-0002", scope: ["src/b.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
});

test("an eligible task missing from the tasks map is scope-undeclared", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [{ id: "TASK-0002", scope: ["src/b.ts"] }],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-undeclared"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
});

test("an opaque entry makes the task serial scope-unverifiable", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["auth module"] },
      { id: "TASK-0002", scope: ["src/b.ts"] },
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
      { id: "TASK-0001", scope: ["src/a.ts", "../escape.ts"] },
      { id: "TASK-0002", scope: ["src/b.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-unverifiable"]);
});

test("with three tasks only the conflicting pair goes serial", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002", "TASK-0003"] }),
    [
      { id: "TASK-0001", scope: ["src/shared.ts"] },
      { id: "TASK-0002", scope: ["src/shared.ts"] },
      { id: "TASK-0003", scope: ["docs/other.md"] },
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
    [{ id: "TASK-0001", scope: ["src/a.ts"] }],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.parallel, ["TASK-0001"]);
  assert.deepEqual(report.serial, []);
});

test("a markup-wrapped entry is scope-unverifiable, not a silently disjoint pattern", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["{{src/x.ts}}"] },
      { id: "TASK-0002", scope: ["src/x.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(serialReasons(report, "TASK-0001"), ["scope-unverifiable"]);
  assert.deepEqual(report.parallel, ["TASK-0002"]);
  assert.deepEqual(report.conflicts, []);
});

test("normalized paths still conflict across differing spellings", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["./src/shared.ts"] },
      { id: "TASK-0002", scope: ["src\\shared.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/shared.ts" }]);
});

test("a code-span-wrapped entry still verifies as a path", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["`src/a.ts`"] },
      { id: "TASK-0002", scope: ["src/a.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "src/a.ts" }]);
});

// --- case-folded path comparison -----------------------------------------------

test("declared paths conflict across case differences", () => {
  const report = evaluateParallelSafety(
    taskGraph({ runnable: ["TASK-0001", "TASK-0002"] }),
    [
      { id: "TASK-0001", scope: ["SRC/SHARED.TS"] },
      { id: "TASK-0002", scope: ["src/shared.ts"] },
    ],
  );
  assert.equal(report.decision, "serial");
  assert.deepEqual(report.conflicts, [{ a: "TASK-0001", b: "TASK-0002", path: "SRC/SHARED.TS" }]);
});
