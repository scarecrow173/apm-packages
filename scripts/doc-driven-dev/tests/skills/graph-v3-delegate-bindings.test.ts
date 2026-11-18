import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadGraphDefinition } from "../../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { docTypes } from "../../src/skills/lib/doc_types";

const skillRoot = path.resolve(__dirname, "../../../../packages/doc-driven-dev/.apm/skills");
const graphPath = path.join(skillRoot, "doc-driven-dev-graph", "graphs", "doc-driven-dev.yaml");

// Issue #244: every Graph v3 delegate/audit binding must resolve to a real
// skill directory or a real CLI script — never a name that only exists in
// the definition. Script delegates (`scaffold_docs`, `build_task_graph`)
// resolve to `doc-driven-dev-graph/scripts/<name>.js`; skill delegates
// resolve to `.apm/skills/<name>/SKILL.md`. Audit names resolve to durable
// Document Registry 3 scopes plus `all` — execution-bound (`plan`, `task`)
// and legacy (`test-spec`, `impl`, `exp`) scopes are refused.

const SCRIPT_DELEGATES = new Set(["scaffold_docs", "build_task_graph"]);
const REFUSED_AUDIT_SCOPES = new Set(["plan", "task", "test-spec", "impl", "exp", "impl-record", "experiment-log"]);

test("every graph delegate resolves to a real skill or CLI", () => {
  const definition = loadGraphDefinition(graphPath);
  const delegates = [...new Set(
    Object.values(definition.nodes)
      .map((node) => node.delegate)
      .filter((delegate): delegate is string => Boolean(delegate)),
  )].sort();
  assert.ok(delegates.length > 0, "definition declares no delegates");

  for (const delegate of delegates) {
    if (SCRIPT_DELEGATES.has(delegate)) {
      const script = path.join(skillRoot, "doc-driven-dev-graph", "scripts", `${delegate}.js`);
      assert.ok(fs.existsSync(script), `delegate ${delegate} requires ${script}`);
      continue;
    }
    const skill = path.join(skillRoot, delegate, "SKILL.md");
    const skillJa = path.join(skillRoot, delegate, "SKILL.ja.md");
    assert.ok(fs.existsSync(skill), `delegate ${delegate} requires skill ${skill}`);
    assert.ok(fs.existsSync(skillJa), `delegate ${delegate} requires skill ${skillJa}`);
  }
});

test("every declared audit name resolves to a durable registry scope", () => {
  const definition = loadGraphDefinition(graphPath);
  const audits = [...new Set(
    Object.values(definition.nodes).flatMap((node) => node.audits ?? []),
  )].sort();
  assert.ok(audits.length > 0, "definition declares no audits");

  const durableScopes = new Set<string>([...docTypes, "all"]);
  for (const audit of audits) {
    assert.ok(durableScopes.has(audit), `audit scope ${audit} is not a durable registry type or 'all'`);
    assert.ok(!REFUSED_AUDIT_SCOPES.has(audit), `audit scope ${audit} is execution-bound or legacy — refused under v3`);
  }
});

test("migrate_docs stays unreachable through graph delegates", () => {
  const definition = loadGraphDefinition(graphPath);
  for (const node of Object.values(definition.nodes)) {
    assert.notEqual(node.delegate, "migrate_docs", "v3 declares no migration node");
  }
});
