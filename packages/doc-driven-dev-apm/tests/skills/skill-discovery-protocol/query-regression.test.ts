const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-query-reg-"));
}

function runQuery(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "query.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ─── Setup a realistic profile + catalog environment ───

function setupEnv(dir: string) {
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });

  const profile = {
    schema_version: "1.0",
    profile_id: "regression-test-profile",
    generated_at: "2026-01-01T00:00:00Z",
    validated_at: "2026-01-01T00:00:00Z",
    adapter_id: "regression-adapter",
    flow_stack: {
      slots: [
        {
          slot_id: "process_diagnosis",
          slot_type: "exclusive",
          activation: "conditional",
          default: { skill: "debug-skill", reason: "Diagnosis first" },
        },
        {
          slot_id: "build_structure",
          slot_type: "layerable",
          activation: "always",
          default: { skill: "impl-skill", reason: "Incremental delivery" },
        },
        {
          slot_id: "review_gate",
          slot_type: "exclusive",
          activation: "always",
          default: { skill: "review-skill", reason: "Every task needs review" },
        },
      ],
    },
    classification: {
      categories: [
        { id: "process", label: "Process", skills: ["debug-skill"] },
        { id: "build", label: "Build", skills: ["impl-skill"] },
        { id: "review", label: "Review", skills: ["review-skill"] },
      ],
      unmatched_skills: [],
    },
    resolved_invocations: [
      {
        source_skill: "debug-skill",
        slot: "review_gate",
        capability: "code_review",
        resolved_skill: "review-skill",
        resolution_method: "default_skill",
        reason: "Default skill specified",
        fallback: null,
      },
      {
        source_skill: "impl-skill",
        slot: "process_diagnosis",
        capability: "debugging",
        resolved_skill: "debug-skill",
        resolution_method: "provider_lookup",
        reason: "Provider found",
        fallback: null,
      },
    ],
    runtime_guidance: [
      {
        skill: "debug-skill",
        context: "When diagnosing failures",
        guidance: "Use 5-step diagnosis",
      },
      {
        skill: "review-skill",
        context: "During code review",
        guidance: "Follow multi-axis checklist",
      },
    ],
    warnings: [],
  };

  const catalog = {
    schema_version: "1.0",
    generated_at: "2026-01-01T00:00:00Z",
    validated_at: "2026-01-01T00:00:00Z",
    skill_count: 3,
    capability_count: 3,
    slot_count: 3,
    slots: [
      { slot_id: "process_diagnosis", description: "Diagnosis slot", default_skill: "debug-skill" },
      { slot_id: "build_structure", description: "Build slot", default_skill: "impl-skill" },
      { slot_id: "review_gate", description: "Review slot", default_skill: "review-skill" },
    ],
    skills: [
      {
        name: "debug-skill",
        description: "Debugging and diagnosis",
        provides: [{ capability: "debugging", description: "Root cause analysis" }],
        uses: [{ capability: "code_review", required: false, default_skill: "review-skill", override_allowed: true }],
        execution_policy: {
          strictness: "rigid",
          sequence_required: true,
          allow_step_reordering: false,
          allow_partial_application: false,
          guidance: "Follow 5-step diagnosis",
        },
        tags: ["process", "diagnosis"],
      },
      {
        name: "impl-skill",
        description: "Incremental implementation",
        provides: [{ capability: "incremental_implementation", description: "Step-by-step delivery" }],
        uses: [{ capability: "debugging", required: false, default_skill: "debug-skill", override_allowed: true }],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
          guidance: "Deliver incrementally",
        },
        tags: ["build", "implementation"],
      },
      {
        name: "review-skill",
        description: "Code review and quality gate",
        provides: [{ capability: "code_review", description: "Multi-axis review" }],
        uses: [],
        execution_policy: {
          strictness: "rigid",
          sequence_required: true,
          allow_step_reordering: false,
          allow_partial_application: false,
          guidance: "Follow review checklist",
        },
        tags: ["review", "quality"],
      },
    ],
  };

  const validationReport = {
    schema_version: "1.0",
    validated_at: "2026-01-01T00:00:00Z",
    adapter_id: "regression-adapter",
    overall_result: "pass",
    schema_validation: { result: "pass" },
    staleness_validation: { result: "pass" },
    deterministic_validation: { result: "pass" },
    blocking_validations: { result: "pass" },
    generated_at: "2026-01-01T00:00:00Z",
    checks: [
      { name: "schema", status: "passed" },
      { name: "staleness", status: "passed" },
      { name: "deterministic", status: "passed" },
      { name: "blocking", status: "passed" },
    ],
    summary: { total: 4, passed: 4, failed: 0, skipped: 0 },
  };

  fs.writeFileSync(
    path.join(dir, "tasks", "regression-profile.json"),
    JSON.stringify(profile, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "tasks", "skill-reference-catalog.json"),
    JSON.stringify(catalog, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "tasks", "validation-report.json"),
    JSON.stringify(validationReport, null, 2),
    "utf8",
  );
}

// ═══════════════════════════════════════════════════════════════════
// Regression: Each subcommand with valid input → valid JSON
// ═══════════════════════════════════════════════════════════════════

test("regression: categories returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "categories"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
});

test("regression: category-skills returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "category-skills", "--category", "process"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.includes("debug-skill"));
});

test("regression: resolution returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "resolution"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
});

test("regression: flow-stack returns valid JSON with slots", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "flow-stack"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.slots);
  assert.equal(data.slots.length, 3);
});

test("regression: execution-policy returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "execution-policy"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 3);
});

test("regression: capability-skills returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "capability-skills", "--capability", "debugging"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
});

test("regression: skill-detail returns valid JSON object", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "skill-detail", "--skill", "debug-skill"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.name, "debug-skill");
  assert.ok(data.provides);
  assert.ok(data.execution_policy);
});

test("regression: runtime-guidance returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "runtime-guidance"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
});

test("regression: unresolved returns valid JSON array", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "unresolved"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
});

test("regression: validation-status returns valid JSON", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(["--profile", "tasks/regression-profile.json", "validation-status"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.adapter_id, "regression-adapter");
  assert.ok(data.summary);
});

// ═══════════════════════════════════════════════════════════════════
// Regression: Missing required args → error exit
// ═══════════════════════════════════════════════════════════════════

test("regression: category-skills without --category exits 1", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "category-skills"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("--category is required"));
});

test("regression: capability-skills without --capability exits 1", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "capability-skills"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("--capability is required"));
});

test("regression: skill-detail without --skill exits 1", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "skill-detail"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("--skill is required"));
});

// ═══════════════════════════════════════════════════════════════════
// Regression: Non-existent category/skill/capability/slot
// ═══════════════════════════════════════════════════════════════════

test("regression: category-skills with non-existent category returns error info", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "category-skills", "--category", "nonexistent-cat"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  // Should return empty array or error object
  if (Array.isArray(data)) {
    assert.equal(data.length, 0);
  } else {
    assert.ok(data.error);
  }
});

test("regression: skill-detail with non-existent skill returns error info", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "skill-detail", "--skill", "nonexistent-skill"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("not found"));
});

test("regression: capability-skills with non-existent capability returns empty", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "capability-skills", "--capability", "nonexistent_cap"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 0);
});

test("regression: flow-stack --slot with non-existent slot returns error info", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "flow-stack", "--slot", "nonexistent_slot"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("not found"));
});

test("regression: execution-policy --skill with non-existent skill returns error info", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "execution-policy", "--skill", "nonexistent-skill"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("not found"));
});

// ═══════════════════════════════════════════════════════════════════
// Regression: Input validation (no --profile, bad profile path)
// ═══════════════════════════════════════════════════════════════════

test("regression: query without --profile exits with error", () => {
  const dir = tempDir();
  const result = runQuery(["categories"], dir);
  assert.notEqual(result.status, 0);
});

test("regression: query with non-existent profile exits with error", () => {
  const dir = tempDir();
  const result = runQuery(["--profile", "no-such-file.json", "categories"], dir);
  assert.notEqual(result.status, 0);
});

test("regression: query with invalid JSON profile exits with error", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "bad.json"), "not json{{{", "utf8");
  const result = runQuery(["--profile", "tasks/bad.json", "categories"], dir);
  assert.notEqual(result.status, 0);
});

// ═══════════════════════════════════════════════════════════════════
// Regression: Unknown subcommand handling
// ═══════════════════════════════════════════════════════════════════

test("regression: unknown subcommand exits 2 with suggestion", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "categorie"],
    dir,
  );
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Did you mean: categories?"));
});

test("regression: completely unknown subcommand exits 2", () => {
  const dir = tempDir();
  setupEnv(dir);
  const result = runQuery(
    ["--profile", "tasks/regression-profile.json", "zzz-nonexistent"],
    dir,
  );
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Available subcommands:"));
});
