"use strict";

import type {
  RawScannedSkill,
  SkillReferenceInference,
  SkillReferenceInferenceDocument,
} from "./types";

declare const module: { exports: Record<string, unknown> };

function defaultExecutionPolicy(): SkillReferenceInference["execution_policy"] {
  return {
    strictness: "flexible",
    sequence_required: false,
    allow_step_reordering: true,
    allow_partial_application: true,
  };
}

function buildInferenceBaselineDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  const inferredSkills = [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      name: skill.name,
      provides: [],
      uses: [],
      execution_policy: defaultExecutionPolicy(),
      tags: [],
    }));

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    inference_source: "agent",
    skills: inferredSkills,
  };
}

module.exports = {
  buildInferenceBaselineDocument,
};
