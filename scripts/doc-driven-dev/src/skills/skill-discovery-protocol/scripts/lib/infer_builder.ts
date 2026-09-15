"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";

declare const require: (id: string) => { buildInferenceBaselineDocument: (skills: RawScannedSkill[]) => SkillReferenceInferenceDocument };
declare const module: { exports: Record<string, unknown> };

import { buildInferenceBaselineDocument } from "./infer_baseline";

function buildInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  return buildInferenceBaselineDocument(skills);
}

export {
  buildInferenceDocument,
};
