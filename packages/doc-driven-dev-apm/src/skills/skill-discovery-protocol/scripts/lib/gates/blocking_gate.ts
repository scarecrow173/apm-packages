"use strict";

import type { FlowProfile, SkillReferenceCatalog, AdapterConfig, ScannedSkill } from "../types";

type BlockingCheck = {
  type: string;
  result: "pass" | "fail" | "warn";
  details: string[];
};

type BlockingResult = {
  result: "pass" | "fail";
  checks: BlockingCheck[];
};

/**
 * Run blocking validations based on adapter invocation_resolution settings.
 * - unresolved.required = "fail" → required capability not resolved
 * - invalid_override.unknown_skill = "fail" → override references non-existent skill
 * - invalid_override.capability_mismatch = "fail" → override skill doesn't provide capability
 * - invalid_override.override_not_allowed = "fail" → override on uses[] with override_allowed=false
 */
function runBlockingGate(
  profile: FlowProfile,
  catalog: SkillReferenceCatalog,
  adapter: AdapterConfig,
  skills: ScannedSkill[],
): BlockingResult {
  const checks: BlockingCheck[] = [];
  const invResolution = adapter.invocation_resolution;
  const overrides = invResolution.overrides ?? { capabilities: {} as Record<string, never> };

  // Build helper indices
  const skillNames = new Set(skills.map((s) => s.name));
  const skillProvides = new Map<string, Set<string>>();
  for (const skill of skills) {
    const caps = new Set(skill.provides.map((p) => p.capability));
    skillProvides.set(skill.name, caps);
  }

  // Check 1: unresolved required capabilities
  const unresolvedCheck = checkUnresolvedRequired(profile, skills, invResolution.unresolved.required);
  checks.push(unresolvedCheck);

  // Check 2: invalid overrides - unknown_skill
  const unknownSkillCheck = checkUnknownSkillOverrides({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skillNames, invResolution.invalid_override.unknown_skill);
  checks.push(unknownSkillCheck);

  // Check 3: invalid overrides - capability_mismatch
  const capMismatchCheck = checkCapabilityMismatch({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skillProvides, invResolution.invalid_override.capability_mismatch);
  checks.push(capMismatchCheck);

  // Check 4: invalid overrides - override_not_allowed
  const overrideNotAllowedCheck = checkOverrideNotAllowed({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skills, invResolution.invalid_override.override_not_allowed);
  checks.push(overrideNotAllowedCheck);

  // Check 5: unused/unresolved slot warnings
  const unusedSlotsCheck = checkUnusedSlots(profile, catalog);
  checks.push(unusedSlotsCheck);

  const hasFail = checks.some((c) => c.result === "fail");

  return {
    result: hasFail ? "fail" : "pass",
    checks,
  };
}

function checkUnresolvedRequired(
  profile: FlowProfile,
  skills: ScannedSkill[],
  severity: string,
): BlockingCheck {
  const details: string[] = [];

  // Find all required uses that are not resolved
  const resolvedCaps = new Set(
    profile.resolved_invocations.map((inv) => `${inv.source_skill}::${inv.capability}`),
  );

  for (const skill of skills) {
    for (const use of skill.uses) {
      if (use.required) {
        const key = `${skill.name}::${use.capability}`;
        if (!resolvedCaps.has(key)) {
          details.push(`${skill.name} requires "${use.capability}" but no provider resolved`);
        }
      }
    }
  }

  const result = details.length > 0 ? (severity === "fail" ? "fail" : "warn") : "pass";
  return { type: "unresolved_required", result, details };
}

function checkUnknownSkillOverrides(
  adapter: AdapterConfig,
  skillNames: Set<string>,
  severity: string,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution.overrides;

  // Check slot overrides
  if (overrides.slots) {
    for (const [slotId, override] of Object.entries(overrides.slots)) {
      if (override.use && !skillNames.has(override.use)) {
        details.push(`Slot override "${slotId}" references unknown skill "${override.use}"`);
      }
      if (override.fallback && !skillNames.has(override.fallback)) {
        details.push(`Slot override "${slotId}" fallback references unknown skill "${override.fallback}"`);
      }
    }
  }

  // Check capability overrides
  if (overrides.capabilities) {
    for (const [cap, override] of Object.entries(overrides.capabilities)) {
      if (override.prefer && !skillNames.has(override.prefer)) {
        details.push(`Capability override "${cap}" references unknown skill "${override.prefer}"`);
      }
      if (override.fallback && !skillNames.has(override.fallback)) {
        details.push(`Capability override "${cap}" fallback references unknown skill "${override.fallback}"`);
      }
    }
  }

  const result = details.length > 0 ? (severity === "fail" ? "fail" : "warn") : "pass";
  return { type: "unknown_skill_override", result, details };
}

function checkCapabilityMismatch(
  adapter: AdapterConfig,
  skillProvides: Map<string, Set<string>>,
  severity: string,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution.overrides;

  // Check capability overrides - does the preferred skill actually provide that capability?
  if (overrides.capabilities) {
    for (const [cap, override] of Object.entries(overrides.capabilities)) {
      if (override.prefer) {
        const caps = skillProvides.get(override.prefer);
        if (caps && !caps.has(cap)) {
          details.push(`Capability override "${cap}": skill "${override.prefer}" does not provide "${cap}"`);
        }
      }
    }
  }

  const result = details.length > 0 ? (severity === "fail" ? "fail" : "warn") : "pass";
  return { type: "capability_mismatch", result, details };
}

function checkOverrideNotAllowed(
  adapter: AdapterConfig,
  skills: ScannedSkill[],
  severity: string,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution.overrides;

  // Build index of uses with override_allowed=false
  const noOverride = new Map<string, Set<string>>(); // capability -> set of skills that disallow override
  for (const skill of skills) {
    for (const use of skill.uses) {
      if (!use.override_allowed) {
        if (!noOverride.has(use.capability)) noOverride.set(use.capability, new Set());
        noOverride.get(use.capability)!.add(skill.name);
      }
    }
  }

  // Check if any override targets a capability that has override_allowed=false
  if (overrides.capabilities) {
    for (const [cap] of Object.entries(overrides.capabilities)) {
      if (noOverride.has(cap)) {
        const affectedSkills = [...noOverride.get(cap)!];
        details.push(`Capability override "${cap}" conflicts with override_allowed=false in: ${affectedSkills.join(", ")}`);
      }
    }
  }

  const result = details.length > 0 ? (severity === "fail" ? "fail" : "warn") : "pass";
  return { type: "override_not_allowed", result, details };
}

function checkUnusedSlots(
  profile: FlowProfile,
  catalog: SkillReferenceCatalog,
): BlockingCheck {
  const details: string[] = [];

  // Check for slots defined in flow_stack but never used in resolved_invocations
  const usedSlots = new Set(profile.resolved_invocations.map((inv) => inv.slot));

  for (const slot of profile.flow_stack.slots) {
    if (!usedSlots.has(slot.slot_id) && !slot.default) {
      details.push(`Slot "${slot.slot_id}" has no resolved invocation and no default`);
    }
  }

  // This is always a warning, never a blocking failure
  return { type: "unused_slots", result: details.length > 0 ? "warn" : "pass", details };
}

module.exports = { runBlockingGate };
