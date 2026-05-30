"use strict";

import type { AdapterConfig, ScannedSkill, SkillReferenceCatalog, CatalogSlot } from "./types";

function buildCatalog(skills: ScannedSkill[], adapter: AdapterConfig): SkillReferenceCatalog {
  // Build slots from adapter flow_stack
  const slots: CatalogSlot[] = adapter.flow_stack.slots.map((s) => ({
    slot_id: s.slot_id,
    description: s.default?.reason || `${s.slot_id} capability slot`,
    default_skill: s.default?.skill,
  }));

  // Collect unique capabilities
  const capabilitySet = new Set<string>();
  for (const skill of skills) {
    for (const p of skill.provides) capabilitySet.add(p.capability);
    for (const u of skill.uses) capabilitySet.add(u.capability);
  }

  // Sort skills by name
  const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));

  // Sort provides/uses within each skill
  for (const skill of sortedSkills) {
    skill.provides.sort((a, b) => a.capability.localeCompare(b.capability));
    skill.uses.sort((a, b) => a.capability.localeCompare(b.capability));
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return {
    schema_version: "1.0",
    generated_at: now,
    validated_at: now,
    skill_count: sortedSkills.length,
    capability_count: capabilitySet.size,
    slot_count: slots.length,
    slots,
    skills: sortedSkills,
  };
}

module.exports = { buildCatalog };
