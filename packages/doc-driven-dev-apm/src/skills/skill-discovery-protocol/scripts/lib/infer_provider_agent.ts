"use strict";

import type {
  RawScannedSkill,
  SkillReferenceInference,
  SkillReferenceInferenceDocument,
} from "./types";

type CapabilityRule = {
  capability: string;
  description: string;
  tag: string;
  patterns: RegExp[];
};

const CAPABILITY_RULES: CapabilityRule[] = [
  {
    capability: "adr_authoring",
    description: "Author architecture decision records and related decision documentation.",
    tag: "adr",
    patterns: [
      /\badr\b/i,
      /architecture decision/i,
      /decision record/i,
    ],
  },
  {
    capability: "spec_authoring",
    description: "Draft or refine specifications and structured requirements.",
    tag: "spec",
    patterns: [
      /\bspecs?\b/i,
      /specification/i,
      /requirements?/i,
    ],
  },
  {
    capability: "code_review",
    description: "Review implementations, designs, or outcomes for quality and correctness.",
    tag: "review",
    patterns: [
      /\breview\b/i,
      /reviewer/i,
      /quality gate/i,
    ],
  },
  {
    capability: "test_planning",
    description: "Define test coverage, validation strategy, or verification steps.",
    tag: "test",
    patterns: [
      /\btests?\b/i,
      /testing/i,
      /test strategy/i,
      /verification/i,
      /validation/i,
    ],
  },
];

function normalizedSkillText(skill: RawScannedSkill): string {
  return [skill.name, skill.description, skill.body]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function inferProvides(text: string): SkillReferenceInference["provides"] {
  const inferred = CAPABILITY_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => ({ capability: rule.capability, description: rule.description }));

  if (inferred.length > 0) return inferred;

  return [
    {
      capability: "general_guidance",
      description: "General guidance inferred from skill metadata and body text.",
    },
  ];
}

function inferTags(text: string): string[] {
  const tags = CAPABILITY_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.tag);

  return tags.length > 0 ? tags : ["inferred"];
}

function defaultExecutionPolicy(): SkillReferenceInference["execution_policy"] {
  return {
    strictness: "flexible",
    sequence_required: false,
    allow_step_reordering: true,
    allow_partial_application: true,
  };
}

function inferSkill(skill: RawScannedSkill): SkillReferenceInference {
  const text = normalizedSkillText(skill);

  return {
    name: skill.name,
    provides: inferProvides(text),
    uses: [],
    execution_policy: defaultExecutionPolicy(),
    tags: inferTags(text),
  };
}

function buildAgentInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  const inferredSkills = [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(inferSkill);

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    inference_source: "agent",
    skills: inferredSkills,
  };
}

module.exports = {
  buildAgentInferenceDocument,
};
