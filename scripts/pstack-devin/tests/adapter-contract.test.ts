import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VOCABULARY } from "../src/compat-vocabulary.js";

// The generated devin-plugin/docs/harness/devin.md only appears after Task
// 5's rebuild, so the contract reads the overlay SOURCE file.
const OVERLAY = join(__dirname, "../../../packages/pstack-devin/overlay");

test("devin.md exists in overlay with required contract rows", () => {
  const doc = readFileSync(join(OVERLAY, "docs/harness/devin.md"), "utf8");
  for (const row of [
    "run_subagent", "ask_user_question", "todo_write",
    "subagent_general", "subagent_explore", "pstack:poteto-agent", "pstack:comment-sicko",
    "is_background", "resume", "file_attachments", "environment", "cloud",
    "sidekick", "deslop", "control-cli", "control-ui",
    ".devin-plugin/plugin.json", "pstack-models.md", "/pstack:",
  ]) assert.ok(doc.includes(row), `missing row: ${row}`);
  assert.match(doc, /this file is the adapter of record/i);
  assert.match(doc, /Devin never reads \.claude paths or CLAUDE\.md/i);
  assert.match(doc, /unless the user invoked a pstack skill/i);
  assert.match(doc, /ERROR|error/, "unsupported-required policy present");
  assert.match(doc, /skip/i, "skip policy present");
  assert.match(doc, /alternative|Fallback/i, "alternative policy present");
});

test("every classified vocabulary label has a row in devin.md", () => {
  const doc = readFileSync(join(OVERLAY, "docs/harness/devin.md"), "utf8")
    .toLowerCase();
  for (const entry of VOCABULARY) {
    if (entry.cls === "devin-only") continue;
    const candidates = [
      /→\s*([^\s;,)]+)/.exec(entry.note)?.[1],
      entry.label.split(":")[1],
    ].filter((c): c is string => typeof c === "string" && c.length > 0);
    assert.ok(
      candidates.some((c) => doc.includes(c.toLowerCase())),
      `no devin.md row covers ${entry.label} (checked: ${candidates.join(", ")})`,
    );
  }
});
