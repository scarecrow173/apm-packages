import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../../../packages/doc-driven-dev/.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-validate-test-"));
}

function runValidate(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "validate.js"), ...args],
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

function runGenerate(args: string[], cwd: string) {
  const adapterIndex = args.findIndex((x) => x === "--adapter");
  if (adapterIndex >= 0 && args[adapterIndex + 1]) {
    const scanResult = spawnSync(
      process.execPath,
      [path.join(sdpScripts, "scan.js"), "--adapter", args[adapterIndex + 1]],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if ((scanResult.status ?? 1) !== 0) {
      return {
        status: scanResult.status,
        stdout: scanResult.stdout,
        stderr: scanResult.stderr,
      };
    }
  }

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

function setupTestProject(dir: string) {
  const skillsDir = path.join(dir, ".apm", "skills");

  // Skill A
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

  // Skill B
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

  // Adapter YAML
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
    - slot_id: "build_structure"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "skill-b"
          reason: "Default reviewer"
        - skill: "skill-a"
          reason: "Fallback author"

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
    enabled: true

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
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  writeInferenceFile(dir);
}

function inferenceDocument(skillAUses: { capability: string; required: boolean; default_skill?: string; override_allowed: boolean }[] = [
  {
    capability: "code_review",
    required: false,
    default_skill: "skill-b",
    override_allowed: true,
  },
]) {
  return {
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
        uses: skillAUses,
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
        tags: ["quality"],
      },
    ],
  };
}

function writeInferenceFile(dir: string, document = inferenceDocument()) {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(document, null, 2),
    "utf8",
  );
}

/** Generate artifacts so we have valid profile/catalog to validate */
function generateArtifacts(dir: string) {
  const result = runGenerate(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `Generate failed: ${result.stderr}`);
}

// ─── Validate: CLI Tests ───

test("validate --help shows usage", () => {
  const dir = tempDir();
  const result = runValidate(["--help"], dir);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("Usage:"));
});

test("validate without args exits 2", () => {
  const dir = tempDir();
  const result = runValidate([], dir);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("--profile or --adapter is required"));
});

test("validate --profile missing file exits 2", () => {
  const dir = tempDir();
  const result = runValidate(["--profile", "nonexistent.json"], dir);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Profile not found"));
});

test("validate rejects profile path outside project boundary", () => {
  const dir = tempDir();
  const outsideProfilePath = path.join(path.dirname(dir), "outside-profile.json");
  fs.writeFileSync(outsideProfilePath, JSON.stringify({ schema_version: "1.0" }), "utf8");

  const relativeOutsidePath = path.relative(dir, outsideProfilePath);
  const result = runValidate(["--profile", relativeOutsidePath], dir);

  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("outside project boundary"));
});

test("validate --profile invalid JSON exits 2", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "bad.json"), "not json", "utf8");
  const result = runValidate(["--profile", "bad.json"], dir);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Invalid JSON"));
});

// ─── Validate: Adapter-only mode ───

test("validate --adapter passes for valid adapter", () => {
  const dir = tempDir();
  setupTestProject(dir);
  const result = runValidate(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("Adapter validation passed"));
});

test("validate --adapter fails for missing adapter", () => {
  const dir = tempDir();
  const result = runValidate(["--adapter", "nope.yaml"], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("Adapter validation failed"));
});

// ─── Validate: Full 4-gate (all pass) ───

test("validate --profile with valid artifacts: all gates pass", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Overall:       pass"));

  // Check validation-report.json was created
  const reportPath = path.join(dir, ".sdp", "test-adapter", "validation-report.json");
  assert.ok(fs.existsSync(reportPath), "validation-report.json should exist");

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.schema_version, "1.0");
  assert.equal(report.overall_result, "pass");
  assert.equal(report.schema_validation.result, "pass");
  assert.equal(report.staleness_validation.result, "pass");
  assert.equal(report.deterministic_validation.result, "pass");
  assert.equal(report.blocking_validations.result, "pass");
  assert.ok(report.generated_at);
  assert.equal(report.adapter_id, "test-adapter");
});

test("validate writes validation-report.json next to adapter-scoped profile", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  const adapterDir = path.join(dir, ".sdp", "test-adapter");
  const scopedProfilePath = path.join(adapterDir, "test-adapter-profile.json");
  assert.ok(fs.existsSync(scopedProfilePath), "profile should exist under adapter-scoped path");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const scopedReportPath = path.join(adapterDir, "validation-report.json");
  assert.ok(fs.existsSync(scopedReportPath), "validation-report.json should exist next to profile");
});

// ─── Validate: Schema gate fails ───

test("validate schema gate detects missing fields", () => {
  const dir = tempDir();
  setupTestProject(dir);
  fs.mkdirSync(path.join(dir, ".sdp", "test-adapter"), { recursive: true });

  // Write a profile missing required fields
  const badProfile = {
    schema_version: "1.0",
    flow_name: "test",
    // missing adapter_id, flow_stack, classification, resolved_invocations, etc.
  };
  fs.writeFileSync(
    path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json"),
    JSON.stringify(badProfile, null, 2),
    "utf8",
  );

  const result = runValidate(["--profile", ".sdp/test-adapter/test-adapter-profile.json"], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Schema:        fail"));
  assert.ok(result.stderr.includes("Missing required field"));
});

test("validate schema gate detects non-snake_case slot_id", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Modify profile to have non-snake_case slot
  const profilePath = path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  profile.flow_stack.slots[0].slot_id = "BadSlotName";
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

  const result = runValidate(["--profile", profilePath], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("snake_case"));
});

// ─── Validate: Staleness gate ───

test("validate refreshes aged validated_at when all other gates pass", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Modify catalog validated_at to 60 days ago — pure-age staleness. The
  // artifacts' content is proven current by the schema and deterministic
  // gates, so validate re-stamps validated_at in-band and the run passes.
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  catalog.validated_at = oldDate;
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Staleness:     pass"));
  assert.ok(result.stdout.includes("Refreshed validated_at"));

  const refreshed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.notEqual(refreshed.validated_at, oldDate);
  assert.ok(
    new Date(refreshed.validated_at).getTime() > new Date(oldDate).getTime(),
    "validate must write back a newer validated_at",
  );
});

test("validate staleness gate detects new skills", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Add a third skill after generating
  const skillCDir = path.join(dir, ".apm", "skills", "skill-c");
  fs.mkdirSync(skillCDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillCDir, "SKILL.md"),
    `---
name: skill-c
description: "A new skill"
---

# Skill C

Use this skill for testing.
`,
    "utf8",
  );

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Staleness:     fail"));

  // Check report has new_skills
  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.ok(report.staleness_validation.new_skills.includes("skill-c"));
});

test("validate staleness gate detects removed skills", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Remove skill-b after generating
  fs.rmSync(path.join(dir, ".apm", "skills", "skill-b"), { recursive: true });

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1);

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.ok(report.staleness_validation.removed_skills.includes("skill-b"));
});

// ─── Validate: Deterministic gate ───

test("validate deterministic gate passes when artifacts are fresh", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Deterministic: pass"));
});

test("validate deterministic gate fails on modified profile", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Modify profile content (not timestamp)
  const profilePath = path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  profile.warnings = ["injected warning"];
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Deterministic: fail"));
});

test("validate deterministic gate skipped without --adapter", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  const result = runValidate(["--profile", ".sdp/test-adapter/test-adapter-profile.json"], dir);
  assert.ok(result.stdout.includes("Deterministic: skipped"));
});

test("validate deterministic.enabled: false skips the gate and the report reflects it", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // The flag — not `compare` — controls the gate: `compare` stays
  // populated, yet `enabled: false` must skip the gate entirely.
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    "  deterministic:\n    enabled: true",
    "  deterministic:\n    enabled: false",
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Deterministic: skipped"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.equal(report.deterministic_validation.result, "skipped");
  assert.equal(report.deterministic_validation.comparisons.length, 0);
  assert.ok(report.deterministic_validation.reason);
  assert.equal(report.overall_result, "pass");

  // A skipped deterministic gate is not currency evidence: the run must
  // not re-stamp validated_at it never verified.
  assert.ok(
    !result.stdout.includes("Refreshed validated_at"),
    `disabled gate must not refresh: ${result.stdout}`,
  );
});

test("validate deterministic.enabled: false does not self-heal age-stale artifacts via refresh", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    "  deterministic:\n    enabled: true",
    "  deterministic:\n    enabled: false",
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  // Pure-age staleness: the deterministic gate is the only gate that
  // proves artifact *content* is current, and it is disabled — so the
  // stale timestamp must stay a failure instead of being repaired in-band.
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  catalog.validated_at = agedDate;
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(
    result.status,
    1,
    `skipped gate is not currency proof — stale timestamp must stay a failure: ${result.stderr}\n${result.stdout}`,
  );
  assert.ok(result.stdout.includes("Deterministic: skipped"));
  assert.ok(result.stdout.includes("Staleness:     fail"));
  assert.ok(!result.stdout.includes("Refreshed validated_at"));

  const onDisk = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(onDisk.validated_at, agedDate, "validated_at must not be re-stamped over unverified content");
});

test("validate deterministic gate runs when enabled is absent (default true)", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // Omitting `enabled` defaults to true in loadAdapter — the gate runs.
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    "  deterministic:\n    enabled: true\n",
    "  deterministic:\n",
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Deterministic: pass"));
});

test("validate staleness.enabled: false skips the staleness gate", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    "  staleness:\n    enabled: true",
    "  staleness:\n    enabled: false",
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Staleness:     skipped"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.equal(report.staleness_validation.result, "skipped");
  // The deterministic pass still proves content currency, so the overall
  // run passes with the staleness gate disabled.
  assert.equal(report.deterministic_validation.result, "pass");
  assert.equal(report.overall_result, "pass");
});

// ─── Validate: validation.schema flag ───

test("validate validation.schema: false skips the schema gate", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // `schema: false` skips the baseline structural gate — the flag, not
  // artifact presence, decides whether it runs (the same semantics the
  // other gates' `enabled` flags already had).
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace("  schema: true", "  schema: false");
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Schema:        skipped"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.equal(report.schema_validation.result, "skipped");
  assert.equal(report.schema_validation.errors.length, 0);
  assert.equal(report.overall_result, "pass");
});

test("validate validation.schema: false does not self-heal age-stale artifacts via refresh", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace("  schema: true", "  schema: false");
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  // Pure-age staleness: with the schema gate skipped, no gate inspected
  // the artifacts' structure — the stale timestamp must stay a failure
  // instead of being repaired in-band.
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  catalog.validated_at = agedDate;
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(
    result.status,
    1,
    `skipped schema gate is not currency proof — stale timestamp must stay a failure: ${result.stderr}\n${result.stdout}`,
  );
  assert.ok(result.stdout.includes("Schema:        skipped"));
  assert.ok(result.stdout.includes("Staleness:     fail"));
  assert.ok(!result.stdout.includes("Refreshed validated_at"));

  const onDisk = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(onDisk.validated_at, agedDate, "validated_at must not be re-stamped over unverified content");
});

test("validate validation.schema: false still fails on content drift via the deterministic gate", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace("  schema: true", "  schema: false");
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  // Removing a required field is a schema break the skipped gate would
  // have reported — but the deterministic gate still catches the content
  // drift, so the run must not pass.
  const profilePath = path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  delete profile.adapter_id;
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Schema:        skipped"));
  assert.ok(result.stdout.includes("Deterministic: fail"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.equal(report.schema_validation.result, "skipped");
  assert.equal(report.deterministic_validation.result, "fail");
  assert.equal(report.overall_result, "fail");
});

// ─── Validate: deterministic compare entries select artifacts ───

test("validate deterministic compare profile+catalog-artifacts detects catalog drift", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // `profile+catalog-artifacts` is a composite selector: it must compare
  // BOTH regenerated artifacts — not just the profile. Catalog drift the
  // bare "profile" entry misses must fail this gate.
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    '    compare:\n      - "profile"',
    '    compare:\n      - "profile+catalog-artifacts"',
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  // Tamper with catalog content (not a timestamp, not a schema break —
  // the description stays a string) so only the deterministic gate sees it.
  const catalogPath = path.join(dir, ".sdp", "skill-reference-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  catalog.skills[0].description = "tampered description";
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(
    result.status,
    1,
    `catalog drift must fail the deterministic gate: ${result.stderr}\n${result.stdout}`,
  );
  assert.ok(result.stdout.includes("Deterministic: fail"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  const catalogComparison = report.deterministic_validation.comparisons.find(
    (c: { target: string }) => c.target === "catalog",
  );
  assert.ok(catalogComparison, "catalog must be a comparison target");
  assert.equal(catalogComparison.diff_found, true);
});

test("validate deterministic compare entries naming no artifact leave no targets", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // `validation-report:exclude-timestamp` is documentational: the gate
  // regenerates the profile and catalog, never a validation report, so
  // the entry selects no artifact. A compare list selecting nothing
  // leaves the gate with no targets and it reports "skipped".
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const modified = adapterContent.replace(
    '    compare:\n      - "profile"',
    '    compare:\n      - "validation-report:exclude-timestamp"',
  );
  assert.notEqual(modified, adapterContent, "adapter yaml must have been modified");
  fs.writeFileSync(adapterPath, modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes("Deterministic: skipped"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.equal(report.deterministic_validation.result, "skipped");
  assert.ok(report.deterministic_validation.reason.includes("No artifacts"));
  // A skipped deterministic gate is not currency evidence either.
  assert.ok(!result.stdout.includes("Refreshed validated_at"));
});

// ─── Validate: Blocking gate ───

test("validate blocking gate detects unresolved required capability", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // Modify inferred references so skill-a requires a capability nobody provides.
  writeInferenceFile(
    dir,
    inferenceDocument([
      {
        capability: "nonexistent_capability",
        required: true,
        override_allowed: true,
      },
    ]),
  );

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Blocking:      fail"));

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  const unresolvedCheck = report.blocking_validations.checks.find(
    (c: { type: string }) => c.type === "unresolved_required",
  );
  assert.equal(unresolvedCheck.result, "fail");
  assert.ok(unresolvedCheck.details.length > 0);
});

test("validate blocking gate detects unknown skill override", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // Modify adapter to have override referencing non-existent skill
  const adapterContent = fs.readFileSync(path.join(dir, "test-adapter.yaml"), "utf8");
  const modified = adapterContent.replace(
    "  slots: {}",
    `  slots:
      adr_authoring:
        use: "ghost-skill"
        reason: "test"`,
  );
  fs.writeFileSync(path.join(dir, "test-adapter.yaml"), modified, "utf8");

  generateArtifacts(dir);

  const result = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1);

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  const unknownCheck = report.blocking_validations.checks.find(
    (c: { type: string }) => c.type === "unknown_skill_override",
  );
  assert.equal(unknownCheck.result, "fail");
});

// ─── Validate: Report Structure ───

test("validation-report.json has correct structure", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );

  // Top-level keys
  assert.equal(typeof report.schema_version, "string");
  assert.equal(typeof report.generated_at, "string");
  assert.equal(typeof report.repository, "string");
  assert.equal(typeof report.adapter_id, "string");
  assert.equal(typeof report.overall_result, "string");

  // schema_validation
  assert.ok(["pass", "fail"].includes(report.schema_validation.result));
  assert.ok(Array.isArray(report.schema_validation.errors));

  // staleness_validation
  assert.equal(report.staleness_validation.basis, "validated_at");
  assert.equal(typeof report.staleness_validation.max_age_days, "number");
  assert.equal(typeof report.staleness_validation.age_days, "number");
  assert.ok(Array.isArray(report.staleness_validation.new_skills));
  assert.ok(Array.isArray(report.staleness_validation.removed_skills));

  // deterministic_validation
  assert.ok(Array.isArray(report.deterministic_validation.comparisons));

  // blocking_validations
  assert.ok(Array.isArray(report.blocking_validations.checks));

  // catalog_validation
  assert.equal(typeof report.catalog_validation.skill_count, "number");
  assert.equal(typeof report.catalog_validation.reference_count, "number");
  assert.equal(typeof report.catalog_validation.capability_count, "number");
  assert.ok(Array.isArray(report.catalog_validation.orphan_skills));

  // profile_validation
  assert.equal(typeof report.profile_validation.flow_count, "number");
  assert.equal(typeof report.profile_validation.flow_stack_slot_count, "number");
  assert.ok(Array.isArray(report.profile_validation.unresolved_slots));
  assert.equal(typeof report.profile_validation.resolved_invocation_count, "number");
  assert.ok(Array.isArray(report.profile_validation.unused_override_warnings));
});

test("validate catalog_validation counts are correct", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );

  assert.equal(report.catalog_validation.skill_count, 2);
  assert.equal(report.profile_validation.flow_stack_slot_count, 2);
  // skill-a provides adr_authoring, skill-b provides code_review = 2 capabilities
  assert.equal(report.catalog_validation.capability_count, 2);
});

test("validate overall_result is fail when any gate fails", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Corrupt profile to fail schema
  const profilePath = path.join(dir, ".sdp", "test-adapter", "test-adapter-profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  delete profile.adapter_id;
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

  const result = runValidate(["--profile", ".sdp/test-adapter/test-adapter-profile.json"], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Overall:       fail"));
});

test("validate profile_validation detects unused override warnings", () => {
  const dir = tempDir();
  setupTestProject(dir);

  // Add unused capability override to adapter
  const adapterContent = fs.readFileSync(path.join(dir, "test-adapter.yaml"), "utf8");
  const modified = adapterContent.replace(
    "  capabilities: {}",
    `  capabilities:
      unused_cap:
        prefer: "skill-b"
        reason: "never used"`,
  );
  fs.writeFileSync(path.join(dir, "test-adapter.yaml"), modified, "utf8");

  generateArtifacts(dir);

  runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );

  const report = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "test-adapter", "validation-report.json"), "utf8"),
  );
  assert.ok(report.profile_validation.unused_override_warnings.length > 0);
  assert.ok(
    report.profile_validation.unused_override_warnings[0].includes("unused_cap"),
  );
});

test("validate exit code 0 when all pass, 1 when fail, 2 on input error", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // All pass
  const pass = runValidate(
    ["--profile", ".sdp/test-adapter/test-adapter-profile.json", "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(pass.status, 0);

  // Input error
  const inputErr = runValidate(["--blah"], dir);
  assert.equal(inputErr.status, 2);
});

// ─── Validate: malformed artifact shapes (fail-closed boundary) ───
// Every mis-typed artifact must yield a gate-fail report (exit 1), never
// an uncaught exception before validation-report.json is written (exit 2).

const PROFILE_REL = ".sdp/test-adapter/test-adapter-profile.json";
const CATALOG_REL = ".sdp/skill-reference-catalog.json";
const REPORT_REL = ".sdp/test-adapter/validation-report.json";

function reportJson(dir: string) {
  const reportPath = path.join(dir, REPORT_REL);
  assert.ok(fs.existsSync(reportPath), "validation-report.json must be written");
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

test("mis-typed artifact fields produce a gate-fail report, not a crash", () => {
  // Each mutation used to crash a `.map`/iteration before the report
  // write: truthy non-arrays like {} and "x" sail through `?? []`.
  const profileMutations: Record<string, unknown>[] = [
    { resolved_invocations: {} },
    { resolved_invocations: "x" },
    { flow_stack: { slots: "x" } },
  ];
  for (const patch of profileMutations) {
    const dir = tempDir();
    setupTestProject(dir);
    generateArtifacts(dir);

    const profilePath = path.join(dir, PROFILE_REL);
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    Object.assign(profile, patch);
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

    const result = runValidate(
      ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
      dir,
    );
    assert.equal(
      result.status,
      1,
      `patch ${JSON.stringify(patch)}: expected exit 1, got ${result.status} — ${result.stderr}`,
    );
    const report = reportJson(dir);
    assert.equal(report.schema_validation.result, "fail");
    assert.equal(report.overall_result, "fail");
  }

  // Mis-typed catalog skills: {} and a primitive profile document.
  const dir2 = tempDir();
  setupTestProject(dir2);
  generateArtifacts(dir2);
  const catalogPath = path.join(dir2, CATALOG_REL);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  catalog.skills = {};
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const catResult = runValidate(
    ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
    dir2,
  );
  assert.equal(catResult.status, 1, `catalog skills {}: ${catResult.stderr}`);
  assert.equal(reportJson(dir2).overall_result, "fail");

  const dir3 = tempDir();
  setupTestProject(dir3);
  generateArtifacts(dir3);
  fs.writeFileSync(path.join(dir3, PROFILE_REL), "null", "utf8");
  const litResult = runValidate(
    ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
    dir3,
  );
  assert.equal(litResult.status, 1, `literal profile: ${litResult.stderr}`);
  assert.equal(reportJson(dir3).schema_validation.result, "fail");
});

test("null array elements in artifacts produce a report, not a crash", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  const profilePath = path.join(dir, PROFILE_REL);
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  profile.resolved_invocations = [null];
  profile.flow_stack.slots = [null];
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

  const catalogPath = path.join(dir, CATALOG_REL);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  catalog.skills = [null];
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1, `null elements: ${result.stderr}`);
  const report = reportJson(dir);
  assert.equal(report.schema_validation.result, "fail");
  assert.equal(report.overall_result, "fail");
});

test("adapter missing invocation_resolution inner keys produces a report, not a crash", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // loadAdapter only checks top-level required keys — an adapter whose
  // invocation_resolution omits unresolved/invalid_override must not
  // crash the blocking gate before the report write.
  const adapterPath = path.join(dir, "test-adapter.yaml");
  const adapterContent = fs.readFileSync(adapterPath, "utf8");
  const stripped = adapterContent
    .replace(/  unresolved:\n    required: "fail"\n    optional: "warn"\n/, "")
    .replace(/  invalid_override:\n    unknown_skill: "fail"\n    capability_mismatch: "warn"\n    override_not_allowed: "warn"\n/, "");
  assert.notEqual(stripped, adapterContent, "adapter yaml must have been stripped");
  fs.writeFileSync(adapterPath, stripped, "utf8");

  const result = runValidate(
    ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1, `stripped adapter: ${result.stderr}`);
  const report = reportJson(dir);
  assert.equal(report.overall_result, "fail");
});

test("refresh failure on a read-only artifact warns but still writes the report and passes", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Age the catalog so the refresh path is exercised (pure-age staleness).
  const catalogPath = path.join(dir, CATALOG_REL);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  catalog.validated_at = agedDate;
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  // Read-only artifact: the re-stamp write must fail without killing the run.
  fs.chmodSync(catalogPath, 0o444);
  try {
    const result = runValidate(
      ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
      dir,
    );
    assert.equal(
      result.status,
      0,
      `refresh failure must not fail the run: ${result.stderr}\n${result.stdout}`,
    );
    assert.ok(result.stdout.includes("Overall:       pass"));
    assert.ok(
      result.stderr.includes("could not refresh validated_at"),
      `expected a refresh warning on stderr, got: ${result.stderr}`,
    );

    const report = reportJson(dir);
    assert.equal(report.overall_result, "pass");

    // The failed write leaves the aged timestamp on disk untouched.
    const onDisk = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.equal(onDisk.validated_at, agedDate);
  } finally {
    fs.chmodSync(catalogPath, 0o666);
  }
});

test("schema-only run (no --adapter) never refreshes validated_at", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // Age the catalog 60 days: with no --adapter the staleness gate is
  // skipped, so a schema-only pass must not re-stamp freshness it never
  // checked.
  const catalogPath = path.join(dir, CATALOG_REL);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  catalog.validated_at = agedDate;
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(["--profile", PROFILE_REL], dir);
  assert.equal(result.status, 0, `schema-only run: ${result.stderr}`);
  assert.ok(result.stdout.includes("Staleness:     skipped"));
  assert.ok(
    !result.stdout.includes("Refreshed validated_at"),
    `schema-only run must not refresh: ${result.stdout}`,
  );

  const onDisk = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(onDisk.validated_at, agedDate, "aged validated_at must be preserved");

  const report = reportJson(dir);
  assert.equal(report.staleness_validation.result, "skipped");
  assert.equal(report.overall_result, "pass");
});

test("unparseable validated_at fails the staleness gate and is not refreshed over", () => {
  const dir = tempDir();
  setupTestProject(dir);
  generateArtifacts(dir);

  // A garbage basis date parses to NaN — NaN > max_age_days is false, so
  // without the guard the age check silently passed.
  const catalogPath = path.join(dir, CATALOG_REL);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  catalog.validated_at = "not-a-date";
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

  const result = runValidate(
    ["--profile", PROFILE_REL, "--adapter", "test-adapter.yaml"],
    dir,
  );
  assert.equal(result.status, 1, `garbage validated_at must fail: ${result.stderr}`);
  assert.ok(result.stdout.includes("Staleness:     fail"));

  const report = reportJson(dir);
  assert.equal(report.staleness_validation.result, "fail");
  assert.equal(report.staleness_validation.basis_date, "not-a-date");

  // A corrupt timestamp is not an "expired" one — the refresh path must
  // not stamp validated over it.
  const onDisk = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(onDisk.validated_at, "not-a-date");
});
