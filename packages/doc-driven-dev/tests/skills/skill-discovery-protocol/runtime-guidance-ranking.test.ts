const assert = require("node:assert/strict");
const test = require("node:test");

const {
  rankCandidates,
  rankRuntimeGuidance,
} = require("../../../src/skills/skill-discovery-protocol/scripts/lib/runtime_guidance_ranker.ts");

test("runtime guidance ranking prefers higher priority_delta and filters incompatible policies", () => {
  const skills = [
    {
      name: "skill-a",
      execution_policy: {
        strictness: "flexible",
        sequence_required: false,
        allow_step_reordering: true,
        allow_partial_application: true,
      },
    },
    {
      name: "skill-b",
      execution_policy: {
        strictness: "rigid",
        sequence_required: true,
        allow_step_reordering: false,
        allow_partial_application: false,
      },
    },
    {
      name: "skill-c",
      execution_policy: {
        strictness: "rigid",
        sequence_required: false,
        allow_step_reordering: false,
        allow_partial_application: false,
      },
    },
  ];

  const ranked = rankRuntimeGuidance(
    [
      {
        skill: "skill-c",
        context: "Impossible",
        guidance: "Should be filtered",
        priority_delta: 9,
        requires_sequence: true,
      },
      {
        skill: "skill-b",
        context: "During code review",
        guidance: "Check for OWASP Top 10",
        priority_delta: 1,
        requires_sequence: true,
      },
      {
        skill: "skill-a",
        context: "When authoring ADRs",
        guidance: "Follow the ADR template",
        priority_delta: 5,
        prefer_when: ["architecture"],
      },
    ],
    skills,
  );

  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((entry) => entry.skill),
    ["skill-a", "skill-b"],
  );
  assert.equal(ranked[0].priority_delta, 5);
  assert.deepEqual(ranked[0].prefer_when, ["architecture"]);
});

test("runtime guidance ranking falls back to deterministic ordering on ties", () => {
  const ranked = rankCandidates(
    [
      { skill: "skill-b", context: "b-context", guidance: "second" },
      { skill: "skill-a", context: "a-context", guidance: "third" },
      { skill: "skill-a", context: "a-context", guidance: "first" },
    ],
    [],
    [],
  );

  assert.deepEqual(
    ranked.map((entry) => `${entry.skill}:${entry.context}:${entry.guidance}`),
    [
      "skill-a:a-context:first",
      "skill-a:a-context:third",
      "skill-b:b-context:second",
    ],
  );
});
