"use strict";

import { z } from "zod";

const snakeCase = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, "must be snake_case");

const DefaultEntrySchema = z.object({
  skill: z.string(),
  reason: z.string().optional(),
});

const ExclusiveFlowStackSlotSchema = z.object({
  slot_id: snakeCase,
  slot_type: z.literal("exclusive"),
  activation: z.enum(["always", "conditional", "on_demand", "gate"]),
  default: DefaultEntrySchema.optional(),
});

const LayerableFlowStackSlotSchema = z.object({
  slot_id: snakeCase,
  slot_type: z.literal("layerable"),
  activation: z.enum(["always", "conditional", "on_demand", "gate"]),
  default: z.array(DefaultEntrySchema).min(1).optional(),
});

const FlowStackSlotSchema = z.discriminatedUnion("slot_type", [
  ExclusiveFlowStackSlotSchema,
  LayerableFlowStackSlotSchema,
]);

const CategorySchema = z.object({
  id: snakeCase,
  label: z.string(),
  skills: z.array(z.string()),
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

const ResolvedInvocationSchema = z.object({
  source_skill: z.string(),
  slot: z.string(),
  capability: z.string(),
  resolved_skill: z.string(),
  resolution_method: z.string(),
  reason: z.string(),
  fallback: z.string().nullable(),
});

export const FlowProfileSchema = z.object({
  schema_version: z.string(),
  flow_name: z.string(),
  generated_at: z.string(),
  validated_at: z.string(),
  adapter_id: z.string(),
  flow_stack: z.object({
    slots: z.array(FlowStackSlotSchema),
  }),
  classification: z.object({
    categories: z.array(CategorySchema),
    unmatched_skills: z.array(z.string()),
  }),
  resolved_invocations: z.array(ResolvedInvocationSchema),
  runtime_guidance: z.array(RuntimeGuidanceSchema),
  warnings: z.array(z.string()),
});
