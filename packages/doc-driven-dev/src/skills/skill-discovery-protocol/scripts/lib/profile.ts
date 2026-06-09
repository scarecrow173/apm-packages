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
import { rankRuntimeGuidance } from "./runtime_guidance_ranker";

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
    ...(s.default ? { default: s.default } : {}),
  }));

  // Build runtime_guidance from skill-level inference metadata.
  // Explicit runtime_guidance wins; execution_policy.guidance is a fallback hint.
  const runtimeGuidance: RuntimeGuidance[] = [];
  for (const skill of skills) {
    if (skill.runtime_guidance && skill.runtime_guidance.length > 0) {
      runtimeGuidance.push(...skill.runtime_guidance);
      continue;
    }

    if (skill.execution_policy?.guidance) {
      runtimeGuidance.push({
        skill: skill.name,
        context: "execution_policy",
        guidance: skill.execution_policy.guidance,
      });
    }
  }

  const rankedGuidance = rankRuntimeGuidance(runtimeGuidance, skills);

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
    runtime_guidance: rankedGuidance,
    warnings: [],
  };
}

module.exports = { buildProfile };
