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

const SkillReferenceInferenceSchema = z.object({
  name: z.string(),
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  tags: z.array(z.string()),
});

export const SkillReferenceInferenceDocumentSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string().optional(),
  inference_source: z.literal("agent"),
  skills: z.array(SkillReferenceInferenceSchema),
});
