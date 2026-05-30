"use strict";

import { AdapterConfigSchema } from "../schemas/adapter";
import { SkillReferenceCatalogSchema } from "../schemas/catalog";
import { FlowProfileSchema } from "../schemas/profile";
import type { z } from "zod";

type SchemaError = { field: string; message: string };
type SchemaResult = { result: "pass" | "fail"; errors: SchemaError[] };

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function isSnakeCase(value: string): boolean {
  return SNAKE_CASE_RE.test(value);
}

function zodIssuesToErrors(issues: z.core.$ZodIssue[]): SchemaError[] {
  return issues.map((issue) => {
    const field = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".").replace(/\.\[/g, "[");
    let message = issue.message;

    // Translate Zod messages to user-friendly format
    if (issue.code === "invalid_type" && message.includes("received undefined")) {
      message = `Missing required field: ${issue.path[issue.path.length - 1] ?? field}`;
    }

    return { field, message };
  });
}

function validateProfileSchema(profile: Record<string, unknown>): SchemaError[] {
  const result = FlowProfileSchema.safeParse(profile);
  if (result.success) return [];
  return zodIssuesToErrors(result.error.issues);
}

function validateCatalogSchema(catalog: Record<string, unknown>): SchemaError[] {
  const result = SkillReferenceCatalogSchema.safeParse(catalog);
  if (result.success) return [];
  return zodIssuesToErrors(result.error.issues);
}

function validateAdapterSchema(adapter: Record<string, unknown>): SchemaError[] {
  const result = AdapterConfigSchema.safeParse(adapter);
  if (result.success) return [];
  return zodIssuesToErrors(result.error.issues);
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
    errors.push(...validateAdapterSchema(adapter));
  }

  return {
    result: errors.length === 0 ? "pass" : "fail",
    errors,
  };
}

module.exports = { runSchemaGate, isSnakeCase, validateProfileSchema, validateCatalogSchema, validateAdapterSchema };
