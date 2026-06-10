const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../../../packages/doc-driven-dev/.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-infer-test-"));
}

function runInfer(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(sdpScripts, "infer.js"), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runSdpInfer(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(sdpScripts, "sdp.js"), "infer", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeScanList(dir: string, skillName = "skill-a") {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-scan-list.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-01T00:00:00Z",
        skills: [
          {
            name: skillName,
            description: "A skill",
            body: "# Skill\nUsed in agent inference path",
            skill_path: `/tmp/${skillName}/SKILL.md`,
            scope: "project",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

test("sdp infer generates skill-reference-inferences.json from scan list", () => {
  const dir = tempDir();
  writeScanList(dir);

  const result = runInfer([], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  assert.ok(fs.existsSync(inferPath), "inference file should exist");

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.inference_source, "agent");
  assert.equal(doc.skills.length, 1);
  assert.equal(doc.skills[0].name, "skill-a");
  assert.equal(doc.skills[0].review_status, "pending");
  assert.ok(Array.isArray(doc.skills[0].provides), "provides should be an array");
  assert.ok(Array.isArray(doc.skills[0].uses), "uses should be an array");
  assert.deepEqual(doc.skills[0].provides, [], "agent mode baseline should not infer provides automatically");
  assert.deepEqual(doc.skills[0].tags, [], "agent mode baseline should not infer tags automatically");
  assert.equal(
    typeof doc.skills[0].execution_policy,
    "object",
    "execution_policy should be an object",
  );
  assert.ok(doc.skills[0].execution_policy, "execution_policy should be present");
});

test("sdp infer overwrites existing inference file with regenerated schema-shaped document", () => {
  const dir = tempDir();
  writeScanList(dir);

  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(
      {
        schema_version: "0.0",
        dummy: true,
        skills: [{ name: "dummy-skill" }],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer(["init", "--if-exists", "overwrite"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));

  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.inference_source, "agent");
  assert.ok(Array.isArray(doc.skills), "skills should be an array");
  assert.equal(doc.skills.length, 1);
  assert.equal(doc.skills[0].name, "skill-a");
  assert.equal(doc.skills[0].review_status, "pending");
  assert.ok(Array.isArray(doc.skills[0].provides), "provides should be an array");
  assert.ok(Array.isArray(doc.skills[0].uses), "uses should be an array");
  assert.equal(
    typeof doc.skills[0].execution_policy,
    "object",
    "execution_policy should be an object",
  );
  assert.ok(doc.skills[0].execution_policy, "execution_policy should be present");
  assert.equal((doc as { dummy?: boolean }).dummy, undefined);
});

test("sdp infer exits 2 when scan list is missing", () => {
  const dir = tempDir();
  const result = runInfer([], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Scan list not found"));
});

test("sdp infer uses agent inference source", () => {
  const dir = tempDir();
  writeScanList(dir);

  const result = runInfer([], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const doc = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), "utf8"),
  );
  assert.equal(doc.inference_source, "agent");
});

test("sdp.js infer --help returns 0 and usage mentions sdp infer", () => {
  const dir = tempDir();
  const result = runSdpInfer(["--help"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("sdp infer init"));
});

test("sdp.js infer exits 2 when scan list is missing", () => {
  const dir = tempDir();
  const result = runSdpInfer([], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Scan list not found"));
});

test("sdp infer exits 2 when --scan value is missing", () => {
  const dir = tempDir();
  const result = runInfer(["--scan"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Option --scan requires a value"));
});

test("sdp infer init creates editable baseline without rule-based inference", () => {
  const dir = tempDir();
  writeScanList(dir, "spec-review-test-skill");

  const result = runInfer(["init"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const doc = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), "utf8"),
  );

  assert.deepEqual(doc.skills[0].provides, []);
  assert.deepEqual(doc.skills[0].uses, []);
  assert.deepEqual(doc.skills[0].tags, []);
  assert.equal(doc.skills[0].review_status, "pending");
  assert.equal(doc.skills[0].execution_policy.strictness, "flexible");
  assert.equal(doc.skills[0].execution_policy.sequence_required, false);
});

test("sdp infer check exits 3 when pending skills remain", () => {
  const dir = tempDir();
  writeScanList(dir);
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(
    inferPath,
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-03T00:00:00Z",
        inference_source: "agent",
        skills: [
          {
            name: "skill-a",
            review_status: "pending",
            provides: [],
            uses: [],
            execution_policy: {
              strictness: "flexible",
              sequence_required: false,
              allow_step_reordering: true,
              allow_partial_application: true,
            },
            tags: [],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer(["check", "--in", inferPath, "--scan", ".sdp/skill-scan-list.json"], dir);
  assert.equal(result.status, 3, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("pending review"));
});

test("sdp infer check validates existing reviewed inference file", () => {
  const dir = tempDir();
  writeScanList(dir, "spec-doc");
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(inferPath, JSON.stringify(baselineInferenceForCheck(), null, 2), "utf8");

  const result = runInfer(["check", "--in", inferPath, "--scan", ".sdp/skill-scan-list.json"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
});

function baselineInferenceForCheck() {
  return {
    schema_version: "1.0",
    generated_at: "2026-06-03T00:00:00Z",
    inference_source: "agent",
    skills: [
      {
        name: "spec-doc",
        review_status: "reviewed",
        provides: [{ capability: "spec_authoring", description: "Draft specifications" }],
        uses: [],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
        },
        tags: ["spec"],
      },
    ],
  };
}
