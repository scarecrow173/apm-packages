const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveSharedCatalogPath,
  resolveFlowProfilePath,
} = require("../../../src/skills/skill-discovery-protocol/scripts/lib/artifact_paths.ts");

const skillRoot = path.resolve(__dirname, "../../../../../packages/doc-driven-dev/.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-test-"));
}

function profileRelPath() {
  return path.join(".sdp", "test-adapter", "test-adapter-profile.json");
}

function profileAbsPath(dir: string) {
  return path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");
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
---

# Skill A

Use this skill when the task is about ADR authoring and architecture decisions.
It often benefits from code review before finalizing architecture documentation.
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
---

# Skill B

Use this skill for code review and quality feedback.
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
  writeInferenceFile(dir);
  const scanned = runScan(["--adapter", "test-adapter.yaml"], dir);
  if (scanned.status !== 0) {
    throw new Error(`scan setup failed: ${scanned.stderr || scanned.stdout}`);
  }
}

function writeInferenceFile(dir: string) {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        inference_source: "agent",
        skills: [
          {
            name: "skill-a",
            review_status: "reviewed",
            provides: [
              { capability: "adr_authoring", description: "Author ADRs and architecture decisions" },
            ],
            uses: [
              {
                capability: "code_review",
                required: false,
                default_skill: "skill-b",
                override_allowed: true,
              },
            ],
            execution_policy: {
              strictness: "flexible",
              sequence_required: false,
              allow_step_reordering: true,
              allow_partial_application: true,
              guidance: "Use for architecture decisions",
            },
            runtime_guidance: [
              {
                skill: "skill-a",
                context: "When authoring ADRs",
                guidance: "Follow the ADR template",
                priority_delta: 5,
                prefer_when: ["architecture"],
                requires_partial_application: false,
              },
            ],
            tags: ["architecture", "documentation"],
          },
          {
            name: "skill-b",
            review_status: "reviewed",
            provides: [
              { capability: "code_review", description: "Review code and quality" },
            ],
            uses: [],
            execution_policy: {
              strictness: "rigid",
              sequence_required: true,
              allow_step_reordering: false,
              allow_partial_application: false,
              guidance: "Follow strict review process",
            },
            runtime_guidance: [
              {
                skill: "skill-b",
                context: "During code review",
                guidance: "Check for OWASP Top 10",
                priority_delta: 1,
                requires_sequence: true,
                requires_step_reordering: false,
                requires_partial_application: false,
              },
            ],
            tags: ["quality"],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

function runSdp(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "profile.js"), ...args],
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

function runScan(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "scan.js"), ...args],
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

// ─── Profile Tests ───

test("sdp profile creates catalog and profile", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profilePath = path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");

  assert.ok(fs.existsSync(catalogPath), "Catalog should exist");
  assert.ok(fs.existsSync(profilePath), "Profile should exist");
});

test("sdp profile exits 2 when references are missing", () => {
  const dir = tempDir();
  setupTestProject(dir);
  fs.unlinkSync(path.join(dir, ".sdp", "skill-reference-inferences.json"));

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stderr.includes("Skill reference inference required"));

  const scanPath = path.join(dir, ".sdp", "skill-scan-list.json");
  assert.ok(fs.existsSync(scanPath), "scan list should exist");

  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.schema_version, "1.0");
  assert.equal(scan.skills.length, 2);
  assert.equal(scan.skills[0].name, "skill-a");
  assert.ok(scan.skills[0].body.includes("ADR authoring"));
});

test("sdp profile missing inference prints infer command hint", () => {
  const dir = tempDir();
  setupTestProject(dir);
  fs.unlinkSync(path.join(dir, ".sdp", "skill-reference-inferences.json"));

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Skill reference inference required"));
  const output = `${result.stderr}\n${result.stdout}`;
  assert.ok(output.includes("sdp infer"));
  assert.ok(output.includes("--scan"));
  assert.ok(output.includes("skill-scan-list.json"));
});

test("sdp profile catalog has correct structure", () => {
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
  assert.equal(catalog.slot_count, undefined);
  assert.equal(catalog.slots, undefined);
  assert.ok(Array.isArray(catalog.skills));
  assert.equal(catalog.skills[0].name, "skill-a"); // sorted alphabetically
  assert.equal(catalog.skills[1].name, "skill-b");
});

test("sdp profile ignores non-standard SKILL.md capability metadata", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const skillPath = path.join(dir, ".apm", "skills", "skill-a", "SKILL.md");
  const original = fs.readFileSync(skillPath, "utf8");
  const polluted = original.replace(
    'description: "A test skill for ADR authoring"',
    `description: "A test skill for ADR authoring"
provides:
  - capability: wrong_capability
uses:
  - capability: wrong_dependency
tags:
  - wrong_tag`,
  );
  fs.writeFileSync(skillPath, polluted, "utf8");

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const skillA = catalog.skills.find((s: { name: string }) => s.name === "skill-a");
  assert.deepEqual(skillA.provides.map((p: { capability: string }) => p.capability), ["adr_authoring"]);
  assert.deepEqual(skillA.uses.map((u: { capability: string }) => u.capability), ["code_review"]);
  assert.deepEqual(skillA.tags, ["architecture", "documentation"]);
});

test("sdp profile catalog has execution_policy", () => {
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

test("sdp profile has flow_stack.slots", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(profileAbsPath(dir), "utf8"),
  );

  assert.ok(profile.flow_stack);
  assert.ok(Array.isArray(profile.flow_stack.slots));
  assert.equal(profile.flow_stack.slots.length, 1);
  assert.equal(profile.flow_stack.slots[0].slot_id, "adr_authoring");
  assert.equal(profile.flow_stack.slots[0].slot_type, "exclusive");
});

test("sdp profile has resolved_invocations", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(profileAbsPath(dir), "utf8"),
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

test("sdp profile has ranked runtime_guidance", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(profileAbsPath(dir), "utf8"),
  );

  assert.ok(Array.isArray(profile.runtime_guidance));
  assert.equal(profile.runtime_guidance.length, 2);
  assert.equal(profile.runtime_guidance[0].skill, "skill-a");
  assert.equal(profile.runtime_guidance[0].context, "When authoring ADRs");
  assert.equal(profile.runtime_guidance[0].guidance, "Follow the ADR template");
  assert.equal(profile.runtime_guidance[1].skill, "skill-b");
});

test("sdp profile is idempotent (no diff on re-run)", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // First run
  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profilePath = profileAbsPath(dir);

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

test("sdp profile sorts skills by name", () => {
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

test("sdp profile classification categories sorted by id", () => {
  const dir = tempDir();
  setupTestProject(dir);

  runSdp(["--adapter", "test-adapter.yaml"], dir);

  const profile = JSON.parse(
    fs.readFileSync(profileAbsPath(dir), "utf8"),
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
    ["--profile", profileRelPath(), "categories"],
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
    ["--profile", profileRelPath(), "category-skills", "--category", "architecture"],
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
    ["--profile", profileRelPath(), "resolution"],
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
    ["--profile", profileRelPath(), "flow-stack"],
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
    ["--profile", profileRelPath(), "execution-policy"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.ok(data);
});

// ─── Error Handling ───

test("sdp profile without --adapter exits with error", () => {
  const dir = tempDir();
  const result = runSdp([], dir);
  assert.notEqual(result.status, 0);
});

test("sdp profile with missing adapter file exits with error", () => {
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
    ["--profile", profileRelPath(), "unknown-command"],
    dir,
  );
  assert.equal(result.status, 2);
});

test("artifact paths allow normal relative paths under .sdp", () => {
  const dir = tempDir();

  const shared = resolveSharedCatalogPath(dir, "skill-reference-catalog.json");
  const flow = resolveFlowProfilePath(dir, "test-adapter", "test-adapter-profile.json");

  assert.equal(shared, path.join(dir, ".sdp", "skill-reference-catalog.json"));
  assert.equal(flow, path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json"));
});

test("artifact paths reject parent directory escape", () => {
  const dir = tempDir();

  assert.throws(
    () => resolveSharedCatalogPath(dir, "../outside.json"),
    /Invalid shared catalog path: path escapes base directory/,
  );

  assert.throws(
    () => resolveFlowProfilePath(dir, "test-adapter", "../outside.json"),
    /Invalid flow profile path: path escapes base directory/,
  );
});

test("artifact paths reject absolute relPath", () => {
  const dir = tempDir();
  const absolutePath = path.resolve(dir, "absolute.json");

  assert.throws(
    () => resolveSharedCatalogPath(dir, absolutePath),
    /Invalid shared catalog path: absolute paths are not allowed/,
  );
});

test("artifact paths reject invalid adapterId", () => {
  const dir = tempDir();

  assert.throws(
    () => resolveFlowProfilePath(dir, "../bad", "profile.json"),
    /Invalid adapterId: must not contain path separators or '..'/,
  );
});
