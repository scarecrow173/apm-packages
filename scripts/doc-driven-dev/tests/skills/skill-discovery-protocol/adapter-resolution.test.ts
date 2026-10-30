import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  // The bundled adapters dir the built scripts resolve via __dirname
  // (scripts/../assets/adapters). Injected explicitly so the test supplies
  // the bundled location instead of creating it inside the source tree —
  // writing and deleting src/.../assets/adapters during a parallel test run
  // raced doc-suite's entriesUnder walk with intermittent ENOENT.
  const bundledAdaptersDir = path.resolve(
    __dirname,
    "../../../../../packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/adapters",
  );
  assert.ok(
    fs.existsSync(path.join(bundledAdaptersDir, "general.yaml")),
    "bundled general.yaml must exist in the packaged skill assets",
  );

  fs.mkdirSync(path.join(dir, ".apm", "assets", "adapters"), { recursive: true });
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

  try {
    const briefingAdapter = writeFlowAdapter(dir, "briefing-flow", "briefing-flow-test", "Briefing Profile");
    const implementationAdapter = writeFlowAdapter(
      dir,
      "implementation-flow",
      "implementation-flow-test",
      "Implementation Profile",
    );

    for (const adapterPath of [briefingAdapter, implementationAdapter]) {
      const adapter = loadAdapter(adapterPath, { extendsSearchDirs: [bundledAdaptersDir] });
      const roots = adapter.scan.scopes.project.roots;

      assert.ok(Array.isArray(roots), "project roots should exist");
      assert.ok(roots.includes(".apm/skills"), "bundled general roots should be present");
      assert.ok(roots.includes(".agents/skills"), "bundled general roots should be present");
      assert.ok(!roots.includes("LEGACY_ROOT_SENTINEL"), "legacy .apm/assets/adapters copy must not be used");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
