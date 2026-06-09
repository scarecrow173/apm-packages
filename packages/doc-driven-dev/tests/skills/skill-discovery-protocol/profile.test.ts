const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-profile-test-"));
}

function runScan(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "scan.js"), ...args],
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

function runProfile(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "profile.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function markAllInferenceReviewed(dir: string) {
  const inferencePath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  const doc = JSON.parse(fs.readFileSync(inferencePath, "utf8"));
  for (const skill of doc.skills) {
    skill.review_status = "reviewed";
  }
  fs.writeFileSync(inferencePath, JSON.stringify(doc, null, 2), "utf8");
}

function setupProject(dir: string) {
  const skillsDir = path.join(dir, ".apm", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  for (const [name, description, body] of [
    ["profile-skill-a", "Profile test skill A", "Used for profile coverage."],
    ["profile-skill-b", "Profile test skill B", "Used for profile coverage and fallback."],
  ] as const) {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: "${description}"
---

# ${name}

${body}
`,
      "utf8",
    );
  }

  const adapterContent = `schema_version: "1.0"
adapter_id: "profile-test-adapter"

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
  title: "Profile Test"

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
  deterministic:
    enabled: true
    compare:
      - "profile"

render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "profile-test-profile.json"

readable_outputs:
  enabled: false
`;

  fs.writeFileSync(path.join(dir, "profile-test-adapter.yaml"), adapterContent, "utf8");
}

test("sdp profile creates catalog and profile after scan and infer", () => {
  const dir = tempDir();
  setupProject(dir);

  const scan = runScan(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(scan.status, 0, `scan stderr: ${scan.stderr}`);

  const infer = runInfer(["init", "--scan", ".sdp/skill-scan-list.json"], dir);
  assert.equal(infer.status, 0, `infer stderr: ${infer.stderr}`);
  markAllInferenceReviewed(dir);

  const result = runProfile(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(fs.existsSync(path.join(dir, ".sdp", "skill-reference-catalog.json")));
  assert.ok(fs.existsSync(path.join(dir, ".sdp", "profile-test-adapter", "profile-test-profile.json")));
});

test("sdp profile exits 2 when scan list is missing", () => {
  const dir = tempDir();
  setupProject(dir);
  fs.rmSync(path.join(dir, ".sdp", "skill-scan-list.json"), { force: true });

  const result = runProfile(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Skill scan list required"));
  assert.ok(result.stderr.includes("sdp scan --adapter"));
});

test("sdp profile exits 2 when inference is missing", () => {
  const dir = tempDir();
  setupProject(dir);
  runScan(["--adapter", "profile-test-adapter.yaml"], dir);
  fs.rmSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), { force: true });

  const result = runProfile(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("sdp infer init"));
});

test("sdp profile exits 3 when inference is incomplete", () => {
  const dir = tempDir();
  setupProject(dir);
  const scan = runScan(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(scan.status, 0, `scan stderr: ${scan.stderr}`);
  const infer = runInfer(["init", "--scan", ".sdp/skill-scan-list.json"], dir);
  assert.equal(infer.status, 0, `infer stderr: ${infer.stderr}`);

  const result = runProfile(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(result.status, 3, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("pending review"));
  assert.ok(result.stderr.includes("sdp infer check"));
});
