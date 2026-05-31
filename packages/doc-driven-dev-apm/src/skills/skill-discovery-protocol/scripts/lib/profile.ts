"use strict";

import type {
  AdapterConfig,
  ScannedSkill,
  SkillReferenceCatalog,
  FlowProfile,
  FlowStackSlot,
  Category,
  ResolvedInvocation,
  RuntimeGuidance,
} from "./types";

function buildProfile(
  adapter: AdapterConfig,
  catalog: SkillReferenceCatalog,
  categories: Category[],
  unmatchedSkills: string[],
  resolvedInvocations: ResolvedInvocation[],
  skills: ScannedSkill[],
): FlowProfile {
  // Build flow_stack slots from adapter (preserve declaration order)
  const flowSlots: FlowStackSlot[] = adapter.flow_stack.slots.map((s) => ({
    slot_id: s.slot_id,
    slot_type: s.slot_type,
    activation: s.activation,
    ...(s.default ? { default: { skill: s.default.skill!, reason: s.default.reason } } : {}),
  }));

  // Build runtime_guidance from resolved invocations
  const runtimeGuidance: RuntimeGuidance[] = [];
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  for (const inv of resolvedInvocations) {
    const targetSkill = skillMap.get(inv.resolved_skill);
    if (targetSkill?.execution_policy?.guidance) {
      runtimeGuidance.push({
        skill: inv.resolved_skill,
        context: inv.capability,
        guidance: targetSkill.execution_policy.guidance,
      });
    }
  }

  // Deduplicate runtime guidance (same skill+context)
  const guidanceKey = (g: RuntimeGuidance) => `${g.skill}::${g.context}`;
  const seenGuidance = new Set<string>();
  const uniqueGuidance: RuntimeGuidance[] = [];
  for (const g of runtimeGuidance) {
    const key = guidanceKey(g);
    if (!seenGuidance.has(key)) {
      seenGuidance.add(key);
      uniqueGuidance.push(g);
    }
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return {
    schema_version: "1.0",
    flow_name: adapter.adapter_id,
    generated_at: now,
    validated_at: now,
    adapter_id: adapter.adapter_id,
    flow_stack: { slots: flowSlots },
    classification: {
      categories,
      unmatched_skills: unmatchedSkills,
    },
    resolved_invocations: resolvedInvocations,
    runtime_guidance: uniqueGuidance,
    warnings: [],
  };
}

module.exports = { buildProfile };
