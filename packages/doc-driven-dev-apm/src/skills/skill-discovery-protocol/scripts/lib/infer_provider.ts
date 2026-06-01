"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";

const { buildAgentInferenceDocument } = require("./infer_provider_agent.ts");

type InferProviderFn = (skills: RawScannedSkill[]) => SkillReferenceInferenceDocument;

const PROVIDERS: Record<string, InferProviderFn> = {
  agent: buildAgentInferenceDocument,
};

function inferWithProvider(provider: string, skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  const fn = PROVIDERS[provider];
  if (!fn) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return fn(skills);
}

module.exports = {
  inferWithProvider,
};
