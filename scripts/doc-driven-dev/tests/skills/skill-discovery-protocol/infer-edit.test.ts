const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../../../packages/doc-driven-dev/.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-infer-edit-test-"));
}

function runInfer(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(sdpScripts, "infer.js"), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function baselineInference() {
  return {
    schema_version: "1.0",
    generated_at: "2026-06-01T00:00:00Z",
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

test("sdp infer init creates schema-valid baseline from scan list", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-scan-list.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-01T00:00:00Z",
        skills: [
          {
            name: "spec-doc",
            description: "Draft specs",
            body: "# Spec Doc",
            skill_path: "/tmp/spec-doc/SKILL.md",
            scope: "project",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer(["init"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  assert.ok(fs.existsSync(inferPath));
  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.inference_source, "agent");
  assert.equal(doc.skills[0].name, "spec-doc");
});

test("sdp infer apply updates inference document through JSONL ops", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(inferPath, JSON.stringify(baselineInference(), null, 2), "utf8");

  const opsPath = path.join(dir, ".sdp", "ops.jsonl");
  fs.writeFileSync(
    opsPath,
    [
      JSON.stringify({
        op: "add-provides",
        name: "spec-doc",
        provides: [{ capability: "code_review", description: "Review code" }],
      }),
      JSON.stringify({
        op: "add-uses",
        name: "spec-doc",
        uses: [{ capability: "adr_authoring", required: true, override_allowed: true }],
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const result = runInfer(["apply", "--ops", opsPath, "--in", inferPath], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.ok(doc.skills[0].provides.some((p: { capability: string }) => p.capability === "code_review"));
  assert.ok(doc.skills[0].uses.some((u: { capability: string }) => u.capability === "adr_authoring"));
});

test("sdp infer apply rolls back when one op is invalid", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  const base = baselineInference();
  fs.writeFileSync(inferPath, JSON.stringify(base, null, 2), "utf8");

  const opsPath = path.join(dir, ".sdp", "ops-invalid.jsonl");
  fs.writeFileSync(
    opsPath,
    [
      JSON.stringify({ op: "add-provides", name: "spec-doc", provides: [{ capability: "code_review" }] }),
      JSON.stringify({ op: "invalid-op", name: "spec-doc" }),
    ].join("\n") + "\n",
    "utf8",
  );

  const result = runInfer(["apply", "--ops", opsPath, "--in", inferPath], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);

  const after = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.deepEqual(after, base);
});

test("sdp infer check validates existing inference file", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-scan-list.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-01T00:00:00Z",
        skills: [
          {
            name: "spec-doc",
            description: "Draft specs",
            body: "# Spec Doc",
            skill_path: "/tmp/spec-doc/SKILL.md",
            scope: "project",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(inferPath, JSON.stringify(baselineInference(), null, 2), "utf8");

  const result = runInfer(["check", "--in", inferPath, "--scan", ".sdp/skill-scan-list.json"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
});

test("sdp infer set-skill upserts one skill", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(inferPath, JSON.stringify(baselineInference(), null, 2), "utf8");

  const specPath = path.join(dir, ".sdp", "skill.json");
  fs.writeFileSync(
    specPath,
    JSON.stringify(
      {
        review_status: "reviewed",
        provides: [{ capability: "test_planning", description: "Plan tests" }],
        uses: [{ capability: "spec_authoring", required: true, override_allowed: false }],
        execution_policy: {
          strictness: "rigid",
          sequence_required: true,
          allow_step_reordering: false,
          allow_partial_application: false,
        },
        tags: ["test"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer(["set-skill", "--name", "test-driven-development", "--spec", specPath, "--in", inferPath], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  const inserted = doc.skills.find((s: { name: string }) => s.name === "test-driven-development");
  assert.ok(inserted);
  assert.equal(inserted.review_status, "reviewed");
});

test("sdp infer delete-skill removes one skill", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  const base = baselineInference();
  base.skills.push({
    name: "task-doc",
    review_status: "reviewed",
    provides: [{ capability: "task_management" }],
    uses: [],
    execution_policy: {
      strictness: "flexible",
      sequence_required: false,
      allow_step_reordering: true,
      allow_partial_application: true,
    },
    tags: ["task"],
  });
  fs.writeFileSync(inferPath, JSON.stringify(base, null, 2), "utf8");

  const result = runInfer(["delete-skill", "--name", "task-doc", "--in", inferPath], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.equal(doc.skills.some((s: { name: string }) => s.name === "task-doc"), false);
});
