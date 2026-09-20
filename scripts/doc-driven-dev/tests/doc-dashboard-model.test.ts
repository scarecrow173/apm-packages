import assert from "node:assert/strict";
import test from "node:test";

import { documentBucket, summarizeTasks } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model";

test("wont-do and invalid status are not completion", () => {
  assert.deepEqual(summarizeTasks([
    { path: "a.md", status: "done" },
    { path: "b.md", status: "wont-do" },
    { path: "c.md", status: "todo" },
    { path: "d.md", status: "in-progress" },
    { path: "e.md", status: "blocked" },
    { path: "f.md", status: "draft" },
    { path: "c.md", status: "todo" },
  ]), { total: 5, done: 1, wontDo: 1, remaining: 3, unknown: 1, doneRatio: 0.2 });
  assert.equal(summarizeTasks([]).doneRatio, null);
  assert.equal(documentBucket("draft"), "draft");
  assert.equal(documentBucket("proposed"), "proposed");
  assert.equal(documentBucket("capturing"), "capturing");
  assert.equal(documentBucket(null), "other");
});
