import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard skill points at the distributed graph CLI in both languages", () => {
  const root = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

  for (const name of ["SKILL.md", "SKILL.ja.md"]) {
    const text = fs.readFileSync(path.join(root, "doc-dashboard", name), "utf8");
    assert.match(text, /name: doc-dashboard/);
    assert.match(text, /\.\.\/doc-driven-dev-graph\/scripts\/build_dashboard\.js/);
    assert.match(text, /--current/);
    assert.match(text, /--force/);
  }

  assert.ok(
    fs.existsSync(path.join(root, "doc-driven-dev-graph/scripts/build_dashboard.js")),
  );
});
