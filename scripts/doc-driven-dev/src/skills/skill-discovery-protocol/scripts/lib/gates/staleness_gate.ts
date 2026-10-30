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
  // An unparseable basis date must fail closed: NaN comparisons are
  // always false, so without the guard a garbage timestamp would
  // silently pass the age check. age_days = -1 marks "age unknown" in
  // the report.
  const basisUnparseable = Number.isNaN(basisTs);
  const ageDays = basisUnparseable ? -1 : Math.floor((now - basisTs) / (1000 * 60 * 60 * 24));

  // Detect added/removed skills. The catalog is an untrusted artifact:
  // schema errors are reported by the schema gate, but every gate still
  // runs — guard the dereference and skip non-object elements so the
  // report is always written.
  const catalogSkills = Array.isArray(catalog.skills) ? catalog.skills : [];
  const catalogSkillNames = new Set(
    catalogSkills.filter((s) => s != null).map((s) => s.name),
  );
  const currentSkillNames = new Set(
    (Array.isArray(currentSkills) ? currentSkills : [])
      .filter((s) => s != null)
      .map((s) => s.name),
  );

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

  const stale = basisUnparseable || ageDays > maxAgeDays;
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

export { runStalenessGate };
