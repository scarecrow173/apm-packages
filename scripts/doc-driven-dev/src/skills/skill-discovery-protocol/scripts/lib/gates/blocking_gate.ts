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
  if (!Array.isArray(skills)) skills = [];
  const checks: BlockingCheck[] = [];
  // The adapter passes loadAdapter's required-keys check only — inner
  // fields like unresolved/invalid_override are not shape-validated, so
  // they are guarded too (a missing key degrades that check to "warn").
  const invResolution = adapter.invocation_resolution ?? ({} as AdapterConfig["invocation_resolution"]);
  const overrides = invResolution.overrides ?? { capabilities: {} as Record<string, never> };

  // Build helper indices. Profile and catalog reach this gate as
  // untrusted artifacts: the schema gate reports their defects but all
  // gates still run, so every dereference stays guarded (Array.isArray /
  // ?. / null-element skips) to keep the run alive long enough to write
  // validation-report.json. Note `?? []` alone is insufficient — a
  // truthy non-array like {} or "x" still crashes `.map`.
  const skillNames = new Set(skills.filter((s) => s != null).map((s) => s.name));
  const skillProvides = new Map<string, Set<string>>();
  for (const skill of skills) {
    if (skill == null) continue;
    const provides = Array.isArray(skill.provides) ? skill.provides : [];
    const caps = new Set(provides.filter((p) => p != null).map((p) => p.capability));
    skillProvides.set(skill.name, caps);
  }

  // Check 1: unresolved required capabilities
  const unresolvedCheck = checkUnresolvedRequired(profile, skills, invResolution.unresolved?.required);
  checks.push(unresolvedCheck);

  // Check 2: invalid overrides - unknown_skill
  const unknownSkillCheck = checkUnknownSkillOverrides({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skillNames, invResolution.invalid_override?.unknown_skill);
  checks.push(unknownSkillCheck);

  // Check 3: invalid overrides - capability_mismatch
  const capMismatchCheck = checkCapabilityMismatch({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skillProvides, invResolution.invalid_override?.capability_mismatch);
  checks.push(capMismatchCheck);

  // Check 4: invalid overrides - override_not_allowed
  const overrideNotAllowedCheck = checkOverrideNotAllowed({ ...adapter, invocation_resolution: { ...invResolution, overrides } }, skills, invResolution.invalid_override?.override_not_allowed);
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
  severity: string | undefined,
): BlockingCheck {
  const details: string[] = [];

  // Find all required uses that are not resolved
  const resolvedInvocations = Array.isArray(profile.resolved_invocations)
    ? profile.resolved_invocations
    : [];
  const resolvedCaps = new Set(
    resolvedInvocations
      .filter((inv) => inv != null)
      .map((inv) => `${inv.source_skill}::${inv.capability}`),
  );

  for (const skill of skills) {
    if (skill == null) continue;
    const uses = Array.isArray(skill.uses) ? skill.uses : [];
    for (const use of uses) {
      if (use != null && use.required) {
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
  severity: string | undefined,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution?.overrides ?? { capabilities: {} };

  // Check slot overrides
  if (overrides.slots) {
    for (const [slotId, override] of Object.entries(overrides.slots)) {
      if (override?.use && !skillNames.has(override.use)) {
        details.push(`Slot override "${slotId}" references unknown skill "${override.use}"`);
      }
      if (override?.fallback && !skillNames.has(override.fallback)) {
        details.push(`Slot override "${slotId}" fallback references unknown skill "${override.fallback}"`);
      }
    }
  }

  // Check capability overrides
  if (overrides.capabilities) {
    for (const [cap, override] of Object.entries(overrides.capabilities)) {
      if (override?.prefer && !skillNames.has(override.prefer)) {
        details.push(`Capability override "${cap}" references unknown skill "${override.prefer}"`);
      }
      if (override?.fallback && !skillNames.has(override.fallback)) {
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
  severity: string | undefined,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution?.overrides ?? { capabilities: {} };

  // Check capability overrides - does the preferred skill actually provide that capability?
  if (overrides.capabilities) {
    for (const [cap, override] of Object.entries(overrides.capabilities)) {
      if (override?.prefer) {
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
  severity: string | undefined,
): BlockingCheck {
  const details: string[] = [];
  const overrides = adapter.invocation_resolution?.overrides ?? { capabilities: {} };

  // Build index of uses with override_allowed=false
  const noOverride = new Map<string, Set<string>>(); // capability -> set of skills that disallow override
  for (const skill of skills) {
    if (skill == null) continue;
    const uses = Array.isArray(skill.uses) ? skill.uses : [];
    for (const use of uses) {
      if (use != null && !use.override_allowed) {
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
  const resolvedInvocations = Array.isArray(profile.resolved_invocations)
    ? profile.resolved_invocations
    : [];
  const usedSlots = new Set(
    resolvedInvocations.filter((inv) => inv != null).map((inv) => inv.slot),
  );

  const flowStackSlots = Array.isArray(profile.flow_stack?.slots)
    ? profile.flow_stack.slots
    : [];
  for (const slot of flowStackSlots) {
    if (slot != null && !usedSlots.has(slot.slot_id) && !slot.default) {
      details.push(`Slot "${slot.slot_id}" has no resolved invocation and no default`);
    }
  }

  // This is always a warning, never a blocking failure
  return { type: "unused_slots", result: details.length > 0 ? "warn" : "pass", details };
}

export { runBlockingGate };
