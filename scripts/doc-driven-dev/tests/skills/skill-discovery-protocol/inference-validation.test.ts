const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateInferenceCompleteness,
} = require("../../../src/skills/skill-discovery-protocol/scripts/lib/inference_validation.ts");

function buildScanList() {
  return {
    schema_version: "1.0",
    generated_at: "2026-06-03T00:00:00Z",
    skills: [
      {
        name: "spec-doc",
        description: "Draft specs",
        body: "# Spec",
        skill_path: "/tmp/spec-doc/SKILL.md",
        scope: "project",
      },
      {
        name: "adr-doc",
        description: "Draft ADRs",
        body: "# ADR",
        skill_path: "/tmp/adr-doc/SKILL.md",
        scope: "project",
      },
    ],
  };
}

function buildInferenceDoc(reviewStatuses: Record<string, "pending" | "reviewed">) {
  return {
    schema_version: "1.0",
    generated_at: "2026-06-03T00:00:00Z",
    inference_source: "agent",
    skills: [
      {
        name: "spec-doc",
        review_status: reviewStatuses["spec-doc"],
        provides: [{ capability: "spec_authoring" }],
        uses: [],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
        },
        tags: ["spec"],
      },
      {
        name: "adr-doc",
        review_status: reviewStatuses["adr-doc"],
        provides: [{ capability: "adr_authoring" }],
        uses: [],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
        },
        tags: ["adr"],
      },
    ],
  };
}

test("validateInferenceCompleteness reports pending skills", () => {
  const result = validateInferenceCompleteness(
    buildScanList(),
    buildInferenceDoc({ "spec-doc": "pending", "adr-doc": "reviewed" }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected incomplete inference result");
  }
  assert.deepEqual(result.pending_skills, ["spec-doc"]);
  assert.match(result.message, /pending review/);
});

test("validateInferenceCompleteness passes when every skill is reviewed", () => {
  const result = validateInferenceCompleteness(
    buildScanList(),
    buildInferenceDoc({ "spec-doc": "reviewed", "adr-doc": "reviewed" }),
  );

  assert.deepEqual(result, { ok: true });
});
