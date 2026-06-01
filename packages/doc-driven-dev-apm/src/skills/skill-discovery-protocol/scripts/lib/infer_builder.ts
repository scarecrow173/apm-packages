"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";

declare const require: (id: string) => { buildInferenceBaselineDocument: (skills: RawScannedSkill[]) => SkillReferenceInferenceDocument };
declare const module: { exports: Record<string, unknown> };

const { buildInferenceBaselineDocument } = require("./infer_baseline.ts");

function buildInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  return buildInferenceBaselineDocument(skills);
}

module.exports = {
  buildInferenceDocument,
};
