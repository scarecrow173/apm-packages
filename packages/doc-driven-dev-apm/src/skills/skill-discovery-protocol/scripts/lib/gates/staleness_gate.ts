"use strict";

import type { SkillReferenceCatalog, RawScannedSkill } from "../types";

type StalenessResult = {
  result: "pass" | "fail";
  basis: string;
  basis_date: string;
  max_age_days: number;
  age_days: number;
  new_skills: string[];
  removed_skills: string[];
};

function runStalenessGate(
  catalog: SkillReferenceCatalog,
  currentSkills: RawScannedSkill[],
  maxAgeDays: number,
): StalenessResult {
  const basisDate = catalog.validated_at || catalog.generated_at;
  const basisTs = new Date(basisDate).getTime();
  const now = Date.now();
  const ageDays = Math.floor((now - basisTs) / (1000 * 60 * 60 * 24));

  // Detect added/removed skills
  const catalogSkillNames = new Set(catalog.skills.map((s) => s.name));
  const currentSkillNames = new Set(currentSkills.map((s) => s.name));

  const newSkills: string[] = [];
  const removedSkills: string[] = [];

  for (const name of currentSkillNames) {
    if (!catalogSkillNames.has(name)) {
      newSkills.push(name);
    }
  }
  for (const name of catalogSkillNames) {
    if (!currentSkillNames.has(name)) {
      removedSkills.push(name);
    }
  }

  const stale = ageDays > maxAgeDays;
  const skillsChanged = newSkills.length > 0 || removedSkills.length > 0;

  return {
    result: stale || skillsChanged ? "fail" : "pass",
    basis: "validated_at",
    basis_date: basisDate,
    max_age_days: maxAgeDays,
    age_days: ageDays,
    new_skills: newSkills.sort(),
    removed_skills: removedSkills.sort(),
  };
}

module.exports = { runStalenessGate };
