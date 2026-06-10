"use strict";

import type {
  SkillReferenceInferenceDocument,
  SkillScanListDocument,
} from "./types";

export type InferenceCompletenessResult =
  | { ok: true }
  | { ok: false; pending_skills: string[]; message: string };

export function validateInferenceCompleteness(
  scanList: SkillScanListDocument,
  inferenceDoc: SkillReferenceInferenceDocument,
): InferenceCompletenessResult {
  const scannedNames = new Set(scanList.skills.map((skill) => skill.name));
  const inferredByName = new Map(inferenceDoc.skills.map((skill) => [skill.name, skill]));

  const pendingSkills = [...scannedNames]
    .filter((name) => inferredByName.get(name)?.review_status !== "reviewed")
    .sort();

  if (pendingSkills.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    pending_skills: pendingSkills,
    message: `Inference document is incomplete: ${pendingSkills.length} skill(s) still pending review: ${pendingSkills.join(", ")}`,
  };
}

module.exports = {
  validateInferenceCompleteness,
};
