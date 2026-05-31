const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-test-"));
}

function setupTestProject(dir: string) {
  // Create .apm/skills with two test skills
  const skillsDir = path.join(dir, ".apm", "skills");

  // Skill A: provides adr_authoring, uses code_review
  const skillADir = path.join(skillsDir, "skill-a");
  fs.mkdirSync(skillADir, { recursive: true });
  fs.writeFileSync(
    path.join(skillADir, "SKILL.md"),
    `---
name: skill-a
description: "A test skill for ADR authoring"
provides:
  - capability: adr_authoring
    description: "Provides ADR authoring"
uses:
  - capability: code_review
    required: false
    default_skill: skill-b
    override_allowed: true
execution_policy:
  strictness: flexible
  sequence_required: false
  allow_step_reordering: true
  allow_partial_application: true
  guidance: "Use for architecture decisions"
tags:
  - architecture
  - documentation
---

# Skill A

A test skill.
`,
    "utf8",
  );

  // Skill B: provides code_review
  const skillBDir = path.join(skillsDir, "skill-b");
  fs.mkdirSync(skillBDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillBDir, "SKILL.md"),
    `---
name: skill-b
description: "A test skill for code review"
provides:
  - capability: code_review
    description: "Provides code review"
uses: []
execution_policy:
  strictness: rigid
  sequence_required: true
  allow_step_reordering: false
  allow_partial_application: false
  guidance: "Follow strict review process"
tags:
  - quality
---

# Skill B

Another test skill.
`,
    "utf8",
  );

  // Create adapter YAML
  const adapterContent = `schema_version: "1.0"
adapter_id: "test-adapter"

protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"

enabled: true

scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
    user:
      enabled: false
      roots: []
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []

profile:
  title: "Test Profile"

flow_stack:
  slots:
    - slot_id: "adr_authoring"
      slot_type: "exclusive"
      activation: "on_demand"
      default:
        skill: "skill-a"
        reason: "Primary ADR skill"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "architecture"
      label: "Architecture"
      description: "Architecture skills"
      match:
        capabilities:
          - "adr_authoring"
        tags:
          - "architecture"
        description_patterns: []
    - id: "quality"
      label: "Quality"
      description: "Quality skills"
      match:
        capabilities:
          - "code_review"
        tags:
          - "quality"
        description_patterns: []
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []

invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"

validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"
  invocation:
    enabled: false

render:
  stable_sort:
    skills:
      - "name"
    invocations:
      - "source_skill"
      - "slot"
      - "capability"
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "test-adapter-profile.json"

readable_outputs:
  enabled: false
  include: []
`;

  fs.writeFileSync(path.join(dir, "test-adapter.yaml"), adapterContent, "utf8");

  // Create tasks dir
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
}

function runSdp(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "generate.js"), ...args],
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

// ─── Generate Tests ───

test("sdp generate creates catalog and profile", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profilePath = path.join(dir, ".sdp", "test-adapter-profile.json");

  assert.ok(fs.existsSync(catalogPath), "Catalog should exist");
  assert.ok(fs.existsSync(profilePath), "Profile should exist");
});

test("sdp generate catalog has correct structure", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );

  assert.equal(catalog.schema_version, "1.0");
  assert.equal(catalog.skill_count, 2);
  assert.ok(catalog.generated_at);
  assert.ok(catalog.validated_at);
  assert.ok(Array.isArray(catalog.slots));
  assert.ok(Array.isArray(catalog.skills));
  assert.equal(catalog.skills[0].name, "skill-a"); // sorted alphabetically
  assert.equal(catalog.skills[1].name, "skill-b");
});

test("sdp generate catalog has execution_policy", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );

  const skillA = catalog.skills.find((s: { name: string }) => s.name === "skill-a");
  assert.ok(skillA.execution_policy);
  assert.equal(skillA.execution_policy.strictness, "flexible");
  assert.equal(skillA.execution_policy.sequence_required, false);

  const skillB = catalog.skills.find((s: { name: string }) => s.name === "skill-b");
  assert.ok(skillB.execution_policy);
  assert.equal(skillB.execution_policy.strictness, "rigid");
  assert.equal(skillB.execution_policy.sequence_required, true);
});

test("sdp generate profile has flow_stack.slots", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter-profile.json"), "utf8"),
  );

  assert.ok(profile.flow_stack);
  assert.ok(Array.isArray(profile.flow_stack.slots));
  assert.equal(profile.flow_stack.slots.length, 1);
  assert.equal(profile.flow_stack.slots[0].slot_id, "adr_authoring");
  assert.equal(profile.flow_stack.slots[0].slot_type, "exclusive");
});

test("sdp generate profile has resolved_invocations", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter-profile.json"), "utf8"),
  );

  assert.ok(Array.isArray(profile.resolved_invocations));
  // skill-a uses code_review → should resolve to skill-b (default_skill)
  const inv = profile.resolved_invocations.find(
    (i: { source_skill: string; capability: string }) =>
      i.source_skill === "skill-a" && i.capability === "code_review",
  );
  assert.ok(inv, "Should have resolution for skill-a -> code_review");
  assert.equal(inv.resolved_skill, "skill-b");
});

test("sdp generate is idempotent (no diff on re-run)", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // First run
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profilePath = path.join(dir, ".sdp", "test-adapter-profile.json");

  const catalog1 = fs.readFileSync(catalogPath, "utf8");
  const profile1 = fs.readFileSync(profilePath, "utf8");

  // Second run
  const result2 = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result2.status, 0, `stderr: ${result2.stderr}`);

  const catalog2 = fs.readFileSync(catalogPath, "utf8");
  const profile2 = fs.readFileSync(profilePath, "utf8");

  assert.equal(catalog1, catalog2, "Catalog should be identical on re-run");
  assert.equal(profile1, profile2, "Profile should be identical on re-run");
});

test("sdp generate sorts skills by name", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );

  const names = catalog.skills.map((s: { name: string }) => s.name);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted, "Skills should be sorted by name");
});

test("sdp generate profile classification categories sorted by id", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter-profile.json"), "utf8"),
  );

  const ids = profile.classification.categories.map((c: { id: string }) => c.id);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "Categories should be sorted by id");
});

// ─── Query Tests ───

test("sdp query categories works", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "categories"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
  assert.ok(data[0].id);
  assert.ok(data[0].skill_count !== undefined);
});

test("sdp query category-skills works", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "category-skills", "--category", "architecture"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.includes("skill-a"));
});

test("sdp query resolution works", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "resolution"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(Array.isArray(data));
});

test("sdp query flow-stack works", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "flow-stack"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data.slots);
  assert.ok(Array.isArray(data.slots));
});

test("sdp query execution-policy works", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "execution-policy"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data);
});

// ─── Error Handling ───

test("sdp generate without --adapter exits with error", () => {
  const dir = tempDir();
  const result = runSdp([], dir);
  assert.notEqual(result.status, 0);
});

test("sdp generate with missing adapter file exits with error", () => {
  const dir = tempDir();
  const result = runSdp(["--adapter", "nonexistent.yaml"], dir);
  assert.notEqual(result.status, 0);
});

test("sdp query without --profile exits with error", () => {
  const dir = tempDir();
  const result = runQuery(["categories"], dir);
  assert.notEqual(result.status, 0);
});

test("sdp query with unknown subcommand exits with code 2", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", ".sdp/test-adapter-profile.json", "unknown-command"],
    dir,
  );
  assert.equal(result.status, 2);
});
