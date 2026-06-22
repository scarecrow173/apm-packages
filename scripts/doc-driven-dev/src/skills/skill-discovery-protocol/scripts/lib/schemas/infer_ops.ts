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

const SkillSchema = z.object({
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  tags: z.array(z.string()),
  review_status: z.enum(["pending", "reviewed"]).optional(),
});

export const InferOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert-skill"),
    name: z.string(),
    skill: SkillSchema,
  }),
  z.object({
    op: z.literal("delete-skill"),
    name: z.string(),
  }),
  z.object({
    op: z.literal("add-provides"),
    name: z.string(),
    provides: z.array(CapabilitySchema).min(1),
  }),
  z.object({
    op: z.literal("add-uses"),
    name: z.string(),
    uses: z.array(UsesSchema).min(1),
  }),
  z.object({
    op: z.literal("remove-provides"),
    name: z.string(),
    capabilities: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal("remove-uses"),
    name: z.string(),
    capabilities: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal("add-tags"),
    name: z.string(),
    tags: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal("set-tags"),
    name: z.string(),
    tags: z.array(z.string()),
  }),
]);

export type InferOp = z.infer<typeof InferOpSchema>;
