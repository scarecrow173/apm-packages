const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadAdapter } = require(path.resolve(
  __dirname,
  "../../../src/skills/skill-discovery-protocol/scripts/lib/adapter.ts",
));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-adapter-resolution-"));
}

function writeFlowAdapter(dir: string, flowName: string, adapterId: string, title: string) {
  const adapterDir = path.join(dir, ".apm", "skills", flowName, "assets", "adapters");
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, `${flowName}-adapter.yaml`),
    `schema_version: "1.0"
adapter_id: "${adapterId}"
extends:
  - "general"
profile:
  title: "${title}"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "general"
    severity: "warn"
  taxonomy: []
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
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
readable_outputs:
  enabled: false
`,
    "utf8",
  );
  return path.join(adapterDir, `${flowName}-adapter.yaml`);
}

test("loadAdapter resolves general from bundled skill-discovery-protocol assets", () => {
  const dir = tempDir();
  const bundledGeneralDir = path.resolve(
    __dirname,
    "../../../src/skills/skill-discovery-protocol/assets/adapters",
  );
  fs.mkdirSync(path.join(dir, ".apm", "assets", "adapters"), { recursive: true });
  fs.mkdirSync(bundledGeneralDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".apm", "assets", "adapters", "general.yaml"),
    `schema_version: "1.0"
adapter_id: "legacy-general"
scan:
  scopes:
    project:
      enabled: true
      roots:
        - "LEGACY_ROOT_SENTINEL"
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundledGeneralDir, "general.yaml"),
    `# yaml-language-server: $schema=../../../schemas/adapter.schema.json
schema_version: "1.0"
adapter_id: "general"
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
        - ".agents/skills"
        - ".github/skills"
        - ".github/agents"
        - ".cursor/rules"
        - ".claude/commands"
        - ".gemini/skills"
        - ".gemini/commands"
        - ".opencode/skills"
        - "apm_modules"
        - "."
profile:
  title: "General Skill Reference"
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
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
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
readable_outputs:
  enabled: true
  include:
    - "skill_reference_catalog"
`,
    "utf8",
  );

  try {
    const briefingAdapter = writeFlowAdapter(dir, "briefing-flow", "briefing-flow-test", "Briefing Profile");
    const implementationAdapter = writeFlowAdapter(
      dir,
      "implementation-flow",
      "implementation-flow-test",
      "Implementation Profile",
    );

    for (const adapterPath of [briefingAdapter, implementationAdapter]) {
      const adapter = loadAdapter(adapterPath);
      const roots = adapter.scan.scopes.project.roots;

      assert.ok(Array.isArray(roots), "project roots should exist");
      assert.ok(roots.includes(".apm/skills"), "bundled general roots should be present");
      assert.ok(roots.includes(".agents/skills"), "bundled general roots should be present");
      assert.ok(!roots.includes("LEGACY_ROOT_SENTINEL"), "legacy .apm/assets/adapters copy must not be used");
    }
  } finally {
    fs.rmSync(path.join(dir, ".apm"), { recursive: true, force: true });
    fs.rmSync(bundledGeneralDir, { recursive: true, force: true });
  }
});
