"use strict";

import { z } from "zod";

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

const RuntimeGuidanceSchema = z.object({
  skill: z.string(),
  context: z.string(),
  guidance: z.string(),
  priority_delta: z.number().optional(),
  prefer_when: z.array(z.string()).optional(),
  avoid_when: z.array(z.string()).optional(),
  requires_sequence: z.boolean().optional(),
  requires_step_reordering: z.boolean().optional(),
  requires_partial_application: z.boolean().optional(),
});

const CatalogSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  runtime_guidance: z.array(RuntimeGuidanceSchema).optional(),
  tags: z.array(z.string()),
});

export const SkillReferenceCatalogSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  validated_at: z.string(),
  skill_count: z.number().int().nonnegative(),
  capability_count: z.number().int().nonnegative(),
  skills: z.array(CatalogSkillSchema),
});
