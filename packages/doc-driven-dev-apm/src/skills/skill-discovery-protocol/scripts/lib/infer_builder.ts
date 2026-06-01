"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";

declare const require: (id: string) => { buildAgentInferenceDocument: (skills: RawScannedSkill[]) => SkillReferenceInferenceDocument };
declare const module: { exports: Record<string, unknown> };

const { buildAgentInferenceDocument } = require("./infer_provider_agent.ts");

function buildInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  return buildAgentInferenceDocument(skills);
}

module.exports = {
  buildInferenceDocument,
};
