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

test("poteto-agent overwrite is Devin-native and preserves the read contract", () => {
  const doc = readFileSync(join(OVERLAY, "agents/poteto-agent.md"), "utf8");
  for (const row of [
    "name: poteto-agent",
    "model: claude-opus-5-5-xhigh-fast",
    "max-nesting: 3",
    "subagent_general",
    ".devin-plugin/plugin.json",
    "/pstack:poteto-mode",
    "run_subagent",
    "~/.config/devin/cli/plugins/",
    "%APPDATA%\\devin\\cli\\plugins\\",
    "~/.local/share/devin/cli/plugins/",
    // The full-read contract and its failure modes, preserved verbatim:
    "Reads the `poteto-mode` skill's `SKILL.md` in full",
    "Read the `poteto-mode` skill's `SKILL.md` in full",
    "highest `version`",
    "stop and tell your parent",
    "principle-*",
  ]) assert.ok(doc.includes(row), `missing row: ${row}`);
  for (const banned of [
    "~/.cursor",
    "generalPurpose",
    "is_background",
    ".cursor-plugin",
    "`/poteto-mode`",
  ]) assert.ok(!doc.includes(banned), `Cursor-ism survives: ${banned}`);
});

test("root AGENTS.md carries adapter pointer, precedence, and activation boundary", () => {
  const doc = readFileSync(join(OVERLAY, "AGENTS.md"), "utf8");
  // Hard-wrapped paragraphs: match on whitespace-flattened text.
  const flat = doc.replace(/\s+/g, " ");
  // (a) Adapter pointer — read the adapter doc once before any pstack skill.
  assert.ok(
    flat.includes(
      "read `docs/harness/devin.md` once before running any pstack skill",
    ),
    "missing adapter pointer to docs/harness/devin.md",
  );
  // (c) Precedence — devin.md is the adapter of record on Devin.
  assert.ok(
    flat.includes("`docs/harness/devin.md` is the adapter of record on Devin"),
    "missing adapter-of-record precedence line",
  );
  // (b) Activation boundary — always-on file, opt-in pstack.
  assert.ok(
    flat.includes(
      "Do not run pstack skills, spawn pstack subagents, or apply these " +
        "mappings unless the user invoked a pstack skill or `/pstack:<name>` command",
    ),
    "missing activation boundary",
  );
  // Preserved #213 contract: generated-file provenance + /pstack: namespacing.
  assert.ok(flat.includes("provenance.json"), "lost the provenance line");
  assert.ok(flat.includes("/pstack:<skill>"), "lost the /pstack: namespacing line");
});

test("setup-pstack delegation overwrite keeps upstream frontmatter and delegates", () => {
  const doc = readFileSync(
    join(OVERLAY, "skills/setup-pstack/SKILL.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  // Frontmatter is byte-identical to the pinned upstream file
  // (devin-plugin/skills/setup-pstack/SKILL.md, unchanged until Task 4's
  // rebuild) so `/pstack:setup-pstack` keeps upstream's discovery text. If a
  // re-pin changes upstream's frontmatter, update this expectation in the
  // same change — the drift failure is deliberate.
  const UPSTREAM_FRONTMATTER =
    "---\n" +
    "name: setup-pstack\n" +
    'description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack\'s model choices.\n' +
    "---\n";
  assert.ok(
    doc.startsWith(UPSTREAM_FRONTMATTER),
    "delegation frontmatter diverged from the pinned upstream frontmatter",
  );
  const body = doc.slice(UPSTREAM_FRONTMATTER.length);
  assert.match(body, /setup-pstack-devin\/SKILL\.md/, "body must delegate");
  assert.match(body, /provenance/i, "body must point at provenance tracking");
});

test("setup-pstack skill files never reference Cursor/Claude write paths", () => {
  // The global constraint bans `~/.cursor`/`~/.claude` writes anywhere in
  // the shipped skill + generator. Scan the path-shaped literals; the
  // delegation file may mention provenance only.
  for (const rel of [
    "skills/setup-pstack/SKILL.md",
    "skills/setup-pstack-devin/SKILL.md",
    "skills/setup-pstack-devin/scripts/setup.mjs",
    "skills/setup-pstack-devin/scripts/roles.json",
  ]) {
    const doc = readFileSync(join(OVERLAY, rel), "utf8");
    for (const banned of [
      "~/.cursor",
      "~/.claude",
      ".cursor-plugin",
      ".claude-plugin",
      "pstack-models.mdc",
      "alwaysApply",
    ]) {
      assert.ok(!doc.includes(banned), `${rel} carries banned path: ${banned}`);
    }
  }
});

test("setup-pstack-devin SKILL.md carries the Devin orchestration contract", () => {
  const doc = readFileSync(
    join(OVERLAY, "skills/setup-pstack-devin/SKILL.md"),
    "utf8",
  );
  assert.match(doc, /^name: setup-pstack-devin$/m);
  assert.match(doc, /^description: .*\/pstack:setup-pstack/m);
  for (const row of [
    // Detect: real CLI plus the deterministic parser and paste fallback.
    "devin models list",
    "setup.mjs parse",
    // Current state: the Devin rule path + agents dirs, retired-role reporting.
    "~/.devin/rules/pstack-models.md",
    "%APPDATA%\\devin\\agents\\",
    "droppedRoles",
    // Budget + confirm: ask_user_question and the three exact upstream
    // labels (schema 3 dropped `unlimited — max reasoning`).
    "ask_user_question",
    "large — xhigh reasoning",
    "medium — high reasoning",
    "small — medium reasoning",
    "needsChoice",
    // Apply: plan/diff/apply CLI surface and the removal-candidate gate.
    "setup.mjs plan",
    "setup.mjs apply",
    "--plan",
    "--yes",
    "--remove",
    // Model semantics: aliases, panel fan-out, profile naming.
    "inherit-parent",
    "auto",
    "run_subagent",
    "pstack-",
    "allowed-tools",
    "subagent_explore",
    // fusion-* exclusion rationale and the verification-skill offers.
    "fusion-",
    "sidekick",
    "/pstack:create-verification-skill",
    "/pstack:create-formal-verification-skill",
  ]) assert.ok(doc.includes(row), `missing row: ${row}`);
  // Session-start load caveat and the local-only (no cloud) caveat.
  assert.match(doc, /session start/i, "missing session-start load caveat");
  assert.match(doc, /new sessions/i, "missing applies-to-new-sessions caveat");
  assert.match(doc, /cloud/i, "missing cloud-session caveat");
  // Read-only honesty: never claim a hard guarantee the profile can't keep.
  assert.doesNotMatch(doc, /完全read-only|fully read-only/i);
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
