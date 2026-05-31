"use strict";

import type { ScannedSkill, SkillReferenceCatalog } from "./types";

function buildCatalog(skills: ScannedSkill[]): SkillReferenceCatalog {
  // Collect unique capabilities
  const capabilitySet = new Set<string>();
  for (const skill of skills) {
    for (const p of skill.provides) capabilitySet.add(p.capability);
    for (const u of skill.uses) capabilitySet.add(u.capability);
  }

  // Sort skills by name (deep copy to avoid mutating originals)
  const sortedSkills = skills
    .map((s) => ({
      ...s,
      provides: [...s.provides].sort((a, b) => a.capability.localeCompare(b.capability)),
      uses: [...s.uses].sort((a, b) => a.capability.localeCompare(b.capability)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return {
    schema_version: "1.0",
    generated_at: now,
    validated_at: now,
    skill_count: sortedSkills.length,
    capability_count: capabilitySet.size,
    skills: sortedSkills,
  };
}

module.exports = { buildCatalog };
