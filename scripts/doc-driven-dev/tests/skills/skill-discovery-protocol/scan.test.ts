const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../../../packages/doc-driven-dev/.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-scan-test-"));
}

function runScan(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "scan.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runSdpScan(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, "sdp.js"), "scan", ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function setupProject(dir: string) {
  const skillsDir = path.join(dir, ".apm", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const skillDir = path.join(skillsDir, "scan-skill-a");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---
name: scan-skill-a
description: "Scan test skill"
---

# Scan Skill A

Used for scan coverage.
`,
    "utf8",
  );

  const adapterContent = `schema_version: "1.0"
adapter_id: "scan-test-adapter"

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
  title: "Scan Test Profile"

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
    flow_profile: "scan-test-profile.json"

readable_outputs:
  enabled: false
`;

  fs.writeFileSync(path.join(dir, "scan-test-adapter.yaml"), adapterContent, "utf8");
}

test("sdp scan writes skill-scan-list.json from adapter scopes", () => {
  const dir = tempDir();
  setupProject(dir);

  const result = runScan(["--adapter", "scan-test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const scanPath = path.join(dir, ".sdp", "skill-scan-list.json");
  assert.ok(fs.existsSync(scanPath), "scan list should exist");

  const doc = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.skills.length, 1);
  assert.equal(doc.skills[0].name, "scan-skill-a");
});

test("sdp scan without --adapter exits 1", () => {
  const dir = tempDir();
  const result = runScan([], dir);
  assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("--adapter is required"));
});

test("sdp.js scan --help returns 0", () => {
  const dir = tempDir();
  const result = runSdpScan(["--help"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Usage: sdp scan --adapter <adapter-yaml>"));
});

test("sdp scan includes skill with unquoted colon-space in description as name-only fallback", () => {
  const dir = tempDir();
  setupProject(dir); // scan-skill-a を含む通常プロジェクトをセットアップ

  // YAML パースが壊れる description を持つスキルを追加
  const badSkillDir = path.join(dir, ".apm", "skills", "bad-yaml-skill");
  fs.mkdirSync(badSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(badSkillDir, "SKILL.md"),
    `---
name: bad-yaml-skill
description: A skill that uses: colon space in description
---

# Bad Yaml Skill
`,
    "utf8",
  );

  const result = runScan(["--adapter", "scan-test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const scanPath = path.join(dir, ".sdp", "skill-scan-list.json");
  const doc = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  // 正常スキルは含まれる
  assert.ok(doc.skills.some((s: { name: string }) => s.name === "scan-skill-a"), "scan-skill-a should be included");

  // YAML パースエラーのスキルもフォールバックとして含まれる（スキップされない）
  const fallback = doc.skills.find((s: { name: string }) => s.name === "bad-yaml-skill");
  assert.ok(fallback, "bad-yaml-skill should be included as fallback, not skipped");
  assert.equal(fallback.description, "", "description should be empty string on parse failure");

  // 警告が stderr に出力されている
  assert.ok(result.stderr.includes("bad-yaml-skill") || result.stderr.includes("YAML"), `expected YAML warning in stderr, got: ${result.stderr}`);
});
