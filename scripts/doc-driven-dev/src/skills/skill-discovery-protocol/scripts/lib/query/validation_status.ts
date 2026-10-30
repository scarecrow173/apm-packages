"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "validation-status",
  description: "検証状態要約",
  execute(ctx: QueryContext): unknown {
    if (!ctx.validationReport) {
      return { error: "Validation report not found (validation-report.json must be co-located with profile)" };
    }
    const report = ctx.validationReport;
    return {
      generated_at: report.generated_at,
      adapter_id: report.adapter_id,
      overall_result: report.overall_result,
      gates: {
        schema: report.schema_validation.result,
        staleness: report.staleness_validation.result,
        deterministic: report.deterministic_validation.result,
        blocking: report.blocking_validations.result,
      },
      schema_errors: report.schema_validation.errors,
      catalog: report.catalog_validation,
      profile: report.profile_validation,
    };
  },
};

register(handler);
export default handler;
