"use strict";

import type {
  RawScannedSkill,
  SkillReferenceInference,
  SkillReferenceInferenceDocument,
} from "./types";

function defaultExecutionPolicy(): SkillReferenceInference["execution_policy"] {
  return {
    strictness: "flexible",
    sequence_required: false,
    allow_step_reordering: true,
    allow_partial_application: true,
  };
}

function inferSkill(skill: RawScannedSkill): SkillReferenceInference {
  return {
    name: skill.name,
    provides: [],
    uses: [],
    execution_policy: defaultExecutionPolicy(),
    tags: [],
  };
}

function buildInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
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
  buildInferenceDocument,
};
