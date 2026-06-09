const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-integration-"));
}

function runGenerate(args: string[], cwd: string) {
  let scanStdout = "";
  let scanStderr = "";

  const adapterIndex = args.findIndex((x) => x === "--adapter");
  if (adapterIndex >= 0 && args[adapterIndex + 1]) {
    const scanResult = spawnSync(
      process.execPath,
      [path.join(sdpScripts, "scan.js"), "--adapter", args[adapterIndex + 1]],
      { cwd, encoding: "utf8", windowsHide: true },
    );
    scanStdout = scanResult.stdout ?? "";
    scanStderr = scanResult.stderr ?? "";
    if ((scanResult.status ?? 1) !== 0) {
      return { status: scanResult.status, stdout: scanResult.stdout, stderr: scanResult.stderr };
    }
  }

  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "profile.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return {
    status: result.status,
    stdout: `${scanStdout}${result.stdout ?? ""}`,
    stderr: `${scanStderr}${result.stderr ?? ""}`,
  };
}

function runValidate(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "validate.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runQuery(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "query.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runInfer(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "infer.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ─── Mock Skills ───

const MOCK_SKILLS = {
  "mock-debug-skill": `---
name: mock-debug-skill
description: "Debugging and diagnosis of test failures"
version: "1.0.0"
---

# Mock Debug Skill

A mock skill for debugging and diagnosis of test failures.
`,
  "mock-review-skill": `---
name: mock-review-skill
description: "Code review and quality gate"
version: "1.0.0"
---

# Mock Review Skill

A mock skill for code review.
`,
  "mock-impl-skill": `---
name: mock-impl-skill
description: "Incremental implementation delivery"
version: "1.0.0"
---

# Mock Implementation Skill

A mock skill for incremental implementation.
`,
  "mock-research-skill": `---
name: mock-research-skill
description: "Web research and information gathering"
version: "1.0.0"
---

# Mock Research Skill

A mock skill for web research.
`,
};

const MOCK_INFERENCE_SKILLS = [
  {
    name: "mock-debug-skill",
    review_status: "reviewed",
    provides: [{ capability: "debugging", description: "Root cause analysis" }],
    uses: [
      {
        capability: "code_review",
        required: false,
        default_skill: "mock-review-skill",
        override_allowed: true,
      },
    ],
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
    name: "mock-review-skill",
    review_status: "reviewed",
    provides: [{ capability: "code_review", description: "Multi-axis code review" }],
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
  {
    name: "mock-impl-skill",
    review_status: "reviewed",
    provides: [{ capability: "incremental_implementation", description: "Step-by-step implementation" }],
    uses: [
      {
        capability: "debugging",
        required: false,
        default_skill: "mock-debug-skill",
        override_allowed: true,
      },
    ],
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
    name: "mock-research-skill",
    review_status: "reviewed",
    provides: [
      { capability: "web_research", description: "External information discovery" },
      { capability: "information_gathering", description: "Source collection" },
    ],
    uses: [
      {
        capability: "code_review",
        required: false,
        default_skill: "mock-review-skill",
        override_allowed: true,
      },
    ],
    execution_policy: {
      strictness: "flexible",
      sequence_required: false,
      allow_step_reordering: true,
      allow_partial_application: true,
      guidance: "Search iteratively",
    },
    tags: ["discover", "search", "research"],
  },
];

// ─── Implementation-flow adapter (self-contained, no extends) ───

const IMPLEMENTATION_ADAPTER = `schema_version: "1.0"
adapter_id: "impl-flow-test"

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
  title: "Implementation Profile"

flow_stack:
  slots:
    - slot_id: "process_diagnosis"
      slot_type: "exclusive"
      activation: "conditional"
      default:
        skill: "mock-debug-skill"
        reason: "Bug fixes need diagnosis first"
    - slot_id: "build_structure"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "mock-impl-skill"
          reason: "All implementation uses incremental delivery"
        - skill: "mock-review-skill"
          reason: "Implementation should remain reviewable"
    - slot_id: "review_gate"
      slot_type: "exclusive"
      activation: "always"
      default:
        skill: "mock-review-skill"
        reason: "Every task requires review"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "process"
      label: "Process"
      description: "Skills that determine how to approach problems"
      match:
        capabilities: ["debugging"]
        tags: ["process", "diagnosis"]
        description_patterns: ["debug", "diagnos"]
    - id: "build"
      label: "Build"
      description: "Skills that structure execution"
      match:
        capabilities: ["incremental_implementation"]
        tags: ["build", "implementation"]
        description_patterns: ["implement", "incremental"]
    - id: "review"
      label: "Review"
      description: "Skills that provide post-implementation gates"
      match:
        capabilities: ["code_review"]
        tags: ["review"]
        description_patterns: ["review"]
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []

invocation_resolution:
  overrides:
    slots:
      process_diagnosis:
        use: "mock-debug-skill"
        reason: "Primary diagnosis tool"
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
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
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "impl-flow-test-profile.json"

readable_outputs:
  enabled: false
  include: []
`;

// ─── Briefing-flow adapter (self-contained, no extends) ───

const BRIEFING_ADAPTER = `schema_version: "1.0"
adapter_id: "briefing-flow-test"

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
  title: "Briefing Profile"

flow_stack:
  slots:
    - slot_id: "discover_gather"
      slot_type: "layerable"
      activation: "conditional"
      default:
        - skill: "mock-research-skill"
          reason: "External research for discovery"
    - slot_id: "spec_output"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "mock-impl-skill"
          reason: "All briefings produce output"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "discover"
      label: "Discover"
      description: "Skills that explore and find information"
      match:
        capabilities: ["web_research", "information_gathering"]
        tags: ["discover", "search"]
        description_patterns: ["explore", "search", "find"]
    - id: "research"
      label: "Research"
      description: "Skills that conduct deep investigation"
      match:
        capabilities: []
        tags: ["research", "investigation"]
        description_patterns: ["investigate", "evidence"]
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
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
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
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "briefing-flow-test-profile.json"

readable_outputs:
  enabled: false
  include: []
`;

// ─── General adapter (self-contained) ───

const GENERAL_ADAPTER = `schema_version: "1.0"
adapter_id: "general-test"

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
  title: "General Skill Reference"

flow_stack:
  slots: []

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "process"
      label: "Process"
      description: "Process skills"
      match:
        capabilities: ["debugging"]
        tags: ["process", "diagnosis"]
        description_patterns: ["debug", "diagnos"]
    - id: "build"
      label: "Build"
      description: "Build skills"
      match:
        capabilities: ["incremental_implementation"]
        tags: ["build", "implementation"]
        description_patterns: ["implement"]
    - id: "review"
      label: "Review"
      description: "Review skills"
      match:
        capabilities: ["code_review"]
        tags: ["review", "quality"]
        description_patterns: ["review"]
    - id: "discover"
      label: "Discover"
      description: "Discovery skills"
      match:
        capabilities: ["web_research", "information_gathering"]
        tags: ["discover", "search"]
        description_patterns: ["research", "search"]
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
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "general-test-profile.json"

readable_outputs:
  enabled: false
  include: []
`;

// ─── Setup helpers ───

function setupSkills(dir: string) {
  const skillsDir = path.join(dir, ".apm", "skills");
  for (const [name, content] of Object.entries(MOCK_SKILLS)) {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
  }
  writeInferenceFile(dir, MOCK_INFERENCE_SKILLS);
}

function writeInferenceFile(dir: string, skills: Array<Record<string, unknown>>) {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        inference_source: "agent",
        skills: skills.map((skill) => ({
          review_status: "reviewed",
          ...skill,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function setupImplFlow(dir: string) {
  setupSkills(dir);
  fs.writeFileSync(path.join(dir, "impl-adapter.yaml"), IMPLEMENTATION_ADAPTER, "utf8");
}

function setupBriefingFlow(dir: string) {
  setupSkills(dir);
  fs.writeFileSync(path.join(dir, "briefing-adapter.yaml"), BRIEFING_ADAPTER, "utf8");
}

function setupGeneralAdapter(dir: string) {
  setupSkills(dir);
  fs.writeFileSync(path.join(dir, "general-adapter.yaml"), GENERAL_ADAPTER, "utf8");
}

function implProfileRelPath() {
  return ".sdp/impl-flow-test/impl-flow-test-profile.json";
}

function implProfileAbsPath(dir: string) {
  return path.join(dir, ".sdp", "impl-flow-test", "impl-flow-test-profile.json");
}

function briefingProfileRelPath() {
  return ".sdp/briefing-flow-test/briefing-flow-test-profile.json";
}

function briefingProfileAbsPath(dir: string) {
  return path.join(dir, ".sdp", "briefing-flow-test", "briefing-flow-test-profile.json");
}

// ═══════════════════════════════════════════════════════════════════
// Integration: implementation-flow adapter
// ═══════════════════════════════════════════════════════════════════

test("integration: impl-flow adapter generates valid profile", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  const result = runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const profilePath = implProfileAbsPath(dir);
  assert.ok(fs.existsSync(profilePath), "Profile should exist");

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  assert.equal(profile.schema_version, "1.0");
  assert.equal(profile.adapter_id, "impl-flow-test");
  assert.ok(profile.flow_stack.slots.length >= 3);
  assert.deepEqual(profile.flow_stack.slots[1].default, [
    { skill: "mock-impl-skill", reason: "All implementation uses incremental delivery" },
    { skill: "mock-review-skill", reason: "Implementation should remain reviewable" },
  ]);
  assert.ok(profile.classification.categories.length > 0);
  assert.ok(profile.resolved_invocations.length > 0);
  assert.ok(Array.isArray(profile.runtime_guidance));
  assert.ok(profile.runtime_guidance.length > 0);
});

test("integration: impl-flow profile validates successfully", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  runGenerate(["--adapter", "impl-adapter.yaml"], dir);

  const result = runValidate(
    ["--profile", implProfileRelPath(), "--adapter", "impl-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Overall:       pass"));
});

test("integration: impl-flow profile queryable with all subcommands", () => {
  const dir = tempDir();
  setupImplFlow(dir);
  runGenerate(["--adapter", "impl-adapter.yaml"], dir);

  const profile = implProfileRelPath();
  const subcommands = [
    ["categories"],
    ["flow-stack"],
    ["resolution"],
    ["execution-policy"],
    ["unresolved"],
    ["runtime-guidance"],
  ];

  for (const args of subcommands) {
    const result = runQuery(["--profile", profile, ...args], dir);
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`);
    JSON.parse(result.stdout); // Must be valid JSON
  }
});

test("integration: impl-flow re-generation is idempotent", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  runGenerate(["--adapter", "impl-adapter.yaml"], dir);

  const profilePath = implProfileAbsPath(dir);
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profile1 = fs.readFileSync(profilePath, "utf8");
  const catalog1 = fs.readFileSync(catalogPath, "utf8");

  runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  const profile2 = fs.readFileSync(profilePath, "utf8");
  const catalog2 = fs.readFileSync(catalogPath, "utf8");

  assert.equal(profile1, profile2, "Profile should be identical on re-run");
  assert.equal(catalog1, catalog2, "Catalog should be identical on re-run");
});

// ═══════════════════════════════════════════════════════════════════
// Integration: briefing-flow adapter
// ═══════════════════════════════════════════════════════════════════

test("integration: briefing-flow adapter generates valid profile", () => {
  const dir = tempDir();
  setupBriefingFlow(dir);

  const result = runGenerate(["--adapter", "briefing-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const profilePath = briefingProfileAbsPath(dir);
  assert.ok(fs.existsSync(profilePath), "Profile should exist");

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  assert.equal(profile.schema_version, "1.0");
  assert.equal(profile.adapter_id, "briefing-flow-test");
  assert.ok(profile.flow_stack.slots.length >= 2);
  assert.deepEqual(profile.flow_stack.slots[0].default, [
    { skill: "mock-research-skill", reason: "External research for discovery" },
  ]);
  assert.ok(profile.classification.categories.length > 0);
});

test("integration: briefing-flow profile validates successfully", () => {
  const dir = tempDir();
  setupBriefingFlow(dir);

  runGenerate(["--adapter", "briefing-adapter.yaml"], dir);

  const result = runValidate(
    ["--profile", briefingProfileRelPath(), "--adapter", "briefing-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Overall:       pass"));
});

test("integration: briefing-flow profile queryable with all subcommands", () => {
  const dir = tempDir();
  setupBriefingFlow(dir);
  runGenerate(["--adapter", "briefing-adapter.yaml"], dir);

  const profile = briefingProfileRelPath();
  const subcommands = [
    ["categories"],
    ["flow-stack"],
    ["resolution"],
    ["execution-policy"],
    ["unresolved"],
    ["runtime-guidance"],
  ];

  for (const args of subcommands) {
    const result = runQuery(["--profile", profile, ...args], dir);
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`);
    JSON.parse(result.stdout); // Must be valid JSON
  }
});

test("integration: briefing-flow re-generation is idempotent", () => {
  const dir = tempDir();
  setupBriefingFlow(dir);

  runGenerate(["--adapter", "briefing-adapter.yaml"], dir);

  const profilePath = briefingProfileAbsPath(dir);
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const profile1 = fs.readFileSync(profilePath, "utf8");
  const catalog1 = fs.readFileSync(catalogPath, "utf8");

  runGenerate(["--adapter", "briefing-adapter.yaml"], dir);
  const profile2 = fs.readFileSync(profilePath, "utf8");
  const catalog2 = fs.readFileSync(catalogPath, "utf8");

  assert.equal(profile1, profile2, "Profile should be identical on re-run");
  assert.equal(catalog1, catalog2, "Catalog should be identical on re-run");
});

// ═══════════════════════════════════════════════════════════════════
// Integration: catalog consistency across flows
// ═══════════════════════════════════════════════════════════════════

test("integration: both flows produce same catalog (same skills)", () => {
  const implDir = tempDir();
  const briefingDir = tempDir();
  setupImplFlow(implDir);
  setupBriefingFlow(briefingDir);

  runGenerate(["--adapter", "impl-adapter.yaml"], implDir);
  runGenerate(["--adapter", "briefing-adapter.yaml"], briefingDir);

  const implCatalog = JSON.parse(
    fs.readFileSync(path.join(implDir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const briefingCatalog = JSON.parse(
    fs.readFileSync(path.join(briefingDir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );

  // Catalogs should have the same skills (scan is identical)
  assert.equal(implCatalog.skill_count, briefingCatalog.skill_count);
  assert.deepEqual(
    implCatalog.skills.map((s: { name: string }) => s.name),
    briefingCatalog.skills.map((s: { name: string }) => s.name),
  );
});

// ═══════════════════════════════════════════════════════════════════
// Integration: adapter validation
// ═══════════════════════════════════════════════════════════════════

test("integration: general adapter validates successfully", () => {
  const dir = tempDir();
  setupGeneralAdapter(dir);

  const result = runValidate(["--adapter", "general-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Adapter validation passed"));
});

test("integration: impl adapter validates successfully", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  const result = runValidate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Adapter validation passed"));
});

test("integration: briefing adapter validates successfully", () => {
  const dir = tempDir();
  setupBriefingFlow(dir);

  const result = runValidate(["--adapter", "briefing-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Adapter validation passed"));
});

// ═══════════════════════════════════════════════════════════════════
// Integration: end-to-end profile → validate → query pipeline
// ═══════════════════════════════════════════════════════════════════

test("integration: full pipeline profile → validate → query category-skills", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  // Profile
  const gen = runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(gen.status, 0, `profile stderr: ${gen.stderr}`);

  // Validate
  const val = runValidate(
    ["--profile", implProfileRelPath(), "--adapter", "impl-adapter.yaml"],
    dir,
  );
  assert.equal(val.status, 0, `validate stderr: ${val.stderr}`);

  // Query: get categories then query each
  const catResult = runQuery(
    ["--profile", implProfileRelPath(), "categories"],
    dir,
  );
  assert.equal(catResult.status, 0);
  const categories = JSON.parse(catResult.stdout);

  // Query skills in first non-empty category
  const nonEmpty = categories.find((c: { skill_count: number }) => c.skill_count > 0);
  assert.ok(nonEmpty, "Should have at least one non-empty category");

  const skillsResult = runQuery(
    ["--profile", implProfileRelPath(), "category-skills", "--category", nonEmpty.id],
    dir,
  );
  assert.equal(skillsResult.status, 0);
  const skills = JSON.parse(skillsResult.stdout);
  assert.ok(skills.length > 0);
});

test("integration: full pipeline profile → validate → query skill-detail", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  runGenerate(["--adapter", "impl-adapter.yaml"], dir);

  const result = runQuery(
    ["--profile", implProfileRelPath(), "skill-detail", "--skill", "mock-debug-skill"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.name, "mock-debug-skill");
  assert.ok(data.provides.length > 0);
  assert.equal(data.execution_policy.strictness, "rigid");
});

test("integration: full pipeline profile → validate → query validation-status", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  runValidate(
    ["--profile", implProfileRelPath(), "--adapter", "impl-adapter.yaml"],
    dir,
  );

  const result = runQuery(
    ["--profile", implProfileRelPath(), "validation-status"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  // validation-status returns adapter_id from the report
  assert.equal(data.adapter_id, "impl-flow-test");
});

test("integration: infer init/apply editable flow feeds profile", () => {
  const dir = tempDir();
  setupImplFlow(dir);

  const inferencePath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  if (fs.existsSync(inferencePath)) {
    fs.unlinkSync(inferencePath);
  }

  const missingInference = runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(missingInference.status, 2, `stderr: ${missingInference.stderr}`);
  assert.ok(fs.existsSync(path.join(dir, ".sdp", "skill-scan-list.json")), "scan list should be generated");

  const init = runInfer(["init"], dir);
  assert.equal(init.status, 0, `stderr: ${init.stderr}`);

  const opsPath = path.join(dir, ".sdp", "ops.jsonl");
  fs.writeFileSync(
    opsPath,
    JSON.stringify({
      op: "add-uses",
      name: "mock-impl-skill",
      uses: [{ capability: "code_review", required: true, override_allowed: true }],
    }) + "\n",
    "utf8",
  );

  const apply = runInfer(["apply", "--ops", opsPath], dir);
  assert.equal(apply.status, 0, `stderr: ${apply.stderr}`);

  const incomplete = runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(incomplete.status, 3, `stderr: ${incomplete.stderr}`);

  const inferenceDoc = JSON.parse(fs.readFileSync(inferencePath, "utf8"));
  for (const skill of inferenceDoc.skills) {
    skill.review_status = "reviewed";
  }
  fs.writeFileSync(inferencePath, JSON.stringify(inferenceDoc, null, 2), "utf8");

  const generated = runGenerate(["--adapter", "impl-adapter.yaml"], dir);
  assert.equal(generated.status, 0, `stderr: ${generated.stderr}`);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const implSkill = catalog.skills.find((skill: { name: string }) => skill.name === "mock-impl-skill");
  assert.ok(implSkill, "mock-impl-skill should exist in catalog");
  assert.ok(
    implSkill.uses.some((use: { capability: string; required: boolean }) => use.capability === "code_review" && use.required),
    "editable infer apply should persist uses into catalog generation",
  );
});

// ─── Scanner: tilde expansion and external scope support ───

test("integration: user scope with ~ path scans skills from home-relative directory", () => {
  const projectDir = tempDir();
  // Create a "user skills" directory outside the project (simulating ~/.apm/skills)
  const userSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdp-user-skills-"));
  const skillDir = path.join(userSkillsDir, "user-skill-a");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---
name: user-skill-a
description: "A user-level skill"
---
# User Skill A
`, "utf8");
  writeInferenceFile(projectDir, [
    {
      name: "user-skill-a",
      provides: [{ capability: "user_help" }],
      uses: [],
      execution_policy: {
        strictness: "flexible",
        sequence_required: false,
        allow_step_reordering: true,
        allow_partial_application: true,
      },
      tags: ["user"],
    },
  ]);

  // Write adapter that uses absolute path (simulating resolved ~)
  // We use the absolute path directly since ~ expansion maps to os.homedir()
  // and we can't guarantee a skill exists there. Instead test absolute external path.
  const adapterContent = `schema_version: "1.0"
adapter_id: "user-scope-test"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
    user:
      enabled: true
      roots:
        - "${userSkillsDir.replace(/\\/g, "/")}"
profile:
  title: "User Scope Test"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "general"
    severity: "info"
  taxonomy:
    - id: "general"
      label: "General"
      description: "General skills"
      match:
        capabilities: []
        tags: []
        description_patterns: []
invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order: ["default_skill", "provider_lookup"]
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
    capability_mismatch: "warn"
    override_not_allowed: "warn"
validation:
  schema: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
readable_outputs:
  enabled: false
`;
  fs.writeFileSync(path.join(projectDir, "user-adapter.yaml"), adapterContent, "utf8");
  fs.mkdirSync(path.join(projectDir, ".apm/skills"), { recursive: true });

  const result = runGenerate(["--adapter", "user-adapter.yaml"], projectDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectDir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const skillNames = catalog.skills.map((s: { name: string }) => s.name);
  assert.ok(skillNames.includes("user-skill-a"), `Expected user-skill-a in catalog, got: ${skillNames}`);
});

test("integration: project scope rejects paths outside project boundary", () => {
  const projectDir = tempDir();
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdp-external-"));

  const adapterContent = `schema_version: "1.0"
adapter_id: "boundary-test"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
scan:
  scopes:
    project:
      enabled: true
      roots:
        - "${externalDir.replace(/\\/g, "/")}"
profile:
  title: "Boundary Test"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "general"
    severity: "info"
  taxonomy:
    - id: "general"
      label: "General"
      description: "General skills"
      match:
        capabilities: []
        tags: []
        description_patterns: []
invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order: ["default_skill"]
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override: {}
validation:
  schema: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
readable_outputs:
  enabled: false
`;
  fs.writeFileSync(path.join(projectDir, "boundary-adapter.yaml"), adapterContent, "utf8");
  writeInferenceFile(projectDir, []);

  const result = runGenerate(["--adapter", "boundary-adapter.yaml"], projectDir);
  // Should succeed but warn about boundary violation and produce empty catalog
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("outside project boundary"), `Expected boundary warning, got: ${result.stderr}`);
});

test("integration: environment variable in scan root is expanded", () => {
  const projectDir = tempDir();
  // Create external skill dir and set env var pointing to it
  const envSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdp-env-skills-"));
  const skillDir = path.join(envSkillsDir, "env-skill-b");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---
name: env-skill-b
description: "Skill found via env var"
---
# Env Skill B
`, "utf8");
  writeInferenceFile(projectDir, [
    {
      name: "env-skill-b",
      provides: [{ capability: "env_test" }],
      uses: [],
      execution_policy: {
        strictness: "flexible",
        sequence_required: false,
        allow_step_reordering: true,
        allow_partial_application: true,
      },
      tags: ["env"],
    },
  ]);

  // Set env var for this test
  process.env["SDP_TEST_SKILL_DIR"] = envSkillsDir;

  const adapterContent = `schema_version: "1.0"
adapter_id: "env-var-test"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
    user:
      enabled: true
      roots:
        - "\${SDP_TEST_SKILL_DIR}"
profile:
  title: "Env Var Test"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "general"
    severity: "info"
  taxonomy:
    - id: "general"
      label: "General"
      description: "General skills"
      match:
        capabilities: []
        tags: []
        description_patterns: []
invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order: ["default_skill", "provider_lookup"]
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
    capability_mismatch: "warn"
    override_not_allowed: "warn"
validation:
  schema: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
readable_outputs:
  enabled: false
`;
  fs.writeFileSync(path.join(projectDir, "env-adapter.yaml"), adapterContent, "utf8");
  fs.mkdirSync(path.join(projectDir, ".apm/skills"), { recursive: true });

  const result = runGenerate(["--adapter", "env-adapter.yaml"], projectDir);

  // Clean up env var
  delete process.env["SDP_TEST_SKILL_DIR"];

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectDir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const skillNames = catalog.skills.map((s: { name: string }) => s.name);
  assert.ok(skillNames.includes("env-skill-b"), `Expected env-skill-b in catalog, got: ${skillNames}`);
});

test("integration: \${VAR:-default} syntax uses default when env var is unset", () => {
  const projectDir = tempDir();
  // Create skill dir at the "default" location
  const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdp-default-skills-"));
  const skillDir = path.join(defaultDir, "default-skill-c");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---
name: default-skill-c
description: "Skill found via default value"
---
# Default Skill C
`, "utf8");
  writeInferenceFile(projectDir, [
    {
      name: "default-skill-c",
      provides: [{ capability: "default_test" }],
      uses: [],
      execution_policy: {
        strictness: "flexible",
        sequence_required: false,
        allow_step_reordering: true,
        allow_partial_application: true,
      },
      tags: ["default"],
    },
  ]);

  // Ensure the env var is NOT set
  delete process.env["SDP_TEST_UNSET_VAR"];

  const escapedPath = defaultDir.replace(/\\/g, "/");
  const adapterContent = `schema_version: "1.0"
adapter_id: "default-val-test"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
    user:
      enabled: true
      roots:
        - "\${SDP_TEST_UNSET_VAR:-${escapedPath}}"
profile:
  title: "Default Value Test"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "general"
    severity: "info"
  taxonomy:
    - id: "general"
      label: "General"
      description: "General skills"
      match:
        capabilities: []
        tags: []
        description_patterns: []
invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order: ["default_skill"]
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override: {}
validation:
  schema: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
readable_outputs:
  enabled: false
`;
  fs.writeFileSync(path.join(projectDir, "default-adapter.yaml"), adapterContent, "utf8");
  fs.mkdirSync(path.join(projectDir, ".apm/skills"), { recursive: true });

  const result = runGenerate(["--adapter", "default-adapter.yaml"], projectDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const catalog = JSON.parse(
    fs.readFileSync(path.join(projectDir, ".sdp", "skill-reference-catalog.json"), "utf8"),
  );
  const skillNames = catalog.skills.map((s: { name: string }) => s.name);
  assert.ok(skillNames.includes("default-skill-c"), `Expected default-skill-c in catalog, got: ${skillNames}`);
});
