"use strict";

import type { FlowProfile, SkillReferenceCatalog, AdapterConfig } from "../types";

type SchemaError = { field: string; message: string };
type SchemaResult = { result: "pass" | "fail"; errors: SchemaError[] };

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function isSnakeCase(value: string): boolean {
  return SNAKE_CASE_RE.test(value);
}

function validateProfileSchema(profile: Record<string, unknown>): SchemaError[] {
  const errors: SchemaError[] = [];

  // Required top-level keys
  const requiredKeys = [
    "schema_version",
    "profile_id",
    "generated_at",
    "validated_at",
    "adapter_id",
    "flow_stack",
    "classification",
    "resolved_invocations",
    "runtime_guidance",
    "warnings",
  ];
  for (const key of requiredKeys) {
    if (!(key in profile)) {
      errors.push({ field: key, message: `Missing required field: ${key}` });
    }
  }

  // Type checks
  if (profile.schema_version && typeof profile.schema_version !== "string") {
    errors.push({ field: "schema_version", message: "schema_version must be a string" });
  }
  if (profile.profile_id && typeof profile.profile_id !== "string") {
    errors.push({ field: "profile_id", message: "profile_id must be a string" });
  }
  if (profile.adapter_id && typeof profile.adapter_id !== "string") {
    errors.push({ field: "adapter_id", message: "adapter_id must be a string" });
  }

  // flow_stack structure
  if (profile.flow_stack && typeof profile.flow_stack === "object") {
    const fs = profile.flow_stack as Record<string, unknown>;
    if (!Array.isArray(fs.slots)) {
      errors.push({ field: "flow_stack.slots", message: "flow_stack.slots must be an array" });
    } else {
      for (let i = 0; i < fs.slots.length; i++) {
        const slot = fs.slots[i] as Record<string, unknown>;
        if (!slot.slot_id) {
          errors.push({ field: `flow_stack.slots[${i}].slot_id`, message: "slot_id is required" });
        } else if (!isSnakeCase(slot.slot_id as string)) {
          errors.push({ field: `flow_stack.slots[${i}].slot_id`, message: `slot_id must be snake_case: "${slot.slot_id}"` });
        }
        if (!slot.slot_type || !["exclusive", "layerable"].includes(slot.slot_type as string)) {
          errors.push({ field: `flow_stack.slots[${i}].slot_type`, message: `slot_type must be "exclusive" or "layerable"` });
        }
        if (!slot.activation || !["always", "conditional", "on_demand", "gate"].includes(slot.activation as string)) {
          errors.push({ field: `flow_stack.slots[${i}].activation`, message: `activation must be one of: always, conditional, on_demand, gate` });
        }
      }
    }
  }

  // classification structure
  if (profile.classification && typeof profile.classification === "object") {
    const cls = profile.classification as Record<string, unknown>;
    if (!Array.isArray(cls.categories)) {
      errors.push({ field: "classification.categories", message: "classification.categories must be an array" });
    } else {
      for (let i = 0; i < cls.categories.length; i++) {
        const cat = cls.categories[i] as Record<string, unknown>;
        if (!cat.id) {
          errors.push({ field: `classification.categories[${i}].id`, message: "category id is required" });
        } else if (!isSnakeCase(cat.id as string)) {
          errors.push({ field: `classification.categories[${i}].id`, message: `category id must be snake_case: "${cat.id}"` });
        }
      }
    }
  }

  // resolved_invocations
  if (profile.resolved_invocations && Array.isArray(profile.resolved_invocations)) {
    for (let i = 0; i < profile.resolved_invocations.length; i++) {
      const inv = profile.resolved_invocations[i] as Record<string, unknown>;
      const invRequired = ["source_skill", "slot", "capability", "resolved_skill", "resolution_method", "reason"];
      for (const key of invRequired) {
        if (!(key in inv)) {
          errors.push({ field: `resolved_invocations[${i}].${key}`, message: `Missing required field: ${key}` });
        }
      }
    }
  }

  return errors;
}

function validateCatalogSchema(catalog: Record<string, unknown>): SchemaError[] {
  const errors: SchemaError[] = [];

  const requiredKeys = [
    "schema_version",
    "generated_at",
    "validated_at",
    "skill_count",
    "capability_count",
    "slot_count",
    "slots",
    "skills",
  ];
  for (const key of requiredKeys) {
    if (!(key in catalog)) {
      errors.push({ field: key, message: `Missing required field: ${key}` });
    }
  }

  if (catalog.skills && Array.isArray(catalog.skills)) {
    for (let i = 0; i < catalog.skills.length; i++) {
      const skill = catalog.skills[i] as Record<string, unknown>;
      if (!skill.name) {
        errors.push({ field: `skills[${i}].name`, message: "skill name is required" });
      }
      if (!skill.provides || !Array.isArray(skill.provides)) {
        errors.push({ field: `skills[${i}].provides`, message: "skill provides must be an array" });
      }
      if (!skill.execution_policy || typeof skill.execution_policy !== "object") {
        errors.push({ field: `skills[${i}].execution_policy`, message: "skill execution_policy is required" });
      } else {
        const ep = skill.execution_policy as Record<string, unknown>;
        if (!["rigid", "flexible"].includes(ep.strictness as string)) {
          errors.push({ field: `skills[${i}].execution_policy.strictness`, message: `strictness must be "rigid" or "flexible"` });
        }
      }
    }
  }

  if (catalog.slots && Array.isArray(catalog.slots)) {
    for (let i = 0; i < catalog.slots.length; i++) {
      const slot = catalog.slots[i] as Record<string, unknown>;
      if (!slot.slot_id) {
        errors.push({ field: `slots[${i}].slot_id`, message: "slot_id is required" });
      } else if (!isSnakeCase(slot.slot_id as string)) {
        errors.push({ field: `slots[${i}].slot_id`, message: `slot_id must be snake_case: "${slot.slot_id}"` });
      }
    }
  }

  return errors;
}

function validateAdapterSchema(adapter: Record<string, unknown>): SchemaError[] {
  const errors: SchemaError[] = [];

  const requiredKeys = [
    "schema_version",
    "adapter_id",
    "protocol",
    "scan",
    "flow_stack",
    "classification",
    "invocation_resolution",
    "validation",
    "render",
    "artifacts",
  ];
  for (const key of requiredKeys) {
    if (!(key in adapter)) {
      errors.push({ field: key, message: `Missing required field: ${key}` });
    }
  }

  // scan.scopes consistency
  if (adapter.scan && typeof adapter.scan === "object") {
    const scan = adapter.scan as Record<string, unknown>;
    if (!scan.scopes || typeof scan.scopes !== "object") {
      errors.push({ field: "scan.scopes", message: "scan.scopes is required and must be an object" });
    }
  }

  // flow_stack.slots
  if (adapter.flow_stack && typeof adapter.flow_stack === "object") {
    const fs = adapter.flow_stack as Record<string, unknown>;
    if (!Array.isArray(fs.slots)) {
      errors.push({ field: "flow_stack.slots", message: "flow_stack.slots must be an array" });
    } else {
      for (let i = 0; i < fs.slots.length; i++) {
        const slot = fs.slots[i] as Record<string, unknown>;
        if (!slot.slot_id || !isSnakeCase(slot.slot_id as string)) {
          errors.push({ field: `flow_stack.slots[${i}].slot_id`, message: `slot_id must be snake_case` });
        }
      }
    }
  }

  return errors;
}

function runSchemaGate(
  profile: Record<string, unknown> | null,
  catalog: Record<string, unknown> | null,
  adapter: Record<string, unknown> | null,
): SchemaResult {
  const errors: SchemaError[] = [];

  if (profile) {
    errors.push(...validateProfileSchema(profile));
  }
  if (catalog) {
    errors.push(...validateCatalogSchema(catalog));
  }
  if (adapter) {
    errors.push(...validateAdapterSchema(adapter as Record<string, unknown>));
  }

  return {
    result: errors.length === 0 ? "pass" : "fail",
    errors,
  };
}

module.exports = { runSchemaGate, isSnakeCase, validateProfileSchema, validateCatalogSchema, validateAdapterSchema };
