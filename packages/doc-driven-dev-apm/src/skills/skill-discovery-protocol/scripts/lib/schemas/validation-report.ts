"use strict";

import { z } from "zod";

const SchemaErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

const StalenessValidationSchema = z.object({
  result: z.string(),
  basis: z.string(),
  basis_date: z.string(),
  max_age_days: z.number(),
  age_days: z.number(),
  new_skills: z.array(z.string()),
  removed_skills: z.array(z.string()),
});

const DeterministicValidationSchema = z.object({
  result: z.string(),
  comparisons: z.array(
    z.object({
      target: z.string(),
      diff_found: z.boolean(),
    }),
  ),
  reason: z.string().optional(),
});

const BlockingCheckSchema = z.object({
  type: z.string(),
  result: z.string(),
  details: z.array(z.string()),
});

const CatalogValidationSchema = z.object({
  skill_count: z.number().int().nonnegative(),
  reference_count: z.number().int().nonnegative(),
  capability_count: z.number().int().nonnegative(),
  slot_count: z.number().int().nonnegative(),
  orphan_skills: z.array(z.string()),
  unresolved_slots: z.array(z.string()),
});

const ProfileValidationSchema = z.object({
  flow_count: z.number().int().nonnegative(),
  resolved_invocation_count: z.number().int().nonnegative(),
  unused_override_warnings: z.array(z.string()),
});

export const ValidationReportSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repository: z.string(),
  adapter_id: z.string(),
  schema_validation: z.object({
    result: z.enum(["pass", "fail"]),
    errors: z.array(SchemaErrorSchema),
  }),
  staleness_validation: StalenessValidationSchema,
  deterministic_validation: DeterministicValidationSchema,
  blocking_validations: z.object({
    result: z.string(),
    checks: z.array(BlockingCheckSchema),
  }),
  catalog_validation: CatalogValidationSchema,
  profile_validation: ProfileValidationSchema,
  overall_result: z.enum(["pass", "fail"]),
});
