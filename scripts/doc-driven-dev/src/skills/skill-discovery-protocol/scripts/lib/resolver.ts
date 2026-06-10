"use strict";

import type { AdapterConfig, ScannedSkill, ResolvedInvocation } from "./types";

function resolveInvocations(skills: ScannedSkill[], adapter: AdapterConfig): ResolvedInvocation[] {
  const resolutionOrder = adapter.invocation_resolution.resolution_order;
  const slotOverrides = adapter.invocation_resolution.overrides?.slots || {};
  const capOverrides = adapter.invocation_resolution.overrides?.capabilities || {};

  // Build provider index: capability -> skill names that provide it
  const providerIndex = new Map<string, string[]>();
  for (const skill of skills) {
    for (const p of skill.provides) {
      if (!providerIndex.has(p.capability)) providerIndex.set(p.capability, []);
      providerIndex.get(p.capability)!.push(skill.name);
    }
  }

  // Build slot -> capability mapping from adapter flow_stack
  const slotCapabilities = new Map<string, string>();
  for (const slot of adapter.flow_stack.slots) {
    slotCapabilities.set(slot.slot_id, slot.slot_id); // slot_id doubles as capability
  }

  const invocations: ResolvedInvocation[] = [];

  for (const skill of skills) {
    for (const use of skill.uses) {
      const resolution = resolveOne(
        skill.name,
        use.capability,
        use.default_skill,
        resolutionOrder,
        slotOverrides,
        capOverrides,
        providerIndex,
        slotCapabilities,
      );
      if (resolution) {
        invocations.push(resolution);
      }
    }
  }

  // Sort: source_skill → slot → capability
  invocations.sort((a, b) => {
    const cmp1 = a.source_skill.localeCompare(b.source_skill);
    if (cmp1 !== 0) return cmp1;
    const cmp2 = a.slot.localeCompare(b.slot);
    if (cmp2 !== 0) return cmp2;
    return a.capability.localeCompare(b.capability);
  });

  return invocations;
}

function resolveOne(
  sourceSkill: string,
  capability: string,
  defaultSkill: string | undefined,
  resolutionOrder: string[],
  slotOverrides: Record<string, { use: string; reason?: string; fallback?: string | null }>,
  capOverrides: Record<string, { prefer: string; reason?: string; fallback?: string | null }>,
  providerIndex: Map<string, string[]>,
  slotCapabilities: Map<string, string>,
): ResolvedInvocation | null {
  // Determine slot: if capability matches a slot_id, use it; otherwise use capability as slot
  const slot = slotCapabilities.has(capability) ? capability : capability;

  for (const method of resolutionOrder) {
    switch (method) {
      case "slot_override": {
        const override = slotOverrides[capability];
        if (override) {
          return {
            source_skill: sourceSkill,
            slot,
            capability,
            resolved_skill: override.use,
            resolution_method: "slot_override",
            reason: override.reason || `Slot override for ${capability}`,
            fallback: override.fallback || null,
          };
        }
        break;
      }
      case "capability_override": {
        const override = capOverrides[capability];
        if (override) {
          return {
            source_skill: sourceSkill,
            slot,
            capability,
            resolved_skill: override.prefer,
            resolution_method: "capability_override",
            reason: override.reason || `Capability override for ${capability}`,
            fallback: override.fallback || null,
          };
        }
        break;
      }
      case "default_skill": {
        if (defaultSkill) {
          return {
            source_skill: sourceSkill,
            slot,
            capability,
            resolved_skill: defaultSkill,
            resolution_method: "default_skill",
            reason: `Default skill specified in uses declaration`,
            fallback: null,
          };
        }
        break;
      }
      case "provider_lookup": {
        const providers = providerIndex.get(capability);
        if (providers && providers.length > 0) {
          // Pick the first provider alphabetically for determinism
          const sorted = [...providers].sort();
          return {
            source_skill: sourceSkill,
            slot,
            capability,
            resolved_skill: sorted[0],
            resolution_method: "provider_lookup",
            reason: `Found provider via capability lookup`,
            fallback: null,
          };
        }
        break;
      }
    }
  }

  return null;
}

module.exports = { resolveInvocations };
