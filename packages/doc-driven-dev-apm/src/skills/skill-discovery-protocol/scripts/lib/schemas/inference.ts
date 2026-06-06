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

const SkillReferenceInferenceSchema = z.object({
  name: z.string(),
  review_status: z.enum(["pending", "reviewed"]),
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  runtime_guidance: z.array(RuntimeGuidanceSchema).optional(),
  tags: z.array(z.string()),
});

export const SkillReferenceInferenceDocumentSchema = z.object({
  schema_version: z.literal("1.0"),
  generated_at: z.string().optional(),
  inference_source: z.literal("agent"),
  skills: z.array(SkillReferenceInferenceSchema),
});
