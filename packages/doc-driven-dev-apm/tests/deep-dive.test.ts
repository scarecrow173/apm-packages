const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("deep-dive skill exists in both locales", () => {
  const en = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/deep-dive/SKILL.md"), "utf8");
  const ja = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/deep-dive/SKILL.ja.md"), "utf8");

  assert.match(en, /^name: deep-dive$/m);
  assert.match(ja, /^name: deep-dive$/m);
  assert.match(en, /Ask one question at a time/i);
  assert.match(en, /If a question can be answered by exploring the codebase/i);
  assert.match(ja, /質問は一度に 1 つだけ行う/);
  assert.match(ja, /先にコードベースを調べる/);
  assert.doesNotMatch(ja, /brainstorming/i);
});

test("adr-doc keeps core workflow while delegating deeper clarification", () => {
  const adr = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/adr-doc/SKILL.md"), "utf8");

  assert.match(adr, /deep-dive/);
  assert.match(adr, /ADR Missing Inputs/);
  assert.match(adr, /Emergency Fix Scenario/);
  assert.match(adr, /Proactive ADR Triggers/);
  assert.match(adr, /Post-Acceptance Lifecycle/);
  assert.doesNotMatch(adr, /Full Socratic Interview/i);
});
