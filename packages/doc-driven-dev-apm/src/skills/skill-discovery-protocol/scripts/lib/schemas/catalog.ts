"use strict";

import { z } from "zod";

const snakeCase = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, "must be snake_case");

const CatalogSlotSchema = z.object({
  slot_id: snakeCase,
  description: z.string(),
  default_skill: z.string().optional(),
});

const CapabilitySchema = z.object({
  capability: z.string(),
  description: z.string().optional(),
});

const UsesSchema = z.object({
  capability: z.string(),
  required: z.boolean(),
  default_skill: z.string().optional(),
  override_allowed: z.boolean(),
});

const ExecutionPolicySchema = z.object({
  strictness: z.enum(["rigid", "flexible"]),
  sequence_required: z.boolean(),
  allow_step_reordering: z.boolean(),
  allow_partial_application: z.boolean(),
  guidance: z.string().optional(),
});

const CatalogSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  tags: z.array(z.string()),
});

export const SkillReferenceCatalogSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  validated_at: z.string(),
  skill_count: z.number().int().nonnegative(),
  capability_count: z.number().int().nonnegative(),
  slot_count: z.number().int().nonnegative(),
  slots: z.array(CatalogSlotSchema),
  skills: z.array(CatalogSkillSchema),
});
