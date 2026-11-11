import assert from "node:assert/strict";
import test from "node:test";

import { ValidationReportSchema } from "../../../src/skills/skill-discovery-protocol/scripts/lib/schemas/validation-report";

// Same shape the producer (validate.ts) emits and the query loader consumes.
function validReport() {
  return {
    schema_version: "1.0",
    generated_at: "2026-01-01T00:00:00Z",
    repository: "test-repo",
    adapter_id: "test-adapter",
    schema_validation: { result: "pass", errors: [] },
    staleness_validation: {
      result: "pass",
      basis: "validated_at",
      basis_date: "2026-01-01T00:00:00Z",
      max_age_days: 30,
      age_days: 0,
      new_skills: [],
      removed_skills: [],
    },
    deterministic_validation: { result: "pass", comparisons: [] },
    blocking_validations: { result: "pass", checks: [] },
    catalog_validation: {
      skill_count: 1,
      reference_count: 1,
      capability_count: 1,
      orphan_skills: [],
    },
    profile_validation: {
      flow_count: 1,
      flow_stack_slot_count: 0,
      unresolved_slots: [],
      resolved_invocation_count: 1,
      unused_override_warnings: [],
    },
    overall_result: "pass",
  };
}

test("check-level results accept pass/fail/warn/skipped with details preserved", () => {
  const report = validReport();
  report.blocking_validations.checks = [
    { type: "unresolved_required", result: "pass", details: [] },
    { type: "unused_slots", result: "warn", details: ['Slot "x" has no resolved invocation and no default'] },
    { type: "unknown_skill_override", result: "fail", details: ["override references missing"] },
    { type: "capability_mismatch", result: "skipped", details: [] },
  ];
  const parsed = ValidationReportSchema.safeParse(report);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues ?? []));
  assert.equal(parsed.data.blocking_validations.checks[1].result, "warn");
  assert.equal(parsed.data.blocking_validations.checks[1].details.length, 1);
});

test("gate-level results still reject warn — aggregates stay pass|fail|skipped", () => {
  const cases: Array<(r: ReturnType<typeof validReport>) => void> = [
    (r) => { r.schema_validation.result = "warn"; },
    (r) => { r.staleness_validation.result = "warn"; },
    (r) => { r.deterministic_validation.result = "warn"; },
    (r) => { r.blocking_validations.result = "warn"; },
    (r) => { r.overall_result = "warn"; },
  ];
  for (const mutate of cases) {
    const report = validReport();
    mutate(report);
    assert.equal(
      ValidationReportSchema.safeParse(report).success,
      false,
      `report must be rejected: ${mutate.toString().slice(0, 80)}`,
    );
  }
});

test("gate-level skipped remains accepted (backward compatibility)", () => {
  const report = validReport();
  report.blocking_validations = { result: "skipped", checks: [] };
  report.deterministic_validation = { result: "skipped", comparisons: [] };
  assert.ok(ValidationReportSchema.safeParse(report).success);
});

test("unknown enums, missing fields, and wrong types are rejected", () => {
  const cases: Array<(r: any) => void> = [
    (r) => { r.blocking_validations.checks.push({ type: "x", result: "error", details: [] }); },
    (r) => { r.blocking_validations.checks.push({ type: "x", result: "warning", details: [] }); },
    (r) => { r.blocking_validations.checks.push({ type: "x", result: "warn" }); }, // details missing
    (r) => { delete r.blocking_validations.checks; },
    (r) => { delete r.overall_result; },
    (r) => { r.blocking_validations.result = 42; },
  ];
  for (const mutate of cases) {
    const report = validReport() as any;
    mutate(report);
    assert.equal(ValidationReportSchema.safeParse(report).success, false, mutate.toString());
  }
});

test("malformed JSON input fails safeParse (schema sees garbage, not a report)", () => {
  assert.equal(ValidationReportSchema.safeParse("{ not json").success, false);
  assert.equal(ValidationReportSchema.safeParse(null).success, false);
});
