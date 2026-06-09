"use strict";

import { z } from "zod";

const snakeCase = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, "must be snake_case");
const identifier = z.string().regex(/^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/, "must be a valid identifier (lowercase, digits, hyphens, underscores)");

const AdapterScopeSchema = z.object({
  enabled: z.boolean().optional(),
  roots: z.array(z.string()),
});

const DefaultEntrySchema = z.object({
  skill: z.string(),
  reason: z.string().optional(),
});

const ExclusiveAdapterSlotSchema = z.object({
  slot_id: snakeCase,
  slot_type: z.literal("exclusive"),
  activation: z.enum(["always", "conditional", "on_demand", "gate"]),
  default: DefaultEntrySchema.optional(),
});

const LayerableAdapterSlotSchema = z.object({
  slot_id: snakeCase,
  slot_type: z.literal("layerable"),
  activation: z.enum(["always", "conditional", "on_demand", "gate"]),
  default: z.array(DefaultEntrySchema).min(1).optional(),
});

const AdapterSlotSchema = z.discriminatedUnion("slot_type", [ExclusiveAdapterSlotSchema, LayerableAdapterSlotSchema]);

const TaxonomyEntrySchema = z.object({
  id: snakeCase,
  label: z.string(),
  description: z.string(),
  match: z.object({
    capabilities: z.array(z.string()),
    tags: z.array(z.string()),
    description_patterns: z.array(z.string()),
  }),
});

export const AdapterConfigSchema = z
  .object({
    schema_version: z.string().optional(),
    adapter_id: identifier,
    protocol: z
      .object({
        name: z.literal("skill-discovery-protocol"),
        min_version: z.string(),
      })
      .optional(),
    enabled: z.boolean().optional(),
    extends: z.array(z.string()).optional(),
    metadata: z
      .object({
        description: z.string().optional(),
        owner: z.string().optional(),
      })
      .optional(),
    scan: z
      .object({
        scopes: z.record(z.string(), AdapterScopeSchema),
      })
      .optional(),
    profile: z
      .object({
        title: z.string().optional(),
      })
      .optional(),
    flow_stack: z.object({
      slots: z.array(AdapterSlotSchema),
    }).optional(),
    classification: z.object({
      unmatched: z.object({
        action: z.string(),
        category: z.string().optional(),
        severity: z.string(),
      }),
      taxonomy: z.array(TaxonomyEntrySchema),
    }).optional(),
    invocation_resolution: z.object({
      overrides: z.object({
          slots: z.record(z.string(), z.object({
            use: z.string(),
            reason: z.string().optional(),
            fallback: z.string().nullable().optional(),
          })).optional(),
        capabilities: z.record(
          z.string(),
          z.object({
            prefer: z.string(),
            reason: z.string().optional(),
            fallback: z.string().nullable().optional(),
          }),
        ),
      }).optional(),
      resolution_order: z.array(z.string()),
      unresolved: z.object({
        required: z.string(),
        optional: z.string(),
      }),
      invalid_override: z.record(z.string(), z.string()),
    }).optional(),
    validation: z
      .object({
        schema: z.boolean().optional(),
        staleness: z
          .object({
            enabled: z.boolean().optional(),
            basis: z.string().optional(),
            max_age_days: z.number().int().positive().optional(),
          })
          .optional(),
        deterministic: z
          .object({
            enabled: z.boolean().optional(),
            compare: z.array(z.string()).optional(),
          })
          .optional(),
        invocation: z
          .object({
            enabled: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    render: z
      .object({
        stable_sort: z.object({
          skills: z.array(z.string()),
          invocations: z.array(z.string()),
        }),
        normalize_whitespace: z.boolean().optional(),
        newline: z.string().optional(),
      })
      .optional(),
    artifacts: z
      .object({
        protocol: z.record(z.string(), z.string()),
      })
      .optional(),
    readable_outputs: z
      .object({
        enabled: z.boolean().optional(),
        include: z.array(z.string()).optional(),
      })
      .optional(),
  });
