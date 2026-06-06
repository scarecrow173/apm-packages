const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-query-"));
}

function runQuery(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "query.js"), ...args],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Create a test environment with profile, catalog, and validation report
function setupQueryEnv(dir: string) {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });

  const profile = {
    schema_version: "1.0",
    flow_name: "test-profile",
    generated_at: "2026-01-01T00:00:00Z",
    validated_at: "2026-01-01T00:00:00Z",
    adapter_id: "test-adapter",
    flow_stack: {
      slots: [
        {
          slot_id: "adr_authoring",
          slot_type: "exclusive",
          activation: "on_demand",
          default: { skill: "skill-a", reason: "Primary ADR skill" },
        },
        {
          slot_id: "code_review",
          slot_type: "layerable",
          activation: "always",
          default: { skill: "skill-b", reason: "Default reviewer" },
        },
      ],
    },
    classification: {
      categories: [
        { id: "architecture", label: "Architecture", skills: ["skill-a"] },
        { id: "quality", label: "Quality", skills: ["skill-b"] },
      ],
      unmatched_skills: [],
    },
    resolved_invocations: [
      {
        source_skill: "skill-a",
        slot: "code_review",
        capability: "code_review",
        resolved_skill: "skill-b",
        resolution_method: "default_skill",
        reason: "Default skill specified",
        fallback: null,
      },
      {
        source_skill: "skill-c",
        slot: "testing",
        capability: "testing",
        resolved_skill: null,
        resolution_method: "provider_lookup",
        reason: "No provider found for testing",
        fallback: null,
      },
    ],
    runtime_guidance: [
      {
        skill: "skill-b",
        context: "During code review",
        guidance: "Check for OWASP Top 10",
        priority_delta: 1,
      },
      {
        skill: "skill-a",
        context: "When authoring ADRs",
        guidance: "Follow the ADR template",
        priority_delta: 5,
      },
    ],
    warnings: ["Unresolved capability: testing for skill-c"],
  };

  const catalog = {
    schema_version: "1.0",
    generated_at: "2026-01-01T00:00:00Z",
    validated_at: "2026-01-01T00:00:00Z",
    skill_count: 2,
    capability_count: 2,
    skills: [
      {
        name: "skill-a",
        description: "A test skill for ADR authoring",
        provides: [{ capability: "adr_authoring", description: "Provides ADR authoring" }],
        uses: [{ capability: "code_review", required: false, default_skill: "skill-b", override_allowed: true }],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
          guidance: "Use for architecture decisions",
        },
        tags: ["architecture", "documentation"],
      },
      {
        name: "skill-b",
        description: "A test skill for code review",
        provides: [{ capability: "code_review", description: "Provides code review" }],
        uses: [],
        execution_policy: {
          strictness: "rigid",
          sequence_required: true,
          allow_step_reordering: false,
          allow_partial_application: false,
          guidance: "Follow strict review process",
        },
        tags: ["quality"],
      },
    ],
  };

  const validationReport = {
    schema_version: "1.0",
    validated_at: "2026-01-01T00:00:00Z",
    adapter_id: "test-adapter",
    checks: [
      { name: "schema", status: "passed" },
      { name: "staleness", status: "passed" },
      { name: "deterministic", status: "skipped", message: "Not configured" },
    ],
    summary: { total: 3, passed: 2, failed: 0, skipped: 1 },
  };

  fs.writeFileSync(
    path.join(dir, ".sdp", "test-profile.json"),
    JSON.stringify(profile, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-catalog.json"),
    JSON.stringify(catalog, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, ".sdp", "validation-report.json"),
    JSON.stringify(validationReport, null, 2),
    "utf8",
  );
}

// ─── Registry & Error Handling ───

test("query: unknown subcommand shows suggestion and exits 2", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "categorie"],
    dir,
  );
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('Unknown subcommand "categorie"'));
  assert.ok(result.stderr.includes("Did you mean: categories?"));
  assert.ok(result.stderr.includes("Available subcommands:"));
});

test("query: unknown subcommand with no close match", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "xyzabc"],
    dir,
  );
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('Unknown subcommand "xyzabc"'));
  assert.ok(result.stderr.includes("Available subcommands:"));
});

test("query: required arg missing exits 1", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "category-skills"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("--category is required"));
});

test("query: --help lists all subcommands", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(["--help"], dir);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("categories"));
  assert.ok(result.stdout.includes("capability-skills"));
  assert.ok(result.stdout.includes("skill-detail"));
  assert.ok(result.stdout.includes("runtime-guidance"));
  assert.ok(result.stdout.includes("unresolved"));
  assert.ok(result.stdout.includes("validation-status"));
});

// ─── Existing subcommands (regression) ───

test("query: categories returns list", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "categories"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
  assert.equal(data[0].id, "architecture");
  assert.equal(data[0].skill_count, 1);
});

test("query: category-skills returns skills", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "category-skills", "--category", "architecture"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data, ["skill-a"]);
});

test("query: resolution returns all invocations", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "resolution"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
});

test("query: resolution --skill filters", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "resolution", "--skill", "skill-a"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.length, 1);
  assert.equal(data[0].source_skill, "skill-a");
});

test("query: flow-stack returns full stack", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "flow-stack"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.slots);
  assert.equal(data.slots.length, 2);
});

test("query: flow-stack --slot filters", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "flow-stack", "--slot", "adr_authoring"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.slot_id, "adr_authoring");
  assert.equal(data.slot_type, "exclusive");
});

// ─── execution-policy ───

test("query: execution-policy returns all policies", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "execution-policy"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
  assert.equal(data[0].skill, "skill-a");
  assert.equal(data[0].execution_policy.strictness, "flexible");
});

test("query: execution-policy --skill filters", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "execution-policy", "--skill", "skill-b"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.skill, "skill-b");
  assert.equal(data.execution_policy.strictness, "rigid");
});

// ─── New subcommands ───

test("query: capability-skills returns matching skills", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "capability-skills", "--capability", "code_review"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 1);
  assert.equal(data[0].name, "skill-b");
});

test("query: capability-skills requires --capability", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "capability-skills"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("--capability is required"));
});

test("query: skill-detail returns full skill entry", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "skill-detail", "--skill", "skill-a"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.name, "skill-a");
  assert.ok(Array.isArray(data.provides));
  assert.ok(Array.isArray(data.uses));
  assert.ok(data.execution_policy);
  assert.ok(Array.isArray(data.tags));
});

test("query: skill-detail not found", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "skill-detail", "--skill", "nonexistent"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("not found"));
});

test("query: runtime-guidance returns all guidance", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "runtime-guidance"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
});

test("query: runtime-guidance ranks guidance entries", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "runtime-guidance"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data[0].skill, "skill-a");
  assert.equal(data[1].skill, "skill-b");
});

test("query: runtime-guidance --skill filters", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "runtime-guidance", "--skill", "skill-b"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.length, 1);
  assert.equal(data[0].skill, "skill-b");
  assert.equal(data[0].guidance, "Check for OWASP Top 10");
});

test("query: unresolved returns unresolved items", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "unresolved"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
  // Should find the null resolved_skill entry
  const fromInvocations = data.find((d: { source: string }) => d.source === "resolved_invocations");
  assert.ok(fromInvocations);
  assert.equal(fromInvocations.source_skill, "skill-c");
});

test("query: validation-status returns report summary", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "validation-status"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.adapter_id, "test-adapter");
  assert.equal(data.summary.total, 3);
  assert.equal(data.summary.passed, 2);
  assert.equal(data.summary.failed, 0);
  assert.equal(data.summary.skipped, 1);
  assert.ok(Array.isArray(data.checks));
});

test("query: validation-status without report shows error", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  // Remove validation report
  fs.unlinkSync(path.join(dir, ".sdp", "validation-report.json"));

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "validation-status"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("Validation report not found"));
});

test("query: execution-policy without catalog shows error", () => {
  const dir = tempDir();
  setupQueryEnv(dir);

  // Remove catalog
  fs.unlinkSync(path.join(dir, ".sdp", "skill-reference-catalog.json"));

  const result = runQuery(
    ["--profile", ".sdp/test-profile.json", "execution-policy"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.error);
  assert.ok(data.error.includes("Catalog not found"));
});
